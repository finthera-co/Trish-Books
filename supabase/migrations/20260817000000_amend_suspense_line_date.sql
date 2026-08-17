-- ═══════════════════════════════════════════════════════════════════════════
-- SUSPENSE CLEARING — correct the transaction date of an OPEN suspense line.
--
-- A bank statement can carry a wrong or mis-parsed date, and the accountant
-- only notices it on the clearing screen. Fixing it must move the WHOLE
-- record, not just the display: the statement line, the suspense journal it
-- posted, and the transactions mirror all carry the date, and the reclass
-- journal is dated from the line. Anything less leaves the ledger and the
-- import disagreeing about when the money moved.
--
-- Posted statement lines are otherwise immutable (block_posted_bank_line_edits).
-- That guard stays; this adds one narrow, flagged carve-out for txn_date on a
-- line that is still an open suspense item — i.e. nothing has been reclassified
-- off it yet, so no downstream entry depends on the old date.
-- ═══════════════════════════════════════════════════════════════════════════

-- What the import actually read, kept the first time a date is corrected so
-- the amendment is visible on the row rather than only in the audit log.
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS txn_date_original date;

COMMENT ON COLUMN public.bank_statement_lines.txn_date_original IS
  'Date as imported, stamped on the first amendment by amend_suspense_line_date(). NULL = never re-dated.';

-- ── Immutability guard, with the carve-out ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_posted_bank_line_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status   TEXT;
  v_amending BOOLEAN;
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

  -- txn_date may move only under amend_suspense_line_date(), which sets this
  -- transaction-local flag and re-dates the suspense journal in the same
  -- transaction — and only while the line is still an OPEN suspense item.
  v_amending := COALESCE(current_setting('app.bank_line_date_amend', true), '') = '1'
                AND OLD.needs_reclassification
                AND OLD.reclass_journal_entry_id IS NULL;

  -- Everything except the clearing-outcome fields must be unchanged.
  IF (NEW.tenant_id, NEW.batch_id,
      CASE WHEN v_amending THEN OLD.txn_date ELSE NEW.txn_date END,
      NEW.description, NEW.name,
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

-- ── The amendment itself ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.amend_suspense_line_date(
  p_line_id  UUID,
  p_txn_date DATE
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
  v_line      public.bank_statement_lines;
  v_je        public.journal_entries;
  v_old       DATE;
  v_imported  DATE;
  r           RECORD;
BEGIN
  SELECT u.id, u.tenant_id, ro.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u
    LEFT JOIN public.roles ro ON ro.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot re-date suspense items', COALESCE(v_role, 'unknown');
  END IF;

  IF p_txn_date IS NULL THEN
    RAISE EXCEPTION 'DATE_REQUIRED: a transaction date is required';
  END IF;
  -- A bank line cannot have happened after today; a typo'd year is the most
  -- common way this screen would otherwise post into a future period.
  IF p_txn_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'DATE_IN_FUTURE: % is in the future', p_txn_date USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_line FROM public.bank_statement_lines
   WHERE id = p_line_id AND tenant_id = v_tenant_id
   FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'LINE_NOT_FOUND'; END IF;
  IF NOT v_line.needs_reclassification OR v_line.reclass_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_NOT_OPEN: only an open suspense item can be re-dated — this one is already cleared'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_line.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'LINE_NOT_POSTED: line % has no suspense journal', v_line.id;
  END IF;

  v_old := v_line.txn_date;
  IF v_old IS NOT DISTINCT FROM p_txn_date THEN
    RETURN jsonb_build_object('changed', false, 'txn_date', p_txn_date,
                              'previous_txn_date', v_old);
  END IF;

  -- Both ends must be open: the entry may not land in a closed period, and it
  -- may not be lifted out of one either.
  IF EXISTS (SELECT 1 FROM public.fiscal_periods fp
              WHERE fp.tenant_id = v_tenant_id AND fp.status = 'closed'
                AND p_txn_date BETWEEN fp.period_start AND fp.period_end) THEN
    RAISE EXCEPTION 'CLOSED_PERIOD: % falls in a closed fiscal period', p_txn_date
      USING ERRCODE = 'P0001';
  END IF;
  IF v_old IS NOT NULL AND EXISTS (SELECT 1 FROM public.fiscal_periods fp
              WHERE fp.tenant_id = v_tenant_id AND fp.status = 'closed'
                AND v_old BETWEEN fp.period_start AND fp.period_end) THEN
    RAISE EXCEPTION 'CLOSED_PERIOD_SOURCE: the entry currently sits in a closed fiscal period (%) — reopen it before moving the entry out', v_old
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE id = v_line.journal_entry_id AND tenant_id = v_tenant_id
   FOR UPDATE;
  IF v_je.id IS NULL THEN RAISE EXCEPTION 'JOURNAL_NOT_FOUND'; END IF;
  IF v_je.status = 'voided' THEN
    RAISE EXCEPTION 'JOURNAL_VOIDED: the suspense journal for this line has been voided'
      USING ERRCODE = 'P0001';
  END IF;

  v_imported := COALESCE(v_line.txn_date_original, v_old);

  PERFORM set_config('app.bank_line_date_amend', '1', true);
  UPDATE public.bank_statement_lines
     SET txn_date = p_txn_date,
         txn_date_original = v_imported
   WHERE id = v_line.id;
  PERFORM set_config('app.bank_line_date_amend', '0', true);

  -- The ledger side. The reclass journal is dated from the line, so it will
  -- follow automatically when this item is cleared.
  UPDATE public.journal_entries SET entry_date = p_txn_date WHERE id = v_je.id;

  -- transactions is only re-synced when a journal CHANGES STATUS
  -- (sync_journal_to_transactions), so an already-posted entry's mirror has to
  -- be moved here or the dashboards keep the old month.
  UPDATE public.transactions SET date = p_txn_date
   WHERE source_type = 'journal_entry' AND source_id = v_je.id;

  -- The suspense side is an Expense/Income account, so its budget consumption
  -- changes month. True up the month it left and the month it lands in.
  FOR r IN
    SELECT DISTINCT jl.account_id, a.account_type
      FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.journal_entry_id = v_je.id
  LOOP
    IF r.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Revenue','Income','Other Income') THEN
      IF v_old IS NOT NULL THEN
        PERFORM public.recalc_budget_consumption(
          v_tenant_id, r.account_id, public.derive_period(v_old, 'monthly'), 'monthly', NULL, NULL, NULL);
      END IF;
      PERFORM public.recalc_budget_consumption(
        v_tenant_id, r.account_id, public.derive_period(p_txn_date, 'monthly'), 'monthly', NULL, NULL, NULL);
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Suspense Line Re-dated', 'bank_statement_lines', v_line.id,
          jsonb_build_object('from', v_old, 'to', p_txn_date,
                             'imported_date', v_imported,
                             'batch_id', v_line.batch_id,
                             'journal_entry_id', v_je.id));

  RETURN jsonb_build_object('changed', true, 'txn_date', p_txn_date,
                            'previous_txn_date', v_old, 'imported_date', v_imported,
                            'journal_entry_id', v_je.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.amend_suspense_line_date(UUID, DATE) TO authenticated;
