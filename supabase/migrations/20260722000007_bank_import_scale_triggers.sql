-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — make bulk posting scale (50k+ lines per bank).
--
-- The ledger's denormalized caches are maintained by PER-ROW triggers that each
-- run an aggregate. On a bulk import that turns every insert into an O(n)
-- recompute — O(n²) overall — and a large statement times out. Two remained
-- after the earlier budget fix:
--
--   • trigger_update_daily_balance (on transactions) — recomputes a whole day's
--     balance for every row. Fired thousands of times during the transactions
--     sync (which runs AFTER the bulk flag was cleared) → the timeout we hit.
--   • fn_prevent_posting_non_postable (on journal_lines) — a per-line account
--     lookup the posting RPC has already guaranteed.
--
-- Both now early-return under app.bank_import_bulk = '1'. The daily-balance
-- cache is instead rebuilt ONCE, set-based, for every date from the earliest
-- affected day forward (running balances stay correct). The transactions sync
-- holds the bulk flag across its own inserts and does that rebuild itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Per-row cache triggers: skip during bulk bank import ────────────────
CREATE OR REPLACE FUNCTION public.trigger_update_daily_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.bank_import_bulk', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);   -- daily balances rebuilt in one pass afterwards
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_daily_balance(OLD.tenant_id, OLD.date);
    RETURN OLD;
  ELSE
    PERFORM recalculate_daily_balance(NEW.tenant_id, NEW.date);
    RETURN NEW;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_prevent_posting_non_postable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_postable BOOLEAN;
  v_acct_label  TEXT;
BEGIN
  -- Bank import posts only to accounts it has already verified are active,
  -- postable leaves (see import_bank_statement_post). Skip the per-line lookup.
  IF current_setting('app.bank_import_bulk', true) = '1' THEN
    RETURN NEW;
  END IF;
  SELECT is_postable, account_code || ' ' || account_name
    INTO v_is_postable, v_acct_label
  FROM public.accounts WHERE id = NEW.account_id;
  IF v_is_postable = FALSE THEN
    RAISE EXCEPTION
      'POSTING_VIOLATION: Account % is a summary/parent account (is_postable = false). Post to one of its child accounts instead.',
      v_acct_label USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Set-based daily-balance rebuild from a start date ───────────────────
-- Recomputes every transaction-bearing date >= p_from, in order, so the running
-- closing balances are correct after a bulk change. O(distinct dates), not
-- O(rows) — a full financial year is ~365 cheap aggregates, done once.
CREATE OR REPLACE FUNCTION public.recalc_daily_balances_from(p_tenant_id UUID, p_from DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_d DATE; v_n INTEGER := 0;
BEGIN
  IF p_from IS NULL THEN RETURN 0; END IF;
  FOR v_d IN
    SELECT DISTINCT date FROM public.transactions
     WHERE tenant_id = p_tenant_id AND date >= p_from
     ORDER BY date
  LOOP
    PERFORM public.recalculate_daily_balance(p_tenant_id, v_d);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 3. Transactions sync: hold the bulk flag across its inserts, then rebuild
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

  -- Suppress the per-row daily-balance trigger across our bulk insert/delete.
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

  -- Rebuild daily balances once, from the earliest date this batch touched.
  SELECT min(date) INTO v_min FROM public.transactions
   WHERE tenant_id = v_tenant AND source_type = 'journal_entry'
     AND source_id IN (SELECT journal_entry_id FROM public.bank_statement_lines
                        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL);
  PERFORM public.recalc_daily_balances_from(v_tenant, v_min);

  PERFORM set_config('app.bank_import_bulk', COALESCE(NULLIF(v_prev, ''), '0'), true);
  RETURN v_n;
END;
$$;
