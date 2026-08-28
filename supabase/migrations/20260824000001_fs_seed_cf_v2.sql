-- CF fixes, round 2:
--
-- 1. OFFSETTING (LKAS 1.32), same defect as SFP's PL_CUMULATIVE
--    (20260824000000): NET_PROFIT_PERIOD mapped Income against Expense/COGS
--    on one detail line. Split into PL_INCOME_PERIOD (invert) and
--    PL_EXPENSE_EX_TAX_PERIOD (natural), combined via a computed line —
--    same fix, same reasoning.
--
-- 2. Profit Before Tax / tax paid, previously not modeled at all (the
--    original migration's own comment explained why: no account_subtype
--    reliably marks "this Expense account is income tax" across tenants).
--    There IS a reliable, non-guessed signal available now that this
--    statement is being rebuilt anyway: SOCI's own TAX_EXP line mapping —
--    an accountant explicitly puts accounts there when setting up the income
--    statement. Reading it is not a heuristic, it's reading real curated
--    tenant data. Best-effort: if SOCI doesn't exist yet or TAX_EXP has no
--    accounts mapped, PL_EXPENSE_EX_TAX_PERIOD simply excludes nothing and
--    TAX_PAID reads 0 — degrades to the old behaviour rather than erroring.
--
--    PL_EXPENSE_EX_TAX_PERIOD excludes whatever's mapped to SOCI's TAX_EXP.
--    TAX_PAID (new) is mapped to that same set, sign=invert so a tax expense
--    being debited (tax charged) reads as a negative cash line — the
--    simplifying assumption (documented, same discipline as everywhere else
--    in this migration set) is tax paid = tax expensed in the period, i.e.
--    no separate tracking of a tax payable/receivable timing difference.
--
-- Operating section is now: PROFIT_BEFORE_TAX -> + DEPRECIATION ->
-- OP_BEFORE_WC -> + working capital -> NET_OPERATING_BEFORE_TAX ->
-- + TAX_PAID -> NET_OPERATING. Investing/financing/reconciliation unchanged.

DO $$
DECLARE v_stmt uuid;
BEGIN
  FOR v_stmt IN SELECT id FROM public.fs_statements WHERE code = 'CF' LOOP
    DELETE FROM public.fs_line_accounts WHERE line_id IN (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt);
    DELETE FROM public.fs_lines WHERE statement_id = v_stmt;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_fs_seed_cf(p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stmt uuid;
  v_pl_income uuid; v_pl_expense_ex_tax uuid; v_pbt uuid; v_depreciation uuid; v_op_before_wc uuid;
  v_wc_inv uuid; v_wc_recv uuid; v_wc_prepay uuid; v_wc_pay uuid; v_wc_accr uuid; v_net_op_before_tax uuid;
  v_tax_paid uuid; v_net_operating uuid;
  v_ppe_purch uuid; v_intang_purch uuid; v_net_investing uuid;
  v_loan_mv uuid; v_equity_fin uuid; v_dividends uuid; v_net_financing uuid;
  v_net_change uuid; v_opening_cash uuid; v_closing_cash uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_stmt FROM public.fs_statements WHERE tenant_id = v_tenant AND code = 'CF';
  IF v_stmt IS NOT NULL AND NOT p_force THEN
    RETURN v_stmt;
  END IF;

  IF v_stmt IS NULL THEN
    INSERT INTO public.fs_statements (tenant_id, code, name, title, period_caption, sort_order)
    VALUES (v_tenant, 'CF', 'Statement of Cash Flows', 'Statement Of Cash Flows',
            'For the Year Ended 31st March', 30)
    RETURNING id INTO v_stmt;
  ELSE
    IF EXISTS (SELECT 1 FROM public.fs_line_accounts la JOIN public.fs_lines l ON l.id = la.line_id WHERE l.statement_id = v_stmt) THEN
      RAISE EXCEPTION 'CF has existing account mappings; reseeding would delete them. Remove mappings first if you really want to reset the line structure.'
        USING ERRCODE = '55006';
    END IF;
    DELETE FROM public.fs_lines WHERE statement_id = v_stmt;
  END IF;

  -- Operating
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PL_INCOME_PERIOD', 'Income For The Period', 'detail', 'invert', 'normal', 'period', 5)
    RETURNING id INTO v_pl_income;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PL_EXPENSE_EX_TAX_PERIOD', 'Expenses For The Period (Excl. Tax)', 'detail', 'natural', 'normal', 'period', 8)
    RETURNING id INTO v_pl_expense_ex_tax;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'PROFIT_BEFORE_TAX', 'PROFIT BEFORE TAXATION', 'computed', 'bold_rule', 10)
    RETURNING id INTO v_pbt;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DEPRECIATION', 'Depreciation', 'detail', 'invert', 'normal', 'period', 20)
    RETURNING id INTO v_depreciation;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'OP_BEFORE_WC', 'OPERATING PROFIT BEFORE WORKING CAPITAL CHANGES', 'computed', 'bold_rule', 30)
    RETURNING id INTO v_op_before_wc;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'WC_GAP', '', 'spacer', 'normal', 40);

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'WC_INVENTORY', '(Increase)/Decrease in Inventories', 'detail', 'invert', 'normal', 'period', 50)
    RETURNING id INTO v_wc_inv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'WC_RECEIVABLES', '(Increase)/Decrease in Trade Receivables', 'detail', 'invert', 'normal', 'period', 60)
    RETURNING id INTO v_wc_recv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'WC_PREPAYMENTS', '(Increase)/Decrease in Advances & Pre Payments', 'detail', 'invert', 'normal', 'period', 70)
    RETURNING id INTO v_wc_prepay;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'WC_PAYABLES', 'Increase/(Decrease) in Trade Payables', 'detail', 'invert', 'normal', 'period', 80)
    RETURNING id INTO v_wc_pay;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'WC_ACCRUALS', 'Increase/(Decrease) in Accrued Expenses', 'detail', 'invert', 'normal', 'period', 90)
    RETURNING id INTO v_wc_accr;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NET_OP_BEFORE_TAX', 'CASH GENERATED FROM OPERATIONS', 'computed', 'bold_rule', 100)
    RETURNING id INTO v_net_op_before_tax;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'TAX_PAID', 'Payment Of Income Tax', 'detail', 'invert', 'normal', 'period', 105)
    RETURNING id INTO v_tax_paid;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NET_OPERATING', 'NET CASH FROM OPERATING ACTIVITIES', 'computed', 'total_rule', 108)
    RETURNING id INTO v_net_operating;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'INV_GAP', '', 'spacer', 'normal', 110);

  -- Investing
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PPE_PURCHASES', 'Purchase of Property, Plant & Equipment', 'detail', 'invert', 'normal', 'period', 120)
    RETURNING id INTO v_ppe_purch;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'INTANGIBLE_PURCHASES', 'Purchase of Intangible Assets', 'detail', 'invert', 'normal', 'period', 130)
    RETURNING id INTO v_intang_purch;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NET_INVESTING', 'NET CASH USED IN INVESTING ACTIVITIES', 'computed', 'bold_rule', 140)
    RETURNING id INTO v_net_investing;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'FIN_GAP', '', 'spacer', 'normal', 150);

  -- Financing
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'LOAN_MOVEMENT', 'Long Term Loans Obtained/(Repaid)', 'detail', 'invert', 'normal', 'period', 160)
    RETURNING id INTO v_loan_mv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'EQUITY_FINANCING', 'Proceeds From Issue Of Stated Capital', 'detail', 'invert', 'normal', 'period', 170)
    RETURNING id INTO v_equity_fin;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DIVIDENDS_PAID', 'Dividends Paid', 'detail', 'invert', 'normal', 'period', 180)
    RETURNING id INTO v_dividends;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NET_FINANCING', 'NET CASH FROM/(USED IN) FINANCING ACTIVITIES', 'computed', 'bold_rule', 190)
    RETURNING id INTO v_net_financing;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NET_GAP', '', 'spacer', 'normal', 200);

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NET_CHANGE_IN_CASH', 'NET INCREASE/(DECREASE) IN CASH AND CASH EQUIVALENTS', 'computed', 'total_rule', 210)
    RETURNING id INTO v_net_change;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'RECON_GAP', '', 'spacer', 'normal', 220);

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'OPENING_CASH', 'Cash & Cash Equivalents At Beginning Of The Period', 'computed', 'normal', 230)
    RETURNING id INTO v_opening_cash;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'CLOSING_CASH', 'Cash & Cash Equivalents At End Of The Period', 'detail', 'natural', 'total_rule', 'cumulative', 240)
    RETURNING id INTO v_closing_cash;

  INSERT INTO public.fs_line_terms (tenant_id, line_id, term_line_id, factor, sort_order) VALUES
    (v_tenant, v_pbt, v_pl_income, 1, 1),
    (v_tenant, v_pbt, v_pl_expense_ex_tax, -1, 2),
    (v_tenant, v_op_before_wc, v_pbt, 1, 1),
    (v_tenant, v_op_before_wc, v_depreciation, 1, 2),
    (v_tenant, v_net_op_before_tax, v_op_before_wc, 1, 1),
    (v_tenant, v_net_op_before_tax, v_wc_inv, 1, 2),
    (v_tenant, v_net_op_before_tax, v_wc_recv, 1, 3),
    (v_tenant, v_net_op_before_tax, v_wc_prepay, 1, 4),
    (v_tenant, v_net_op_before_tax, v_wc_pay, 1, 5),
    (v_tenant, v_net_op_before_tax, v_wc_accr, 1, 6),
    (v_tenant, v_net_operating, v_net_op_before_tax, 1, 1),
    (v_tenant, v_net_operating, v_tax_paid, 1, 2),
    (v_tenant, v_net_investing, v_ppe_purch, 1, 1),
    (v_tenant, v_net_investing, v_intang_purch, 1, 2),
    (v_tenant, v_net_financing, v_loan_mv, 1, 1),
    (v_tenant, v_net_financing, v_equity_fin, 1, 2),
    (v_tenant, v_net_financing, v_dividends, 1, 3),
    (v_tenant, v_net_change, v_net_operating, 1, 1),
    (v_tenant, v_net_change, v_net_investing, 1, 2),
    (v_tenant, v_net_change, v_net_financing, 1, 3),
    (v_tenant, v_opening_cash, v_closing_cash, 1, 1),
    (v_tenant, v_opening_cash, v_net_change, -1, 2);

  -- Income: self-contained, every postable Income/Other Income account.
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_pl_income, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant AND a.account_type IN ('Income', 'Other Income') AND a.is_postable IS NOT FALSE;

  -- Expense excluding tax: every postable Expense/COGS/Other Expense account
  -- NOT already mapped to SOCI's TAX_EXP line (real tenant-curated signal for
  -- "this is income tax", not a guess — see header comment).
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_pl_expense_ex_tax, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Cost of Goods Sold', 'Expense', 'Other Expense')
    AND a.is_postable IS NOT FALSE
    AND a.id NOT IN (
      SELECT la.account_id
      FROM public.fs_line_accounts la
      JOIN public.fs_lines l ON l.id = la.line_id
      JOIN public.fs_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = v_tenant AND s.code = 'SOCI' AND l.line_code = 'TAX_EXP'
    );

  -- Tax paid: the same set SOCI's TAX_EXP maps, if any. Empty (not an error)
  -- when SOCI hasn't been mapped yet.
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_tax_paid, la.account_id
  FROM public.fs_line_accounts la
  JOIN public.fs_lines l ON l.id = la.line_id
  JOIN public.fs_statements s ON s.id = l.statement_id
  WHERE s.tenant_id = v_tenant AND s.code = 'SOCI' AND l.line_code = 'TAX_EXP';

  -- Reliable, generic subtype match.
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_depreciation, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant
    AND a.account_subtype = 'Accumulated Depreciation'
    AND a.is_postable IS NOT FALSE;

  RETURN v_stmt;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_seed_cf(boolean) TO authenticated;
