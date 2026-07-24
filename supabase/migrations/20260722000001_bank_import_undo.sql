-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — Undo an import.
--
-- Two ways to reverse a posted import already exist / are added here:
--
--   • void_bank_statement_batch  (existing) — REVERSES with mirror journal
--     entries. Originals stay; use it once real activity has built on top of an
--     import, so the audit trail is preserved.
--
--   • undo_bank_statement_batch  (new) — DELETES everything the import created:
--     the journal entries (lines cascade), the statement lines, and it releases
--     the period. Use it to truly take back a fresh import (wrong file, wrong
--     month) so it is as if it never happened. Standard "undo import" behaviour.
--
-- The batch row is KEPT either way, as the persistent record ("memory") of what
-- was imported and what happened to it — status 'undone', with who/when/why and
-- the summary counts retained. Undo is refused once any suspense line has been
-- reclassified, because those are real decisions layered on top; reverse then.
-- ═══════════════════════════════════════════════════════════════════════════

-- Status can now also be 'undone'.
ALTER TABLE public.bank_statement_batches DROP CONSTRAINT IF EXISTS bank_statement_batches_status_check;
ALTER TABLE public.bank_statement_batches
  ADD CONSTRAINT bank_statement_batches_status_check
  CHECK (status IN ('processing', 'posted', 'failed', 'superseded', 'undone'));

ALTER TABLE public.bank_statement_batches
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS void_kind text CHECK (void_kind IN ('reversed', 'deleted'));

-- Allow the posted → undone transition in the immutability guard.
CREATE OR REPLACE FUNCTION public.block_posted_bank_batch_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'IMMUTABLE_POSTED_BATCH: a posted batch cannot be deleted — void or undo it instead'
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

  IF NEW.status NOT IN ('posted', 'superseded', 'undone') THEN
    RAISE EXCEPTION 'IMMUTABLE_POSTED_BATCH: a posted batch may only become superseded or undone, not %', NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ── undo_bank_statement_batch ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.undo_bank_statement_batch(
  p_batch_id UUID,
  p_reason   TEXT DEFAULT NULL
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
  v_je_ids    UUID[];
  v_affected  JSONB;
  v_r         RECORD;
  v_deleted_je INTEGER := 0;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot undo a bank import', COALESCE(v_role, 'unknown');
  END IF;

  SELECT * INTO v_batch FROM public.bank_statement_batches
   WHERE id = p_batch_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_batch.status <> 'posted' THEN
    RAISE EXCEPTION 'NOT_POSTED: batch is %; only a posted import can be undone', v_batch.status USING ERRCODE = 'P0001';
  END IF;

  -- Refuse if any suspense line was already cleared — those reclass entries are
  -- real decisions and would be orphaned. Reverse the batch instead.
  IF EXISTS (SELECT 1 FROM public.bank_statement_lines
              WHERE batch_id = p_batch_id AND reclass_journal_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'HAS_RECLASSIFICATIONS: some items were already cleared from Suspense; use Reverse instead of Undo'
      USING ERRCODE = 'P0001';
  END IF;

  -- Journal entries this batch created.
  SELECT array_agg(journal_entry_id) INTO v_je_ids
    FROM public.bank_statement_lines
   WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL;

  -- Capture the (account, period) pairs whose budget cache must be rebuilt
  -- AFTER the entries are gone.
  SELECT jsonb_agg(DISTINCT jsonb_build_object(
           'account_id', jl.account_id,
           'period', public.derive_period(je.entry_date, 'monthly')))
    INTO v_affected
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE jl.journal_entry_id = ANY (v_je_ids)
     AND a.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Income','Other Income');

  -- Flip the batch out of 'posted' FIRST so the line-immutability trigger
  -- permits the deletes below.
  UPDATE public.bank_statement_batches
     SET status = 'undone', voided_at = now(), voided_by = v_user_id,
         void_reason = NULLIF(btrim(p_reason), ''), void_kind = 'deleted'
   WHERE id = p_batch_id;

  -- Remove the parsed statement lines FIRST: they FK-reference journal_entries
  -- (no cascade), so the entries cannot be deleted while the lines point at
  -- them. The batch summary retains the aggregate memory of what was imported.
  DELETE FROM public.bank_statement_lines WHERE batch_id = p_batch_id;

  IF v_je_ids IS NOT NULL THEN
    -- Any synced cash-flow rows (defensive — bank imports don't currently sync).
    DELETE FROM public.transactions
     WHERE source_type = 'journal_entry' AND source_id = ANY (v_je_ids);
    -- Delete the journal entries; journal_lines cascade via FK.
    DELETE FROM public.journal_entries WHERE id = ANY (v_je_ids);
    GET DIAGNOSTICS v_deleted_je = ROW_COUNT;
  END IF;

  -- Release the period so it can be cleanly re-imported.
  UPDATE public.bank_statement_batch_periods SET is_active = false WHERE batch_id = p_batch_id;

  -- Rebuild the budget consumption cache for each affected account+period.
  IF v_affected IS NOT NULL THEN
    FOR v_r IN SELECT * FROM jsonb_array_elements(v_affected) e LOOP
      PERFORM public.recalc_budget_consumption(
        v_tenant_id, (v_r.value->>'account_id')::uuid, v_r.value->>'period', 'monthly', NULL, NULL, NULL);
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Bank Statement Batch Undone', 'bank_statement_batches', p_batch_id,
          jsonb_build_object('journal_entries_deleted', v_deleted_je,
                             'reason', NULLIF(btrim(p_reason), ''),
                             'summary', v_batch.summary));

  RETURN jsonb_build_object('journal_entries_deleted', v_deleted_je, 'batch_id', p_batch_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_bank_statement_batch(UUID, TEXT) TO authenticated;

-- Tag reversals so the UI can tell "reversed" from "deleted".
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

  IF EXISTS (SELECT 1 FROM public.bank_statement_lines
              WHERE batch_id = p_batch_id AND reclass_journal_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'HAS_RECLASSIFICATIONS: some suspense lines were already cleared; reverse those reclassifications first'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.bank_import_bulk', '1', true);

  FOR v_je IN
    SELECT je.id, je.entry_date, je.description
      FROM public.journal_entries je
      JOIN public.bank_statement_lines l ON l.journal_entry_id = je.id
     WHERE l.batch_id = p_batch_id AND je.status <> 'voided'
  LOOP
    INSERT INTO public.journal_entries
      (tenant_id, entry_date, description, status, source_type, source_id,
       unique_key, reversal_of, is_system_generated, created_by, posted_at)
    VALUES (v_tenant_id, v_je.entry_date, 'REVERSAL: ' || v_je.description || ' — ' || btrim(p_reason),
            'posted', 'bank_import_void', v_je.id,
            'bank_import_void:' || v_je.id::text, v_je.id, true, v_user_id, now())
    RETURNING id INTO v_rev_id;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    SELECT v_rev_id, jl.account_id, jl.credit, jl.debit
      FROM public.journal_lines jl WHERE jl.journal_entry_id = v_je.id;

    v_reversed := v_reversed + 1;
  END LOOP;

  PERFORM set_config('app.bank_import_bulk', '0', true);
  PERFORM public.recalc_budget_for_bank_batch(p_batch_id);

  UPDATE public.bank_statement_lines
     SET needs_reclassification = false
   WHERE batch_id = p_batch_id AND needs_reclassification;
  UPDATE public.bank_statement_batch_periods
     SET is_active = false WHERE batch_id = p_batch_id;
  UPDATE public.bank_statement_batches
     SET status = 'superseded', void_kind = 'reversed', voided_at = now(),
         voided_by = v_user_id, void_reason = btrim(p_reason),
         error_message = 'Voided: ' || btrim(p_reason)
   WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Bank Statement Batch Voided', 'bank_statement_batches', p_batch_id,
          jsonb_build_object('entries_reversed', v_reversed, 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('entries_reversed', v_reversed, 'batch_id', p_batch_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_bank_statement_batch(UUID, TEXT) TO authenticated;
