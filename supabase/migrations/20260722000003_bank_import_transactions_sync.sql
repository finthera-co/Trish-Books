-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — feed the denormalized `transactions` cash-flow table.
--
-- `transactions` is a simplified income/expense feed that powers the dashboard
-- Cash Flow chart (via the monthly_financials view). The system keeps it in
-- sync from journal entries with `sync_journal_to_transactions`, an AFTER
-- INSERT/UPDATE trigger on journal_entries that reads the entry's journal_lines.
--
-- Bank import posts each entry BEFORE its lines (the lines FK-reference the
-- entry), so when that trigger fired there were no lines yet — imported income
-- and expense never reached `transactions`, and the Cash Flow chart missed
-- every bank-imported figure. This is the fix.
--
-- Rather than edit the large posting / void / undo functions, we hang the sync
-- off the batch's own status transition — which those functions already flip at
-- exactly the right moment (after all lines and entries are in place):
--
--   • processing → posted           : build the transactions for the batch
--   • posted → superseded | undone  : remove them (reverse / undo)
--   • a line gains a reclass entry   : move its transaction to the final account
--
-- Two deliberate divergences from the legacy trigger, so bank-import figures are
-- actually correct: income is recognised on `Income`/`Other Income` accounts
-- (the legacy trigger checks the obsolete `Revenue` type, so income never
-- synced), and `Other Expense` counts as expense. Only the non-bank (category)
-- side of each entry is recorded, as income or expense.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Suppress the per-entry legacy sync during bulk bank import ───────────
-- The batch-level sync below does the work in one set-based pass; without this
-- the legacy trigger also fires once per imported entry (thousands of times),
-- each doing a delete + per-line loop, for nothing.
CREATE OR REPLACE FUNCTION public.sync_journal_to_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  line RECORD;
BEGIN
  IF current_setting('app.bank_import_bulk', true) = '1' THEN
    RETURN NEW;  -- bank import syncs the whole batch itself
  END IF;

  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status != 'posted') THEN
    DELETE FROM transactions WHERE source_type = 'journal_entry' AND source_id = NEW.id;
    FOR line IN
      SELECT jl.account_id, jl.debit, jl.credit, a.account_type, a.account_name
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = NEW.id
    LOOP
      IF line.debit > 0 AND line.account_type IN ('Expense', 'Cost of Goods Sold') THEN
        INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
        VALUES (NEW.tenant_id, NEW.entry_date, line.debit, 'expense', line.account_id, line.account_type, NEW.description, 'journal_entry', NEW.id);
      ELSIF line.credit > 0 AND line.account_type = 'Revenue' THEN
        INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
        VALUES (NEW.tenant_id, NEW.entry_date, line.credit, 'income', line.account_id, line.account_type, NEW.description, 'journal_entry', NEW.id);
      END IF;
    END LOOP;
  END IF;

  IF NEW.status = 'voided' AND (TG_OP = 'UPDATE' AND OLD.status != 'voided') THEN
    DELETE FROM transactions WHERE source_type = 'journal_entry' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. Build / rebuild the cash-flow rows for a whole posted batch ─────────
CREATE OR REPLACE FUNCTION public.sync_bank_batch_transactions(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bank UUID;
  v_n    INTEGER;
BEGIN
  SELECT bank_account_id INTO v_bank FROM public.bank_statement_batches WHERE id = p_batch_id;

  -- Idempotent: clear anything previously synced for this batch's entries.
  DELETE FROM public.transactions
   WHERE source_type = 'journal_entry'
     AND source_id IN (SELECT journal_entry_id FROM public.bank_statement_lines
                        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL);

  -- One income/expense row per posted line, from its CATEGORY side (the line
  -- that is not the bank account). Draft entries are skipped (not 'posted').
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
  RETURN v_n;
END;
$$;

-- ── 3. Drive it from the batch's status transition ─────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bank_batch_sync_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'posted' AND OLD.status = 'processing' THEN
    PERFORM public.sync_bank_batch_transactions(NEW.id);
  ELSIF NEW.status IN ('superseded', 'undone') AND OLD.status = 'posted' THEN
    DELETE FROM public.transactions
     WHERE source_type = 'journal_entry'
       AND source_id IN (SELECT journal_entry_id FROM public.bank_statement_lines
                          WHERE batch_id = NEW.id AND journal_entry_id IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_batch_sync_transactions ON public.bank_statement_batches;
CREATE TRIGGER trg_bank_batch_sync_transactions
  AFTER UPDATE OF status ON public.bank_statement_batches
  FOR EACH ROW EXECUTE FUNCTION public.trg_bank_batch_sync_transactions();

-- ── 4. When a suspense line is cleared, move its cash-flow row ─────────────
-- Clearing posts a reclass entry (final account ↔ suspense). Rebuild the line's
-- transaction from the FINAL account so the Cash Flow chart attributes it there.
-- If the final account is not an income/expense account (e.g. a fixed asset),
-- no row is written — correctly dropping it from the cash-flow feed. Low volume
-- (a user clears a handful at a time), so a per-row trigger is fine here.
CREATE OR REPLACE FUNCTION public.trg_bank_line_reclass_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.journal_entry_id IS NULL THEN RETURN NEW; END IF;

  DELETE FROM public.transactions
   WHERE source_type = 'journal_entry' AND source_id = NEW.journal_entry_id;

  INSERT INTO public.transactions
    (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
  SELECT je.tenant_id, je.entry_date,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN jl.debit ELSE jl.credit END,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN 'expense' ELSE 'income' END,
         jl.account_id, a.account_type, je.description, 'journal_entry', NEW.journal_entry_id
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = NEW.reclass_journal_entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE jl.journal_entry_id = NEW.reclass_journal_entry_id
     AND COALESCE(a.account_subtype, '') <> 'Suspense'
     AND ( (a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') AND jl.debit > 0)
        OR (a.account_type IN ('Income','Other Income') AND jl.credit > 0) );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_line_reclass_sync ON public.bank_statement_lines;
CREATE TRIGGER trg_bank_line_reclass_sync
  AFTER UPDATE OF reclass_journal_entry_id ON public.bank_statement_lines
  FOR EACH ROW
  WHEN (NEW.reclass_journal_entry_id IS NOT NULL AND OLD.reclass_journal_entry_id IS DISTINCT FROM NEW.reclass_journal_entry_id)
  EXECUTE FUNCTION public.trg_bank_line_reclass_sync();
