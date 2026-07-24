-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — integrity hardening.
--
-- Closes five gaps that only matter once real money runs through the pipeline:
--
--   1. AMOUNT INTEGRITY  — statement amounts must be non-negative and stored at
--      exactly the ledger's 2dp scale, so a line and the journal it produces can
--      never disagree by fractions of a cent.
--   2. IMMUTABILITY      — once a batch is posted its lines are an audit record.
--      Edits and deletes are refused; corrections go through the void path.
--   3. VOID PATH         — a posted batch can be reversed with balanced counter
--      entries. Originals are never mutated or deleted, and the period is
--      released so it can be re-imported cleanly.
--   4. CONCURRENCY       — two simultaneous imports of the same bank account +
--      period can no longer both pass the application-level idempotency check.
--   5. SUSPENSE VISIBILITY — a callable balance/aging report so period close can
--      see unresolved value instead of discovering it later.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Amount integrity ────────────────────────────────────────────────────
ALTER TABLE public.bank_statement_lines
  ADD CONSTRAINT bank_statement_lines_amounts_nonneg
    CHECK (debit >= 0 AND credit >= 0),
  ADD CONSTRAINT bank_statement_lines_amounts_scale
    CHECK (debit = round(debit, 2) AND credit = round(credit, 2)),
  -- NUMERIC(14,2) in journal_lines: 12 integer digits max.
  ADD CONSTRAINT bank_statement_lines_amounts_fit_ledger
    CHECK (debit < 1000000000000 AND credit < 1000000000000);

ALTER TABLE public.bank_statement_batches
  ADD CONSTRAINT bank_statement_batches_totals_nonneg
    CHECK (total_debit >= 0 AND total_credit >= 0 AND row_count >= 0);

-- ── 1b. Indexes for the post-time verification joins ───────────────────────
-- The balanced-entry check, the posted-total reconciliation and the void path
-- all join bank_statement_lines to journal_lines on journal_entry_id. Postgres
-- does not index foreign keys automatically, so without this the planner falls
-- back to scanning journal_lines — which grows with every import, making the
-- verification cost climb superlinearly batch after batch.
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_je
  ON public.bank_statement_lines (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_reclass_je
  ON public.bank_statement_lines (reclass_journal_entry_id)
  WHERE reclass_journal_entry_id IS NOT NULL;

-- ── 2. Immutability of posted records ──────────────────────────────────────
-- A line belonging to a posted batch is an audit record. The ONLY fields that
-- may still change are the suspense-clearing outcome fields, because clearing
-- legitimately happens after posting.
CREATE OR REPLACE FUNCTION public.block_posted_bank_line_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.bank_statement_batches
   WHERE id = COALESCE(NEW.batch_id, OLD.batch_id);

  IF v_status IS DISTINCT FROM 'posted' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_POSTED_LINE: statement lines of a posted batch cannot be deleted — void the batch instead'
      USING ERRCODE = 'P0001';
  END IF;

  -- Everything except the clearing-outcome fields must be unchanged.
  IF (NEW.tenant_id, NEW.batch_id, NEW.txn_date, NEW.description, NEW.name,
      NEW.raw_account_type, NEW.debit, NEW.credit, NEW.is_excluded,
      NEW.resolution_tier, NEW.resolved_account_id, NEW.journal_entry_id,
      NEW.block_reason, NEW.suspense_reason)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.batch_id, OLD.txn_date, OLD.description, OLD.name,
      OLD.raw_account_type, OLD.debit, OLD.credit, OLD.is_excluded,
      OLD.resolution_tier, OLD.resolved_account_id, OLD.journal_entry_id,
      OLD.block_reason, OLD.suspense_reason)
  THEN
    RAISE EXCEPTION 'IMMUTABLE_POSTED_LINE: line % belongs to a posted batch; only suspense-clearing fields may change', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_posted_bank_line_edits ON public.bank_statement_lines;
CREATE TRIGGER trg_block_posted_bank_line_edits
  BEFORE UPDATE OR DELETE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_bank_line_edits();

-- A posted batch may only move to 'superseded' (by the void path) and record
-- its summary. Nothing else about it may change, and it may never be deleted.
CREATE OR REPLACE FUNCTION public.block_posted_bank_batch_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'IMMUTABLE_POSTED_BATCH: a posted batch cannot be deleted — void it instead'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'posted' THEN RETURN NEW; END IF;

  IF (NEW.tenant_id, NEW.bank_account_id, NEW.storage_path, NEW.sheet_periods,
      NEW.total_debit, NEW.total_credit, NEW.row_count, NEW.created_by)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.bank_account_id, OLD.storage_path, OLD.sheet_periods,
      OLD.total_debit, OLD.total_credit, OLD.row_count, OLD.created_by)
  THEN
    RAISE EXCEPTION 'IMMUTABLE_POSTED_BATCH: batch % is posted and its source facts are frozen', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status NOT IN ('posted', 'superseded') THEN
    RAISE EXCEPTION 'IMMUTABLE_POSTED_BATCH: a posted batch may only become superseded, not %', NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_posted_bank_batch_edits ON public.bank_statement_batches;
CREATE TRIGGER trg_block_posted_bank_batch_edits
  BEFORE UPDATE OR DELETE ON public.bank_statement_batches
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_bank_batch_edits();

-- ── 3. Concurrency: one live batch per bank account + period ───────────────
-- The edge function's idempotency check is read-then-write and two concurrent
-- imports could both pass it. This makes the database the arbiter.
CREATE TABLE IF NOT EXISTS public.bank_statement_batch_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  batch_id uuid NOT NULL REFERENCES public.bank_statement_batches(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- Partial unique index: at most one ACTIVE claim per account+period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_active_period
  ON public.bank_statement_batch_periods (bank_account_id, period_year, period_month)
  WHERE is_active;

ALTER TABLE public.bank_statement_batch_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_statement_batch_periods tenant all" ON public.bank_statement_batch_periods
  FOR ALL USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Claim the periods for a batch. Raises on collision, so a concurrent duplicate
-- import fails loudly instead of double-posting.
CREATE OR REPLACE FUNCTION public.claim_bank_statement_periods(
  p_batch_id UUID,
  p_periods  JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.bank_statement_batches;
  v_p     JSONB;
  v_n     INTEGER := 0;
BEGIN
  SELECT * INTO v_batch FROM public.bank_statement_batches WHERE id = p_batch_id;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_periods) LOOP
    BEGIN
      INSERT INTO public.bank_statement_batch_periods
        (tenant_id, batch_id, bank_account_id, period_month, period_year)
      VALUES (v_batch.tenant_id, p_batch_id, v_batch.bank_account_id,
              (v_p->>'month')::smallint, (v_p->>'year')::smallint);
      v_n := v_n + 1;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PERIOD_ALREADY_IMPORTED: %-% is already claimed by another batch for this bank account',
        v_p->>'year', v_p->>'month' USING ERRCODE = 'P0001';
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_bank_statement_periods(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 4. Void path — reverse a posted batch with balanced counter entries ────
CREATE OR REPLACE FUNCTION public.void_bank_statement_batch(
  p_batch_id UUID,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_tenant_id UUID;
  v_role      TEXT;
  v_batch     public.bank_statement_batches;
  v_je        RECORD;
  v_rev_id    UUID;
  v_reversed  INTEGER := 0;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot void a bank import', COALESCE(v_role, 'unknown');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a reason is required to void a posted batch' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_batch FROM public.bank_statement_batches
   WHERE id = p_batch_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_batch.status <> 'posted' THEN
    RAISE EXCEPTION 'NOT_POSTED: batch is %', v_batch.status USING ERRCODE = 'P0001';
  END IF;

  -- Refuse if any suspense line has already been cleared — those reclass
  -- entries would be orphaned by the reversal.
  IF EXISTS (SELECT 1 FROM public.bank_statement_lines
              WHERE batch_id = p_batch_id AND reclass_journal_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'HAS_RECLASSIFICATIONS: some suspense lines were already cleared; reverse those reclassifications first'
      USING ERRCODE = 'P0001';
  END IF;

  -- Same bulk suppression as posting: a void writes as many journal lines as
  -- the original import did, so the per-row budget recalc is equally fatal.
  PERFORM set_config('app.bank_import_bulk', '1', true);

  -- Mirror-image reversal per journal entry. Originals are never touched.
  FOR v_je IN
    SELECT je.id, je.entry_date, je.description
      FROM public.journal_entries je
      JOIN public.bank_statement_lines l ON l.journal_entry_id = je.id
     WHERE l.batch_id = p_batch_id AND je.status <> 'voided'
  LOOP
    -- source_id is the ORIGINAL journal entry, not the batch: idx_je_unique_source
    -- is UNIQUE on (source_type, source_id), so keying by batch would collide on
    -- the second reversal. Keying by the reversed entry is both correct
    -- semantically and makes double-voiding impossible at the index level.
    INSERT INTO public.journal_entries
      (tenant_id, entry_date, description, status, source_type, source_id,
       unique_key, reversal_of, is_system_generated, created_by, posted_at)
    VALUES (v_tenant_id, v_je.entry_date, 'REVERSAL: ' || v_je.description || ' — ' || btrim(p_reason),
            'posted', 'bank_import_void', v_je.id,
            'bank_import_void:' || v_je.id::text, v_je.id, true, v_user_id, now())
    RETURNING id INTO v_rev_id;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    SELECT v_rev_id, jl.account_id, jl.credit, jl.debit      -- sides swapped
      FROM public.journal_lines jl WHERE jl.journal_entry_id = v_je.id;

    v_reversed := v_reversed + 1;
  END LOOP;

  -- True budgets up once, then restore normal trigger behaviour.
  PERFORM set_config('app.bank_import_bulk', '0', true);
  PERFORM public.recalc_budget_for_bank_batch(p_batch_id);

  -- Close out the batch and release its periods for a clean re-import.
  UPDATE public.bank_statement_lines
     SET needs_reclassification = false
   WHERE batch_id = p_batch_id AND needs_reclassification;
  UPDATE public.bank_statement_batch_periods
     SET is_active = false WHERE batch_id = p_batch_id;
  UPDATE public.bank_statement_batches
     SET status = 'superseded',
         error_message = 'Voided: ' || btrim(p_reason)
   WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Bank Statement Batch Voided', 'bank_statement_batches', p_batch_id,
          jsonb_build_object('entries_reversed', v_reversed, 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('entries_reversed', v_reversed, 'batch_id', p_batch_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_bank_statement_batch(UUID, TEXT) TO authenticated;

-- ── 4b. Bulk-posting escape hatch for the budget trigger ───────────────────
-- trg_enforce_budget_on_journal_line is AFTER INSERT ... FOR EACH ROW and calls
-- recalc_budget_consumption(), which aggregates every journal_line for that
-- account+period. Posting one monthly statement inserts tens of thousands of
-- lines, so the recalc runs tens of thousands of times over an ever-growing
-- table — quadratic, and it blows the statement timeout well before finishing.
--
-- During a bank import we therefore suppress the PER-ROW work and recompute
-- each affected (account, period) exactly once at the end of the transaction.
-- The budget BLOCK check is also skipped, deliberately: a bank statement
-- records money that has already left the account, so refusing to record it
-- would not prevent the spend — it would only prevent the books reflecting
-- reality. Consumption is still trued up, so budget reporting stays correct.
--
-- Nothing changes for any other caller: without the session flag the function
-- behaves exactly as before.
CREATE OR REPLACE FUNCTION public.enforce_budget_on_journal_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_je journal_entries%ROWTYPE;
  v_acct accounts%ROWTYPE;
  v_amount numeric(18,2);
  v_result jsonb;
  v_ctrl budget_controls%ROWTYPE;
BEGIN
  -- Bulk bank import: defer to the single end-of-batch recalculation.
  IF current_setting('app.bank_import_bulk', true) = '1' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_je FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF v_je.status <> 'posted' THEN RETURN NEW; END IF;

  SELECT * INTO v_acct FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_acct.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense','Revenue','Income','Other Income') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ctrl FROM budget_controls WHERE tenant_id = v_je.tenant_id;

  IF FOUND AND v_ctrl.enforcement_mode = 'block' THEN
    IF v_acct.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN
      v_amount := NEW.debit - NEW.credit;
    ELSE
      v_amount := NEW.credit - NEW.debit;
    END IF;

    IF v_amount > 0 THEN
      v_result := public.validate_voucher_budget(
        v_je.tenant_id, NEW.account_id, v_amount, v_je.entry_date, NULL, NULL, NULL);
      IF (v_result->>'status') = 'block' THEN
        RAISE EXCEPTION 'Budget block: account % over budget for period % (allocated %, would total %).',
          v_acct.account_name, v_result->>'period', v_result->>'allocated', v_result->>'new_total';
      END IF;
    END IF;
  END IF;

  PERFORM public.recalc_budget_consumption(
    v_je.tenant_id, NEW.account_id,
    public.derive_period(v_je.entry_date,'monthly'),'monthly', NULL, NULL, NULL);

  RETURN NEW;
END; $$;

-- Recompute budget consumption once per (account, period) touched by a batch.
CREATE OR REPLACE FUNCTION public.recalc_budget_for_bank_batch(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_r RECORD; v_n INTEGER := 0;
BEGIN
  FOR v_r IN
    SELECT DISTINCT jl.account_id, je.tenant_id,
           public.derive_period(je.entry_date, 'monthly') AS period
      FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      JOIN public.bank_statement_lines l ON l.journal_entry_id = je.id
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE l.batch_id = p_batch_id
       AND je.status = 'posted'
       AND a.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Income','Other Income')
  LOOP
    PERFORM public.recalc_budget_consumption(
      v_r.tenant_id, v_r.account_id, v_r.period, 'monthly', NULL, NULL, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 5. Suspense balance / aging — for period close and the clearing screen ─
CREATE OR REPLACE FUNCTION public.bank_import_suspense_report(p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_out       JSONB;
BEGIN
  SELECT u.tenant_id INTO v_tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT jsonb_build_object(
    'open_count',     count(*),
    'open_value',     COALESCE(sum(l.debit + l.credit), 0),
    'money_out_value', COALESCE(sum(l.debit), 0),
    'money_in_value',  COALESCE(sum(l.credit), 0),
    'oldest_days',    COALESCE(max(p_as_of - l.txn_date), 0),
    'over_30_days',   count(*) FILTER (WHERE p_as_of - l.txn_date > 30),
    'by_reason',      COALESCE((
      SELECT jsonb_object_agg(r.suspense_reason, r.n) FROM (
        SELECT suspense_reason, count(*) n FROM public.bank_statement_lines
         WHERE tenant_id = v_tenant_id AND needs_reclassification
         GROUP BY suspense_reason) r), '{}'::jsonb))
  INTO v_out
  FROM public.bank_statement_lines l
  WHERE l.tenant_id = v_tenant_id AND l.needs_reclassification;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bank_import_suspense_report(DATE) TO authenticated;
