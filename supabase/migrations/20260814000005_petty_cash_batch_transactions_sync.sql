-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — sync the cash-flow `transactions` rows per batch
--
-- sync_journal_to_transactions runs once per journal ENTRY and, for each, does
-- a DELETE followed by a cursor loop over that entry's lines. That is cheap for
-- the few hundred entries a voucher-grouped import produces, which is why the
-- petty cash import deliberately let it run.
--
-- grouping_mode='row' changes the arithmetic: one voucher per sheet row means
-- 2,000 entries, so the trigger fires 2,000 times and became the dominant cost
-- once the posting loop itself was removed — 11.2 s of an 8 s budget.
--
-- Same fix the bank import already uses: suppress the per-entry trigger during
-- a bulk import and rebuild the whole batch's rows in one set-based pass. The
-- existing app.bank_import_bulk check is preserved untouched.
-- ═══════════════════════════════════════════════════════════════════════════

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

  IF current_setting('app.pc_import_bulk', true) = '1' THEN
    RETURN NEW;  -- petty cash import syncs the whole batch itself
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

-- Rebuild every cash-flow row for a batch: its own entries and any reversals
-- of them, so post and revert can both call this.
CREATE OR REPLACE FUNCTION public.sync_pc_import_batch_transactions(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fund_gl UUID;
  v_n       INTEGER;
BEGIN
  SELECT pca.account_id INTO v_fund_gl
  FROM petty_cash_import_batches b
  JOIN petty_cash_accounts pca ON pca.id = b.petty_cash_account_id
  WHERE b.id = p_batch_id;

  CREATE TEMP TABLE _pc_sync_entries ON COMMIT DROP AS
  WITH own AS (
    SELECT DISTINCT journal_entry_id AS id
    FROM petty_cash_import_lines
    WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL
  )
  SELECT je.id
  FROM journal_entries je
  WHERE je.status = 'posted'
    AND (je.id IN (SELECT id FROM own) OR je.reversal_of IN (SELECT id FROM own));

  -- Idempotent: a re-run replaces rather than duplicates.
  DELETE FROM transactions
  WHERE source_type = 'journal_entry'
    AND source_id IN (SELECT id FROM _pc_sync_entries);

  -- One row per contra line — the side that is not the petty cash fund.
  INSERT INTO transactions
    (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
  SELECT je.tenant_id, je.entry_date,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense')
              THEN jl.debit ELSE jl.credit END,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense')
              THEN 'expense' ELSE 'income' END,
         jl.account_id, a.account_type, je.description, 'journal_entry', je.id
  FROM _pc_sync_entries e
  JOIN journal_entries je ON je.id = e.id
  JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.account_id <> v_fund_gl
  JOIN accounts a ON a.id = jl.account_id
  WHERE ( (a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') AND jl.debit > 0)
       OR (a.account_type IN ('Income','Other Income') AND jl.credit > 0) );
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DROP TABLE IF EXISTS _pc_sync_entries;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.sync_pc_import_batch_transactions(UUID) IS
  'Rebuilds the cash-flow `transactions` rows for a petty cash import batch and any reversals of its entries, in one set-based pass. Replaces the per-entry trigger, which is suppressed during bulk import.';

-- Reversal creates a second entry per original, so it needs the same treatment.
CREATE OR REPLACE FUNCTION public.revert_petty_cash_import_batch(
  p_batch_id UUID,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID := get_user_tenant_id();
  v_b        petty_cash_import_batches%ROWTYPE;
  v_user     UUID;
  v_fund_gl  UUID;
  e          RECORD;
  v_rev_date DATE;
  v_new_je   UUID;
  v_entries  INTEGER := 0;
  v_vouchers INTEGER := 0;
  v_net      NUMERIC(14,2) := 0;
BEGIN
  SELECT * INTO v_b FROM petty_cash_import_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % does not exist', p_batch_id;
  END IF;
  IF v_b.tenant_id <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: import batch % belongs to another tenant', p_batch_id;
  END IF;
  IF v_b.status <> 'posted' THEN
    RAISE EXCEPTION 'BATCH_NOT_POSTED: only a posted batch can be reversed (batch is %)', v_b.status;
  END IF;

  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();
  SELECT account_id INTO v_fund_gl FROM petty_cash_accounts WHERE id = v_b.petty_cash_account_id;

  PERFORM set_config('app.pc_import_bulk', '1', true);

  FOR e IN
    SELECT je.id, je.entry_date, je.description, je.reference, je.entry_type
    FROM journal_entries je
    WHERE je.tenant_id = v_b.tenant_id
      AND je.status = 'posted'
      AND je.id IN (
        SELECT DISTINCT journal_entry_id
        FROM petty_cash_import_lines
        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL
      )
    ORDER BY je.entry_date, je.id
  LOOP
    IF EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.tenant_id = v_b.tenant_id AND fp.status = 'closed'
        AND e.entry_date BETWEEN fp.period_start AND fp.period_end
    ) THEN
      SELECT min(fp.period_start) INTO v_rev_date
      FROM fiscal_periods fp
      WHERE fp.tenant_id = v_b.tenant_id
        AND fp.status <> 'closed'
        AND fp.period_start > e.entry_date;

      IF v_rev_date IS NULL THEN
        RAISE EXCEPTION
          'PERIOD_LOCKED: entry % sits in a closed period (%) and there is no open period after it to date the reversal into. Reopen the period first.',
          e.reference, e.entry_date;
      END IF;
    ELSE
      v_rev_date := e.entry_date;
    END IF;

    INSERT INTO journal_entries
      (tenant_id, entry_date, description, reference, status, posted_at,
       is_system_generated, entry_type, cash_flow_category,
       source_type, source_id, reversal_of, created_by)
    VALUES
      (v_b.tenant_id, v_rev_date,
       'Reversal: ' || e.description,
       'REV-' || coalesce(e.reference, e.id::TEXT),
       'posted', now(), true, e.entry_type || '_reversal', 'operating',
       'petty_cash_import_reversal', e.id, e.id, v_user)
    RETURNING id INTO v_new_je;

    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    SELECT v_new_je, v_b.tenant_id, jl.account_id, jl.credit, jl.debit, jl.memo
    FROM journal_lines jl
    WHERE jl.journal_entry_id = e.id;

    SELECT v_net + coalesce(sum(jl.debit - jl.credit), 0) INTO v_net
    FROM journal_lines jl
    WHERE jl.journal_entry_id = e.id AND jl.account_id = v_fund_gl;

    v_entries := v_entries + 1;
  END LOOP;

  UPDATE petty_cash_vouchers v
  SET status = 'reversed', reversed_at = now()
  FROM petty_cash_import_lines l
  WHERE l.batch_id = p_batch_id
    AND l.voucher_id = v.id
    AND v.tenant_id = v_b.tenant_id
    AND v.status <> 'reversed';
  GET DIAGNOSTICS v_vouchers = ROW_COUNT;

  UPDATE petty_cash_import_batches
  SET status = 'reverted', reverted_at = now(),
      notes = coalesce(notes || E'\n', '') || 'Reversed: ' || coalesce(p_reason, '')
  WHERE id = p_batch_id;

  PERFORM recalc_budget_for_pc_import_batch(p_batch_id);
  PERFORM sync_pc_import_batch_transactions(p_batch_id);
  PERFORM set_config('app.pc_import_bulk', '0', true);

  RETURN jsonb_build_object(
    'batch_id',         p_batch_id,
    'entries_reversed', v_entries,
    'vouchers_reversed', v_vouchers,
    'net_reversed',     v_net,
    'closing_balance',  get_petty_cash_balance(v_b.petty_cash_account_id),
    'hash_released',    true
  );
END;
$$;
