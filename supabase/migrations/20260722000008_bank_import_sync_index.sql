-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — index the transactions sync + take the min date from the
-- indexed source.
--
-- sync_bank_batch_transactions matched `transactions` rows by (source_type,
-- source_id) with no index, and derived the batch's earliest date by joining
-- 50k journal-entry ids back through transactions — a scan that timed out on a
-- full-year import. The earliest date is already available, indexed, on
-- bank_statement_lines(batch_id); use it. Add the source index so the sync's
-- idempotent delete (and the undo/void cleanups) stay fast at scale.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_transactions_source
  ON public.transactions (source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_bank_batch_transactions(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bank    UUID;
  v_tenant  UUID;
  v_min     DATE;
  v_prev    TEXT;
  v_n       INTEGER;
BEGIN
  SELECT bank_account_id, tenant_id INTO v_bank, v_tenant
    FROM public.bank_statement_batches WHERE id = p_batch_id;

  v_prev := current_setting('app.bank_import_bulk', true);
  PERFORM set_config('app.bank_import_bulk', '1', true);

  DELETE FROM public.transactions
   WHERE source_type = 'journal_entry'
     AND source_id IN (SELECT journal_entry_id FROM public.bank_statement_lines
                        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL);

  INSERT INTO public.transactions
    (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
  SELECT je.tenant_id, je.entry_date,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN jl.debit ELSE jl.credit END,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN 'expense' ELSE 'income' END,
         jl.account_id, a.account_type, je.description, 'journal_entry', je.id
    FROM public.bank_statement_lines l
    JOIN public.journal_entries je ON je.id = l.journal_entry_id AND je.status = 'posted'
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id AND jl.account_id <> v_bank
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE l.batch_id = p_batch_id
     AND ( (a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') AND jl.debit > 0)
        OR (a.account_type IN ('Income','Other Income') AND jl.credit > 0) );
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Earliest date this batch touched — straight from the indexed statement
  -- lines, not by joining through the freshly-inserted transactions.
  SELECT min(l.txn_date) INTO v_min FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;
  PERFORM public.recalc_daily_balances_from(v_tenant, v_min);

  PERFORM set_config('app.bank_import_bulk', COALESCE(NULLIF(v_prev, ''), '0'), true);
  RETURN v_n;
END;
$$;
