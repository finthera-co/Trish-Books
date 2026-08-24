-- A real Statement of Financial Position on the fs_lines engine.
--
-- The SOCI's "memorandum" block (20260816000001 onward) parks balance-sheet
-- accounts on four flat lines (Assets/Liabilities/Equity/Cash) below the EPS
-- line, deliberately outside every subtotal — that satisfies LKAS 1's rule
-- that a P&L must not carry BS figures on its face, but it is not itself an
-- IAS 1.54 statement: no current/non-current split, no Total Assets = Total
-- Equity + Liabilities tie-out. This migration seeds a second, independent
-- statement (code 'SFP') that is one.
--
-- THE HARD PART: this system posts no year-end closing entry — P&L account
-- balances accumulate in journal_lines forever, never swept into Retained
-- Earnings. So a "Revenue Reserves" figure that is just the RE ledger
-- account's own balance would be missing every year's un-closed profit, and
-- Total Assets would never equal Total Equity + Liabilities for any date
-- that isn't immediately after a manual closing journal (which mostly don't
-- exist here).
--
-- Fix: value_basis = 'cumulative' already computes "everything before
-- date_from, plus movement within [date_from, date_to]" for ANY mapped
-- account type (fn_fs_eval_accounts) — including P&L accounts, which have no
-- opening_balances row, so their "everything before date_from" is simply all
-- prior journal postings. One cumulative, sign = 'invert' line mapped to
-- EVERY Income/COGS/Expense/Other Income/Other Expense account therefore
-- gives all-time net profit as at p_date_to, regardless of what p_date_from
-- is. REVENUE_RESERVES = that line + the Retained Earnings account's own
-- cumulative balance, and Assets = Equity + Liabilities holds by construction
-- (opening_balances carries pre-conversion history once; journal_lines
-- carries everything after, with no overlap).
--
-- That P&L-cumulative line is mapped directly to every postable P&L account
-- for the tenant (not copied from SOCI's own mapping) so it is complete even
-- if SOCI itself has unmapped accounts, and doesn't require SOCI to exist.
--
-- No line here is named PROFIT_FOR_YEAR, so trg_fs_no_cumulative_in_profit /
-- fn_fs_line_basis_guard (20260816000003) — which only protect a line by that
-- exact code — are no-ops for this statement; nothing here can leak into
-- SOCI's profit figure. rpc_fs_coverage's UNMAPPED_ACCOUNT check applies
-- per-statement, so mapping every P&L account onto PL_CUMULATIVE also keeps
-- an SFP view from raising spurious unmapped-P&L errors for a pure balance
-- sheet.

CREATE OR REPLACE FUNCTION public.rpc_fs_seed_sfp(p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stmt uuid;
  v_ppe uuid; v_intangibles uuid; v_total_nca uuid;
  v_inventories uuid; v_trade_recv uuid; v_prepayments uuid; v_due_related uuid; v_cash_equiv uuid; v_total_ca uuid;
  v_total_assets uuid;
  v_stated_capital uuid; v_re_cum uuid; v_pl_cum uuid; v_revenue_reserves uuid; v_total_equity uuid;
  v_lt_loans uuid; v_deferred_tax uuid; v_retirement uuid; v_total_ncl uuid;
  v_trade_pay uuid; v_accrued uuid; v_other_cl uuid; v_total_cl uuid;
  v_total_eq_liab uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_stmt FROM public.fs_statements WHERE tenant_id = v_tenant AND code = 'SFP';
  IF v_stmt IS NOT NULL AND NOT p_force THEN
    RETURN v_stmt;
  END IF;

  IF v_stmt IS NULL THEN
    INSERT INTO public.fs_statements (tenant_id, code, name, title, period_caption, sort_order)
    VALUES (v_tenant, 'SFP', 'Statement of Financial Position', 'Statement Of Financial Position',
            'As At 31st March', 20)
    RETURNING id INTO v_stmt;
  ELSE
    IF EXISTS (SELECT 1 FROM public.fs_line_accounts la JOIN public.fs_lines l ON l.id = la.line_id WHERE l.statement_id = v_stmt) THEN
      RAISE EXCEPTION 'SFP has existing account mappings; reseeding would delete them. Remove mappings first if you really want to reset the line structure.'
        USING ERRCODE = '55006';
    END IF;
    DELETE FROM public.fs_lines WHERE statement_id = v_stmt;
  END IF;

  -- Non-current assets
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PPE', 'Property, Plant & Equipment', '09', 'detail', 'natural', 'normal', 'cumulative', 10)
    RETURNING id INTO v_ppe;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'INTANGIBLES', 'Intangible Assets', '10', 'detail', 'natural', 'normal', 'cumulative', 20)
    RETURNING id INTO v_intangibles;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_NCA', 'TOTAL NON CURRENT ASSETS', 'computed', 'bold_rule', 30)
    RETURNING id INTO v_total_nca;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NCA_GAP', '', 'spacer', 'normal', 40);

  -- Current assets
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'INVENTORIES', 'Inventories', '11', 'detail', 'natural', 'normal', 'cumulative', 50)
    RETURNING id INTO v_inventories;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'TRADE_RECEIVABLES', 'Trade Receivables', '12', 'detail', 'natural', 'normal', 'cumulative', 60)
    RETURNING id INTO v_trade_recv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PREPAYMENTS', 'Advances & Pre Payments', '13', 'detail', 'natural', 'normal', 'cumulative', 70)
    RETURNING id INTO v_prepayments;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DUE_FROM_RELATED', 'Amounts Due From Related Parties', '14', 'detail', 'natural', 'normal', 'cumulative', 80)
    RETURNING id INTO v_due_related;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'CASH_EQUIVALENTS', 'Cash & Cash Equivalents', '15', 'detail', 'natural', 'normal', 'cumulative', 90)
    RETURNING id INTO v_cash_equiv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_CA', 'TOTAL CURRENT ASSETS', 'computed', 'bold_rule', 100)
    RETURNING id INTO v_total_ca;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_ASSETS', 'TOTAL ASSETS', 'computed', 'total_rule', 110)
    RETURNING id INTO v_total_assets;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'EQ_GAP', '', 'spacer', 'normal', 120);

  -- Equity
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'STATED_CAPITAL', 'Stated Capital', '16', 'detail', 'invert', 'normal', 'cumulative', 130)
    RETURNING id INTO v_stated_capital;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'RE_CUM', 'Retained Earnings — Brought Forward', 'detail', 'invert', 'normal', 'cumulative', 140)
    RETURNING id INTO v_re_cum;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PL_CUMULATIVE', 'Net Profit Accumulated To Date', 'detail', 'invert', 'normal', 'cumulative', 150)
    RETURNING id INTO v_pl_cum;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'REVENUE_RESERVES', 'Revenue Reserves', 'computed', 'bold_rule', 160)
    RETURNING id INTO v_revenue_reserves;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_EQUITY', 'TOTAL EQUITY', 'computed', 'total_rule', 170)
    RETURNING id INTO v_total_equity;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NCL_GAP', '', 'spacer', 'normal', 180);

  -- Non-current liabilities
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'LONG_TERM_LOANS', 'Long Term Loans', '17', 'detail', 'invert', 'normal', 'cumulative', 190)
    RETURNING id INTO v_lt_loans;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DEFERRED_TAX', 'Deferred Tax Liability', '18', 'detail', 'invert', 'normal', 'cumulative', 200)
    RETURNING id INTO v_deferred_tax;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'RETIREMENT_BENEFIT', 'Retirement Benefit Obligation', '19', 'detail', 'invert', 'normal', 'cumulative', 210)
    RETURNING id INTO v_retirement;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_NCL', 'TOTAL NON CURRENT LIABILITIES', 'computed', 'bold_rule', 220)
    RETURNING id INTO v_total_ncl;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NCL_GAP2', '', 'spacer', 'normal', 230);

  -- Current liabilities
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'TRADE_PAYABLES', 'Trade Payables', '20', 'detail', 'invert', 'normal', 'cumulative', 240)
    RETURNING id INTO v_trade_pay;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'ACCRUED_EXPENSES', 'Accrued Expenses', '21', 'detail', 'invert', 'normal', 'cumulative', 250)
    RETURNING id INTO v_accrued;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'OTHER_CURRENT_LIAB', 'Other Current Liabilities', '22', 'detail', 'invert', 'normal', 'cumulative', 260)
    RETURNING id INTO v_other_cl;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_CL', 'TOTAL CURRENT LIABILITIES', 'computed', 'bold_rule', 270)
    RETURNING id INTO v_total_cl;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_EQUITY_LIAB', 'TOTAL EQUITY AND LIABILITIES', 'computed', 'total_rule', 280)
    RETURNING id INTO v_total_eq_liab;

  INSERT INTO public.fs_line_terms (tenant_id, line_id, term_line_id, factor, sort_order) VALUES
    (v_tenant, v_total_nca, v_ppe, 1, 1),
    (v_tenant, v_total_nca, v_intangibles, 1, 2),
    (v_tenant, v_total_ca, v_inventories, 1, 1),
    (v_tenant, v_total_ca, v_trade_recv, 1, 2),
    (v_tenant, v_total_ca, v_prepayments, 1, 3),
    (v_tenant, v_total_ca, v_due_related, 1, 4),
    (v_tenant, v_total_ca, v_cash_equiv, 1, 5),
    (v_tenant, v_total_assets, v_total_nca, 1, 1),
    (v_tenant, v_total_assets, v_total_ca, 1, 2),
    (v_tenant, v_revenue_reserves, v_re_cum, 1, 1),
    (v_tenant, v_revenue_reserves, v_pl_cum, 1, 2),
    (v_tenant, v_total_equity, v_stated_capital, 1, 1),
    (v_tenant, v_total_equity, v_revenue_reserves, 1, 2),
    (v_tenant, v_total_ncl, v_lt_loans, 1, 1),
    (v_tenant, v_total_ncl, v_deferred_tax, 1, 2),
    (v_tenant, v_total_ncl, v_retirement, 1, 3),
    (v_tenant, v_total_cl, v_trade_pay, 1, 1),
    (v_tenant, v_total_cl, v_accrued, 1, 2),
    (v_tenant, v_total_cl, v_other_cl, 1, 3),
    (v_tenant, v_total_eq_liab, v_total_equity, 1, 1),
    (v_tenant, v_total_eq_liab, v_total_ncl, 1, 2),
    (v_tenant, v_total_eq_liab, v_total_cl, 1, 3);

  -- PL_CUMULATIVE: every postable P&L account, mapped directly (not copied
  -- from SOCI) so it is complete on its own and this statement never depends
  -- on SOCI's mapping state. sign = 'invert' already applied via the line;
  -- fn_fs_eval_accounts values it as (credit - debit) since inception, i.e.
  -- all-time net profit as at p_date_to.
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_pl_cum, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
    AND a.is_postable IS NOT FALSE;

  RETURN v_stmt;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_seed_sfp(boolean) TO authenticated;

-- ── BALANCE_VARIANCE coverage check ─────────────────────────────────────────
-- Additive to rpc_fs_coverage (body otherwise byte-for-byte 20260818150000):
-- when a statement declares both a TOTAL_ASSETS and a TOTAL_EQUITY_LIAB line
-- (only SFP does today), the two must agree — that IS the balance sheet
-- balancing. Guarded by line_code existence so SOCI, which has neither, is
-- untouched.
CREATE OR REPLACE FUNCTION public.rpc_fs_coverage(
  p_statement_code text,
  p_date_from      date,
  p_date_to        date
)
RETURNS TABLE (
  issue_code   text,
  severity     text,
  account_id   uuid,
  account_code text,
  account_name text,
  detail       text,
  amount       numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_tenant        uuid := public.get_user_tenant_id();
  v_statement_id  uuid;
  v_profit_line   uuid;
  v_stmt_profit   numeric;
  v_tb_profit     numeric;
  v_cycle_msg     text;
  v_bs_count      int;
  v_bs_amount     numeric;
  v_assets_line   uuid;
  v_eqliab_line   uuid;
  v_assets_value  numeric;
  v_eqliab_value  numeric;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;

  SELECT id INTO v_statement_id FROM public.fs_statements
  WHERE tenant_id = v_tenant AND code = p_statement_code;
  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'No statement with code % for this tenant', p_statement_code USING ERRCODE = '42704';
  END IF;

  BEGIN
    PERFORM * FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '55000' THEN
      GET STACKED DIAGNOSTICS v_cycle_msg = MESSAGE_TEXT;
      RETURN QUERY SELECT 'CYCLE', 'error', NULL::uuid, NULL::text, NULL::text, v_cycle_msg, NULL::numeric;
      RETURN;
    ELSE
      RAISE;
    END IF;
  END;

  -- UNMAPPED_ACCOUNT (error): a P&L account with movement that no line picks
  -- up, directly or through a mapped ancestor.
  RETURN QUERY
  SELECT 'UNMAPPED_ACCOUNT', 'error', a.id, a.account_code, a.account_name,
         'Account has period movement but is not mapped to any line of this statement',
         round(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 2)
  FROM public.accounts a
  JOIN public.journal_lines jl ON jl.account_id = a.id
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
    AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_date_from AND p_date_to
    AND NOT EXISTS (
      SELECT 1 FROM public.fn_fs_line_accounts_expanded(v_statement_id) e
      WHERE e.out_account_id = a.id
    )
  GROUP BY a.id, a.account_code, a.account_name
  HAVING abs(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0))) > 0.005;

  -- UNMAPPED_BS_ACCOUNT (warning)
  SELECT count(*), round(SUM(abs(q.bal)), 2) INTO v_bs_count, v_bs_amount
  FROM (
    SELECT a.id,
           COALESCE(o.debit,0) - COALESCE(o.credit,0)
             + COALESCE(SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)), 0) AS bal
    FROM public.accounts a
    LEFT JOIN public.opening_balances o
           ON o.account_id = a.id AND o.tenant_id = v_tenant
          AND o.fiscal_period_id = (
            SELECT fp.id FROM public.fiscal_periods fp
            WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
            ORDER BY fp.period_start DESC LIMIT 1
          )
    LEFT JOIN public.journal_lines jl ON jl.account_id = a.id
    LEFT JOIN public.journal_entries je ON je.id = jl.journal_entry_id
         AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
         AND je.entry_date <= p_date_to
    WHERE a.tenant_id = v_tenant
      AND a.account_type IN ('Asset', 'Liability', 'Equity')
      AND NOT EXISTS (
        SELECT 1 FROM public.fn_fs_line_accounts_expanded(v_statement_id) e
        WHERE e.out_account_id = a.id
      )
    GROUP BY a.id, o.debit, o.credit
  ) q
  WHERE abs(q.bal) > 0.005;

  IF COALESCE(v_bs_count, 0) > 0 THEN
    RETURN QUERY SELECT 'UNMAPPED_BS_ACCOUNT', 'warning', NULL::uuid, NULL::text, NULL::text,
      v_bs_count || ' balance-sheet account(s) carrying a balance at this date are not on this statement — normal for a statement of comprehensive income, map them only if they belong on its face',
      v_bs_amount;
  END IF;

  -- MISSING_PARAM
  RETURN QUERY
  SELECT 'MISSING_PARAM', 'warning', NULL::uuid, NULL::text, NULL::text,
         'Line "' || l.label || '" needs fs_parameters[' || l.param_key || '] for this period, which is not set — EPS will render blank', NULL::numeric
  FROM public.fs_lines l
  WHERE l.statement_id = v_statement_id AND l.line_type = 'per_share'
    AND NOT EXISTS (
      SELECT 1 FROM public.fs_parameters p, public.fiscal_periods fp
      WHERE p.tenant_id = v_tenant AND p.key = l.param_key
        AND fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
        AND p.fiscal_period_id = fp.id
    );

  -- TIE_OUT_VARIANCE, excluding P&L accounts parked off the profit roll-up.
  SELECT id INTO v_profit_line FROM public.fs_lines
  WHERE statement_id = v_statement_id AND line_code = 'PROFIT_FOR_YEAR';

  IF v_profit_line IS NOT NULL THEN
    SELECT value INTO v_stmt_profit
    FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to)
    WHERE line_id = v_profit_line;

    WITH RECURSIVE in_profit(line_id) AS (
      SELECT v_profit_line
      UNION
      SELECT t.term_line_id
      FROM public.fs_line_terms t
      JOIN in_profit p ON p.line_id = t.line_id
    ),
    parked AS (
      SELECT e.out_account_id AS account_id
      FROM public.fn_fs_line_accounts_expanded(v_statement_id) e
      WHERE NOT EXISTS (SELECT 1 FROM in_profit ip WHERE ip.line_id = e.out_line_id)
    )
    SELECT SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)) INTO v_tb_profit
    FROM public.accounts a
    JOIN public.journal_lines jl ON jl.account_id = a.id
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE a.tenant_id = v_tenant
      AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
      AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
      AND a.id NOT IN (SELECT pk.account_id FROM parked pk);

    IF abs(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0)) > 0.005 THEN
      RETURN QUERY SELECT 'TIE_OUT_VARIANCE', 'error', NULL::uuid, NULL::text, NULL::text,
        'Profit for the year does not tie to the trial balance''s net P&L movement for this range',
        round(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0), 2);
    END IF;
  END IF;

  -- BALANCE_VARIANCE: Total Assets must equal Total Equity + Liabilities.
  SELECT id INTO v_assets_line FROM public.fs_lines WHERE statement_id = v_statement_id AND line_code = 'TOTAL_ASSETS';
  SELECT id INTO v_eqliab_line FROM public.fs_lines WHERE statement_id = v_statement_id AND line_code = 'TOTAL_EQUITY_LIAB';

  IF v_assets_line IS NOT NULL AND v_eqliab_line IS NOT NULL THEN
    SELECT value INTO v_assets_value FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to) WHERE line_id = v_assets_line;
    SELECT value INTO v_eqliab_value FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to) WHERE line_id = v_eqliab_line;

    IF abs(COALESCE(v_assets_value,0) - COALESCE(v_eqliab_value,0)) > 0.01 THEN
      RETURN QUERY SELECT 'BALANCE_VARIANCE', 'error', NULL::uuid, NULL::text, NULL::text,
        'Total Assets does not equal Total Equity and Liabilities as at this date',
        round(COALESCE(v_assets_value,0) - COALESCE(v_eqliab_value,0), 2);
    END IF;
  END IF;
END
$fn$;

ALTER FUNCTION public.rpc_fs_coverage(text, date, date) STABLE;
