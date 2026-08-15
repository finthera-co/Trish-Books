-- Two extra SOCI detail lines an accountant can park a balance-sheet-natured
-- account on: "Assets" and "Amount Due From Related Parties". They are ordinary
-- detail lines, but deliberately NOT terms of any computed line — mapping an
-- account there takes it out of the unmapped bucket without moving profit.
--
-- sign = 'natural' (debit - credit): a debit-balance asset must read positive on
-- the face of the statement, unlike the P&L lines which invert.
--
-- Because a P&L-typed account CAN be parked on such a line, rpc_fs_coverage's
-- TIE_OUT_VARIANCE check is rewritten below: the trial-balance side now only
-- counts accounts mapped onto lines that actually roll up into PROFIT_FOR_YEAR
-- (plus unmapped ones), otherwise a deliberate parking would be reported as a
-- broken statement.

-- ── 1. Backfill the two lines onto every existing SOCI ──────────────────────
INSERT INTO public.fs_lines
  (tenant_id, statement_id, line_code, label, note_ref, line_type, sign, emphasis, sort_order)
SELECT s.tenant_id, s.id, v.line_code, v.label, NULL, 'detail', 'natural', 'normal', v.sort_order
FROM public.fs_statements s
CROSS JOIN (VALUES
  ('ASSETS',              'Assets',                            130),
  ('DUE_FROM_RELATED',    'Amount Due From Related Parties',   140)
) AS v(line_code, label, sort_order)
WHERE s.code = 'SOCI'
ON CONFLICT (statement_id, line_code) DO NOTHING;

-- ── 2. Same two lines for every SOCI seeded from here on ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fs_seed_soci(p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stmt uuid;
  v_revenue uuid; v_cos uuid; v_gp uuid; v_other_inc uuid; v_selling uuid; v_admin uuid;
  v_operating uuid; v_finance uuid; v_pbt uuid; v_tax uuid; v_profit uuid; v_eps uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_stmt FROM public.fs_statements WHERE tenant_id = v_tenant AND code = 'SOCI';
  IF v_stmt IS NOT NULL AND NOT p_force THEN
    RETURN v_stmt;
  END IF;

  IF v_stmt IS NULL THEN
    INSERT INTO public.fs_statements (tenant_id, code, name, title, sort_order)
    VALUES (v_tenant, 'SOCI', 'Statement of Comprehensive Income', 'Statement Of Comprehensive Income', 10)
    RETURNING id INTO v_stmt;
  ELSE
    -- Reseed: drop existing lines. fs_line_accounts cascades on line delete, which
    -- would silently discard the accountant's mappings — refuse rather than do that.
    IF EXISTS (SELECT 1 FROM public.fs_line_accounts la JOIN public.fs_lines l ON l.id = la.line_id WHERE l.statement_id = v_stmt) THEN
      RAISE EXCEPTION 'SOCI has existing account mappings; reseeding would delete them. Remove mappings first if you really want to reset the line structure.'
        USING ERRCODE = '55006';
    END IF;
    DELETE FROM public.fs_lines WHERE statement_id = v_stmt;
  END IF;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, show_margin, is_margin_base, sort_order)
    VALUES (v_tenant, v_stmt, 'REVENUE', 'Revenue', '01', 'detail', 'normal', false, true, 10)
    RETURNING id INTO v_revenue;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'COS', 'Cost of Sales', '02', 'detail', 'normal', 20)
    RETURNING id INTO v_cos;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, show_margin, sort_order)
    VALUES (v_tenant, v_stmt, 'GROSS_PROFIT', 'GROSS PROFIT', 'computed', 'bold_rule', true, 30)
    RETURNING id INTO v_gp;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'OTHER_OP_INCOME', 'Other Operating Income', '03', 'detail', 'normal', 40)
    RETURNING id INTO v_other_inc;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'SELLING_DIST', 'Selling & Distribution Expenses', '04', 'detail', 'normal', 50)
    RETURNING id INTO v_selling;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'ADMIN_EXP', 'Administrative Expenses', '05', 'detail', 'normal', 60)
    RETURNING id INTO v_admin;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'OPERATING_PROFIT', 'PROFIT/(LOSS)FROM OPERATING ACTIVITIES', 'computed', 'bold_rule', 70)
    RETURNING id INTO v_operating;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'FINANCE_EXP', 'Financial Expenses', '06', 'detail', 'normal', 80)
    RETURNING id INTO v_finance;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, show_margin, sort_order)
    VALUES (v_tenant, v_stmt, 'PBT', 'PROFIT/(LOSS) BEFORE TAXATION', 'computed', 'bold_rule', true, 90)
    RETURNING id INTO v_pbt;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TAX_EXP', 'Income Tax Expenses', '07', 'detail', 'normal', 100)
    RETURNING id INTO v_tax;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, show_margin, sort_order)
    VALUES (v_tenant, v_stmt, 'PROFIT_FOR_YEAR', 'PROFIT/(LOSS) FOR THE YEAR', 'computed', 'total_rule', true, 110)
    RETURNING id INTO v_profit;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, param_key, sort_order)
    VALUES (v_tenant, v_stmt, 'EPS', 'Basic Earnings / (Loss) Per Ordinary Share', '08', 'per_share', 'normal', 'weighted_average_shares', 120)
    RETURNING id INTO v_eps;

  -- Parking lines for balance-sheet-natured accounts. No fs_line_terms row ever
  -- references them, so they never touch profit.
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, sort_order) VALUES
    (v_tenant, v_stmt, 'ASSETS',           'Assets',                          'detail', 'natural', 'normal', 130),
    (v_tenant, v_stmt, 'DUE_FROM_RELATED', 'Amount Due From Related Parties', 'detail', 'natural', 'normal', 140);

  INSERT INTO public.fs_line_terms (tenant_id, line_id, term_line_id, factor, sort_order) VALUES
    (v_tenant, v_gp, v_revenue, 1, 1),
    (v_tenant, v_gp, v_cos, 1, 2),
    (v_tenant, v_operating, v_gp, 1, 1),
    (v_tenant, v_operating, v_other_inc, 1, 2),
    (v_tenant, v_operating, v_selling, 1, 3),
    (v_tenant, v_operating, v_admin, 1, 4),
    (v_tenant, v_pbt, v_operating, 1, 1),
    (v_tenant, v_pbt, v_finance, 1, 2),
    (v_tenant, v_profit, v_pbt, 1, 1),
    (v_tenant, v_profit, v_tax, 1, 2),
    (v_tenant, v_eps, v_profit, 1, 1);

  RETURN v_stmt;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_seed_soci(boolean) TO authenticated;

-- ── 3. TIE_OUT_VARIANCE must respect the parking lines ──────────────────────
-- Unchanged from 20260803000006 except for the trial-balance side of the
-- tie-out: a P&L account parked on a line outside the PROFIT_FOR_YEAR roll-up
-- is excluded from the comparison, because the statement intentionally omits
-- it. "Inside the roll-up" is derived, not hardcoded — a recursive walk of
-- fs_line_terms down from PROFIT_FOR_YEAR — so re-wiring the statement keeps
-- the check honest.
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
  v_tenant       uuid := public.get_user_tenant_id();
  v_statement_id uuid;
  v_profit_line  uuid;
  v_stmt_profit  numeric;
  v_tb_profit    numeric;
  v_cycle_msg    text;
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

  -- CYCLE: run the evaluator purely to surface a cycle as a coverage row instead
  -- of an exception that kills the caller.
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

  -- UNMAPPED_ACCOUNT: P&L-placement accounts with period movement, mapped to no
  -- line of this statement. This is the single most important control here —
  -- an unmapped revenue account is how a statement quietly understates income.
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
      SELECT 1 FROM public.fs_line_accounts la
      JOIN public.fs_lines l ON l.id = la.line_id
      WHERE la.account_id = a.id AND l.statement_id = v_statement_id
    )
  GROUP BY a.id, a.account_code, a.account_name
  HAVING abs(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0))) > 0.005;

  -- MISSING_PARAM: a per_share line whose fs_parameters row is absent for the period.
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

  -- TIE_OUT_VARIANCE: the statement's bottom line vs the trial balance's own net
  -- P&L movement for the same range, same sign convention (credit - debit),
  -- less any P&L account deliberately parked off the profit roll-up.
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
      SELECT la.account_id
      FROM public.fs_line_accounts la
      JOIN public.fs_lines l ON l.id = la.line_id
      WHERE l.statement_id = v_statement_id
        AND NOT EXISTS (SELECT 1 FROM in_profit ip WHERE ip.line_id = l.id)
    )
    SELECT SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)) INTO v_tb_profit
    FROM public.accounts a
    JOIN public.journal_lines jl ON jl.account_id = a.id
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE a.tenant_id = v_tenant
      AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
      AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
      AND a.id NOT IN (SELECT account_id FROM parked);

    IF abs(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0)) > 0.005 THEN
      RETURN QUERY SELECT 'TIE_OUT_VARIANCE', 'error', NULL::uuid, NULL::text, NULL::text,
        'Profit for the year does not tie to the trial balance''s net P&L movement for this range',
        round(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0), 2);
    END IF;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_coverage(text, date, date) TO authenticated;
