-- SFP fixes, round 2, driven by an actual accounting-standards review:
--
-- 1. OFFSETTING (LKAS 1.32). PL_CUMULATIVE mapped BOTH Income (credit-natured)
--    and Expense/COGS/Other Expense (debit-natured) accounts onto one detail
--    line — exactly what this codebase's own mapping-screen linter
--    (fsMappingStandards.ts) flags, and correctly so: a single detail line's
--    account list is presented net, and netting debit- against credit-
--    natured accounts hides both sides. Verified against real data: tenant
--    375600ca-b860-461d-b423-9a1f6e05c950 had 129 Expense + 3 COGS accounts
--    netted against 11 Income accounts on one line.
--
--    Fix: split into PL_INCOME_CUM (Income + Other Income, sign=invert) and
--    PL_EXPENSE_CUM (Expense + COGS + Other Expense, sign=natural, so it
--    reads as a positive total of expense), combined via REVENUE_RESERVES'S
--    fs_line_terms (income +1, expense -1) — the same computed-line pattern
--    SOCI already uses for GROSS_PROFIT/OPERATING_PROFIT/PBT. A computed
--    line has no directly mapped accounts, so the linter has nothing to net.
--
-- 2. Missing IAS 1.54 line items. Added Deferred Tax Asset (non-current
--    asset), Other Provisions (non-current liability — Retirement Benefit
--    already covers employee provisions specifically), and Current Tax
--    Liability (current liability, distinct from the existing long-term
--    Deferred Tax Liability). NOT added: held-for-sale assets, biological
--    assets, equity-accounted investments — LKAS 1.55 only requires a line
--    item when relevant to understanding the entity's position, and padding
--    every SME's balance sheet with lines that will read 0.00 forever is
--    worse presentation, not better.
--
-- Note refs renumbered sequentially since new lines are interspersed.

-- ── Migrate any tenant that already seeded the old structure ────────────────
-- Nothing has ever been manually mapped onto SFP's balance-sheet lines yet in
-- production (checked: only the auto-populated PL_CUMULATIVE mapping exists
-- on any tenant's SFP today) — so there is no hand-curated mapping to
-- preserve. Clear and reseed rather than surgically rewrite in place.
DO $$
DECLARE v_stmt uuid;
BEGIN
  FOR v_stmt IN SELECT id FROM public.fs_statements WHERE code = 'SFP' LOOP
    DELETE FROM public.fs_line_accounts WHERE line_id IN (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt);
    DELETE FROM public.fs_lines WHERE statement_id = v_stmt;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_fs_seed_sfp(p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stmt uuid;
  v_ppe uuid; v_intangibles uuid; v_deferred_tax_asset uuid; v_total_nca uuid;
  v_inventories uuid; v_trade_recv uuid; v_prepayments uuid; v_due_related uuid; v_cash_equiv uuid; v_total_ca uuid;
  v_total_assets uuid;
  v_stated_capital uuid; v_re_cum uuid; v_pl_income_cum uuid; v_pl_expense_cum uuid; v_revenue_reserves uuid; v_total_equity uuid;
  v_lt_loans uuid; v_deferred_tax_liab uuid; v_retirement uuid; v_other_provisions uuid; v_total_ncl uuid;
  v_trade_pay uuid; v_accrued uuid; v_other_cl uuid; v_current_tax_liab uuid; v_total_cl uuid;
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
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DEFERRED_TAX_ASSET', 'Deferred Tax Asset', '11', 'detail', 'natural', 'normal', 'cumulative', 25)
    RETURNING id INTO v_deferred_tax_asset;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_NCA', 'TOTAL NON CURRENT ASSETS', 'computed', 'bold_rule', 30)
    RETURNING id INTO v_total_nca;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NCA_GAP', '', 'spacer', 'normal', 40);

  -- Current assets
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'INVENTORIES', 'Inventories', '12', 'detail', 'natural', 'normal', 'cumulative', 50)
    RETURNING id INTO v_inventories;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'TRADE_RECEIVABLES', 'Trade Receivables', '13', 'detail', 'natural', 'normal', 'cumulative', 60)
    RETURNING id INTO v_trade_recv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PREPAYMENTS', 'Advances & Pre Payments', '14', 'detail', 'natural', 'normal', 'cumulative', 70)
    RETURNING id INTO v_prepayments;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DUE_FROM_RELATED', 'Amounts Due From Related Parties', '15', 'detail', 'natural', 'normal', 'cumulative', 80)
    RETURNING id INTO v_due_related;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'CASH_EQUIVALENTS', 'Cash & Cash Equivalents', '16', 'detail', 'natural', 'normal', 'cumulative', 90)
    RETURNING id INTO v_cash_equiv;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_CA', 'TOTAL CURRENT ASSETS', 'computed', 'bold_rule', 100)
    RETURNING id INTO v_total_ca;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_ASSETS', 'TOTAL ASSETS', 'computed', 'total_rule', 110)
    RETURNING id INTO v_total_assets;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'EQ_GAP', '', 'spacer', 'normal', 120);

  -- Equity — PL_INCOME_CUM / PL_EXPENSE_CUM replace the single PL_CUMULATIVE
  -- line (see header comment: LKAS 1.32 offsetting).
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'STATED_CAPITAL', 'Stated Capital', '17', 'detail', 'invert', 'normal', 'cumulative', 130)
    RETURNING id INTO v_stated_capital;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'RE_CUM', 'Retained Earnings — Brought Forward', 'detail', 'invert', 'normal', 'cumulative', 140)
    RETURNING id INTO v_re_cum;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PL_INCOME_CUM', 'Income Accumulated To Date', 'detail', 'invert', 'normal', 'cumulative', 150)
    RETURNING id INTO v_pl_income_cum;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'PL_EXPENSE_CUM', 'Expenses Accumulated To Date', 'detail', 'natural', 'normal', 'cumulative', 155)
    RETURNING id INTO v_pl_expense_cum;
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
    VALUES (v_tenant, v_stmt, 'LONG_TERM_LOANS', 'Long Term Loans', '18', 'detail', 'invert', 'normal', 'cumulative', 190)
    RETURNING id INTO v_lt_loans;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'DEFERRED_TAX', 'Deferred Tax Liability', '19', 'detail', 'invert', 'normal', 'cumulative', 200)
    RETURNING id INTO v_deferred_tax_liab;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'RETIREMENT_BENEFIT', 'Retirement Benefit Obligation', '20', 'detail', 'invert', 'normal', 'cumulative', 210)
    RETURNING id INTO v_retirement;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'OTHER_PROVISIONS', 'Other Provisions', '21', 'detail', 'invert', 'normal', 'cumulative', 215)
    RETURNING id INTO v_other_provisions;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TOTAL_NCL', 'TOTAL NON CURRENT LIABILITIES', 'computed', 'bold_rule', 220)
    RETURNING id INTO v_total_ncl;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'NCL_GAP2', '', 'spacer', 'normal', 230);

  -- Current liabilities
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'TRADE_PAYABLES', 'Trade Payables', '22', 'detail', 'invert', 'normal', 'cumulative', 240)
    RETURNING id INTO v_trade_pay;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'ACCRUED_EXPENSES', 'Accrued Expenses', '23', 'detail', 'invert', 'normal', 'cumulative', 250)
    RETURNING id INTO v_accrued;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'CURRENT_TAX_LIABILITY', 'Current Tax Liability', '24', 'detail', 'invert', 'normal', 'cumulative', 255)
    RETURNING id INTO v_current_tax_liab;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, value_basis, sort_order)
    VALUES (v_tenant, v_stmt, 'OTHER_CURRENT_LIAB', 'Other Current Liabilities', '25', 'detail', 'invert', 'normal', 'cumulative', 260)
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
    (v_tenant, v_total_nca, v_deferred_tax_asset, 1, 3),
    (v_tenant, v_total_ca, v_inventories, 1, 1),
    (v_tenant, v_total_ca, v_trade_recv, 1, 2),
    (v_tenant, v_total_ca, v_prepayments, 1, 3),
    (v_tenant, v_total_ca, v_due_related, 1, 4),
    (v_tenant, v_total_ca, v_cash_equiv, 1, 5),
    (v_tenant, v_total_assets, v_total_nca, 1, 1),
    (v_tenant, v_total_assets, v_total_ca, 1, 2),
    (v_tenant, v_revenue_reserves, v_re_cum, 1, 1),
    (v_tenant, v_revenue_reserves, v_pl_income_cum, 1, 2),
    (v_tenant, v_revenue_reserves, v_pl_expense_cum, -1, 3),
    (v_tenant, v_total_equity, v_stated_capital, 1, 1),
    (v_tenant, v_total_equity, v_revenue_reserves, 1, 2),
    (v_tenant, v_total_ncl, v_lt_loans, 1, 1),
    (v_tenant, v_total_ncl, v_deferred_tax_liab, 1, 2),
    (v_tenant, v_total_ncl, v_retirement, 1, 3),
    (v_tenant, v_total_ncl, v_other_provisions, 1, 4),
    (v_tenant, v_total_cl, v_trade_pay, 1, 1),
    (v_tenant, v_total_cl, v_accrued, 1, 2),
    (v_tenant, v_total_cl, v_current_tax_liab, 1, 3),
    (v_tenant, v_total_cl, v_other_cl, 1, 4),
    (v_tenant, v_total_eq_liab, v_total_equity, 1, 1),
    (v_tenant, v_total_eq_liab, v_total_ncl, 1, 2),
    (v_tenant, v_total_eq_liab, v_total_cl, 1, 3);

  -- PL_INCOME_CUM / PL_EXPENSE_CUM: every postable P&L account, split by
  -- debit/credit nature so neither detail line offsets the other (LKAS 1.32).
  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_pl_income_cum, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Income', 'Other Income')
    AND a.is_postable IS NOT FALSE;

  INSERT INTO public.fs_line_accounts (tenant_id, line_id, account_id)
  SELECT v_tenant, v_pl_expense_cum, a.id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Cost of Goods Sold', 'Expense', 'Other Expense')
    AND a.is_postable IS NOT FALSE;

  RETURN v_stmt;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_seed_sfp(boolean) TO authenticated;

-- Tenants that had the old structure now have an SFP statement row with zero
-- lines (cleared above) — reseeded as a separate step, per tenant, through
-- the same role-impersonation call used to verify this statement originally,
-- rather than juggling auth context inside this DO block.
