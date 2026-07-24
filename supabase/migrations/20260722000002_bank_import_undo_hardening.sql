-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — make Undo / Reverse safe for a real ledger.
--
-- Hard-deleting or reversing posted GL entries is only safe under conditions a
-- production accounting system must enforce:
--
--   • CLOSED PERIODS. Entries in a closed fiscal period are immutable. Neither
--     Undo (delete) nor Reverse (post into the closed period) may touch them —
--     the period must be reopened first. This mirrors every serious ERP.
--
--   • RECONCILED LINES. A bank-import line matched during bank reconciliation is
--     referenced by bank_feed_transactions / reconciliation_transactions.
--     Deleting it would orphan the reconciliation (or fail on the FK). Undo is
--     refused; the user unreconciles first, or uses Reverse (which keeps the
--     original line the reconciliation points at).
--
-- Without these guards Undo could silently corrupt a closed period, and a
-- reconciled-line Undo would abort with an opaque foreign-key error instead of
-- a clear instruction. Both RPCs now fail fast with actionable messages.
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

  -- Guard 1: already-cleared suspense items.
  IF EXISTS (SELECT 1 FROM public.bank_statement_lines
              WHERE batch_id = p_batch_id AND reclass_journal_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'HAS_RECLASSIFICATIONS: some items were already cleared from Suspense; use Reverse instead of Undo'
      USING ERRCODE = 'P0001';
  END IF;

  -- Guard 2: closed fiscal period. Deleting posted entries from a closed period
  -- is forbidden — reopen the period first.
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

  v_je_ids := (SELECT array_agg(journal_entry_id) FROM public.bank_statement_lines
                WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL);

  -- Guard 3: bank-reconciled lines. Deleting a matched line would orphan the
  -- reconciliation; keep the line (Reverse) or unreconcile first.
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

  DELETE FROM public.bank_statement_lines WHERE batch_id = p_batch_id;

  IF v_je_ids IS NOT NULL THEN
    DELETE FROM public.transactions
     WHERE source_type = 'journal_entry' AND source_id = ANY (v_je_ids);
    DELETE FROM public.journal_entries WHERE id = ANY (v_je_ids);
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

-- Reverse must also respect closed periods: it posts entries dated on the
-- originals, so a closed original period would take a new posting. Block it —
-- reopen first. (Reconciliation is safe for Reverse: the original line stays.)
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
  v_n         INTEGER;
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

  SELECT count(*) INTO v_n
    FROM public.bank_statement_lines l
    JOIN public.fiscal_periods fp
      ON fp.tenant_id = l.tenant_id AND fp.status = 'closed'
     AND l.txn_date BETWEEN fp.period_start AND fp.period_end
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CLOSED_PERIOD: % line(s) fall in a closed fiscal period; reopen the period before reversing', v_n
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
