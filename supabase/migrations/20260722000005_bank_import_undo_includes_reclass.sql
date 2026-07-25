-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — Undo now removes reclassifications too.
--
-- Previously Undo refused when any Suspense item had already been cleared
-- (HAS_RECLASSIFICATIONS), to avoid orphaning the reclass entries. But the
-- intended meaning of "undo this import" is: take back EVERYTHING that resulted
-- from it — the original postings AND any suspense-clearing reclass entries —
-- so the month is truly as if it was never imported.
--
-- Undo therefore now deletes both the posting entries and the reclass entries.
-- The genuinely-unsafe guards remain: a closed fiscal period, or a line that
-- has been bank-reconciled, still block the delete (reopen / unreconcile, or
-- use Reverse). Only a posted batch can be undone.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_n         INTEGER;
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

  -- Closed fiscal period: deleting posted entries there is forbidden.
  SELECT count(*) INTO v_n
    FROM public.bank_statement_lines l
    JOIN public.fiscal_periods fp
      ON fp.tenant_id = l.tenant_id AND fp.status = 'closed'
     AND l.txn_date BETWEEN fp.period_start AND fp.period_end
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CLOSED_PERIOD: % line(s) fall in a closed fiscal period and cannot be deleted; reopen the period first', v_n
      USING ERRCODE = 'P0001';
  END IF;

  -- All entries this import produced: the postings AND any reclass entries from
  -- clearing Suspense. Both are deleted so nothing is orphaned.
  v_je_ids := (
    SELECT array_agg(DISTINCT je_id) FROM (
      SELECT journal_entry_id AS je_id FROM public.bank_statement_lines
        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL
      UNION
      SELECT reclass_journal_entry_id FROM public.bank_statement_lines
        WHERE batch_id = p_batch_id AND reclass_journal_entry_id IS NOT NULL
    ) x
  );

  -- Bank-reconciled lines (posting OR reclass) still block a delete.
  IF v_je_ids IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.journal_lines jl
     WHERE jl.journal_entry_id = ANY (v_je_ids)
       AND (EXISTS (SELECT 1 FROM public.bank_feed_transactions b WHERE b.matched_journal_line_id = jl.id)
         OR EXISTS (SELECT 1 FROM public.reconciliation_transactions rt WHERE rt.journal_line_id = jl.id));
    IF v_n > 0 THEN
      RAISE EXCEPTION 'RECONCILED: % line(s) from this import have been bank-reconciled; unreconcile them or use Reverse', v_n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Budget cache pairs to rebuild after deletion.
  SELECT jsonb_agg(DISTINCT jsonb_build_object(
           'account_id', jl.account_id,
           'period', public.derive_period(je.entry_date, 'monthly')))
    INTO v_affected
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE jl.journal_entry_id = ANY (v_je_ids)
     AND a.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Income','Other Income');

  UPDATE public.bank_statement_batches
     SET status = 'undone', voided_at = now(), voided_by = v_user_id,
         void_reason = NULLIF(btrim(p_reason), ''), void_kind = 'deleted'
   WHERE id = p_batch_id;

  -- Lines first (they FK-reference both journal entries, no cascade).
  DELETE FROM public.bank_statement_lines WHERE batch_id = p_batch_id;

  IF v_je_ids IS NOT NULL THEN
    DELETE FROM public.transactions
     WHERE source_type = 'journal_entry' AND source_id = ANY (v_je_ids);
    DELETE FROM public.journal_entries WHERE id = ANY (v_je_ids);  -- lines cascade
    GET DIAGNOSTICS v_deleted_je = ROW_COUNT;
  END IF;

  UPDATE public.bank_statement_batch_periods SET is_active = false WHERE batch_id = p_batch_id;

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
