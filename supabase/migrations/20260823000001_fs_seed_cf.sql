-- Statement of Cash Flows, indirect method, on the fs_lines engine (code 'CF').
--
-- SIGN RULE, stated once instead of re-derived per line: sign = 'invert' on a
-- period-basis line gives (credit - debit) movement for whatever account is
-- mapped to it. Applied to ANY non-cash balance-sheet account, that is exactly
-- its cash-flow contribution under the indirect method — an asset account
-- being debited (increasing) reads negative (cash went out to build it); a
-- liability or equity account being credited (increasing) reads positive
-- (cash came in from it). This falls straight out of the accounting identity
-- (Cash = Liabilities + Equity − other Assets, so ΔCash = Δ(L+E) − Δ(other
-- assets), and (credit − debit) is precisely the +1 orientation on the L/E
-- side and the −1 orientation on the asset side). So every detail line below
-- — working capital, investing, financing, even the profit and depreciation
-- add-backs standing in for the retained-earnings side of the identity — uses
-- the same sign = 'invert'. If every non-cash account a tenant has were
-- mapped somewhere in this statement, NET_CHANGE_IN_CASH would equal the
-- ledger's actual cash movement by construction; UNMAPPED_BS_ACCOUNT
-- (rpc_fs_coverage) is what tells a tenant when something is missing from
-- that sum.
--
-- WHAT THIS DELIBERATELY DOES NOT MODEL: a "Profit Before Tax" starting line
-- with income tax expense added back and a separate "tax paid" cash line.
-- Sri Lankan statutory practice keeps that split (see PART F of the original
-- brief), but there is no reliable, tenant-independent way to identify which
-- Expense accounts are income tax (no seeded account_subtype for it, unlike
-- 'Accumulated Depreciation' below) short of reading SOCI's own TAX_EXP
-- mapping — a cross-statement dependency this migration avoids on purpose,
-- matching this codebase's existing discipline of not guessing at unmodeled
-- business data (see rpc_changes_in_equity's Prior Year Adjustment, same
-- migration set). NET_PROFIT_PERIOD is therefore profit AFTER tax, mapped to
-- every postable P&L account exactly like SFP's PL_CUMULATIVE. A future
-- migration can split it once there is a real place to read the tax accounts
-- from (e.g. copying SOCI's TAX_EXP mapping, or a dedicated account flag).
--
-- OPENING_CASH is derived (CLOSING_CASH − NET_CHANGE_IN_CASH), not fetched at
-- a second date — a single rpc_fs_statement call only evaluates 'cumulative'
-- lines as at p_date_to, so there is no direct way to ask for a balance as at
-- p_date_from inside one call. CLOSING_CASH is the one real (cumulative)
-- figure; everything else is arithmetic from it.

CREATE OR REPLACE FUNCTION public.rpc_fs_seed_cf(p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stmt uuid;
  v_profit uuid; v_depreciation uuid; v_op_before_wc uuid;
  v_wc_inv uuid; v_wc_recv uuid; v_wc_prepay uuid; v_wc_pay uuid; v_wc_accr uuid; v_net_operating uuid;
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
    VALUES (v_tenant, v_stmt, 'NET_PROFIT_PERIOD', 'Profit For The Period', 'detail', 'invert', 'normal', 'period', 10)
    RETURNING id INTO v_profit;
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
    VALUES (v_tenant, v_stmt, 'NET_OPERATING', 'NET CASH FROM OPERATING ACTIVITIES', 'computed', 'total_rule', 100)
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
    (v_tenant, v_op_before_wc, v_profit, 1, 1),
    (v_tenant, v_op_before_wc, v_depreciation, 1, 2),
    (v_tenant, v_net_operating, v_op_before_wc, 1, 1),
    (v_tenant, v_net_operating, v_wc_inv, 1, 2),
    (v_tenant, v_net_operating, v_wc_recv, 1, 3),
    (v_tenant, v_net_operating, v_wc_prepay, 1, 4),
    (v_tenant, v_net_operating, v_wc_pay, 1, 5),
    (v_tenant, v_net_operating, v_wc_accr, 1, 6),
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

  -- Self-contained, same technique as SFP's PL_CUMULATIVE: every postable P&L
  -- account, directly, so this line needs no other statement's mapping state.
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_profit, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
    AND a.is_postable IS NOT FALSE;

  -- Reliable, generic subtype match — unlike "finance costs" or "income tax
  -- expense", 'Accumulated Depreciation' is an actual seeded account_subtype.
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
