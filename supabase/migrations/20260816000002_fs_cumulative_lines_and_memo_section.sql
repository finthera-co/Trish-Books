-- Makes the SOCI defensible once balance-sheet accounts are mapped onto it.
--
-- Three problems this fixes:
--
-- 1. VALUATION. Every detail line was valued as period MOVEMENT (sum of the
--    range's journal lines). That is right for income and expense, which reset
--    each year, and wrong for an asset, liability or equity account, whose
--    figure is a CLOSING BALANCE carried forward from inception. An asset line
--    was therefore reporting "what changed this year", not "what is held" —
--    and it disagreed with the Trial Balance's Closing column for the same
--    account. fs_lines.value_basis now selects between the two, and the
--    cumulative basis is computed exactly as rpc_trial_balance computes
--    Closing: audit opening + period debit - period credit, so the two reports
--    can never drift apart.
--
-- 2. PRESENTATION. LKAS 1 / IAS 1 is explicit that the statement of profit or
--    loss and other comprehensive income presents income and expenses for the
--    period; assets and liabilities belong to the statement of financial
--    position. Carrying them on the face of the SOCI without separation would
--    misstate the statement. They are therefore fenced off below the EPS line
--    under a memorandum heading, outside every subtotal, so the statutory face
--    of the statement (Revenue -> Profit for the year -> EPS) is untouched.
--
-- 3. COVERAGE. rpc_fs_coverage only ever looked at P&L accounts, so a
--    balance-sheet account left off the statement was invisible. It now
--    reports those too, as a single aggregated WARNING (not an error — a SOCI
--    that omits them is the standard presentation, not a defect).

-- ── 1. value_basis ───────────────────────────────────────────────────────────
ALTER TABLE public.fs_lines
  ADD COLUMN IF NOT EXISTS value_basis text NOT NULL DEFAULT 'period';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fs_lines_value_basis_check'
  ) THEN
    ALTER TABLE public.fs_lines
      ADD CONSTRAINT fs_lines_value_basis_check CHECK (value_basis IN ('period', 'cumulative'));
  END IF;
END $$;

COMMENT ON COLUMN public.fs_lines.value_basis IS
  'period = movement between date_from and date_to (income/expense). cumulative = closing balance as at date_to, audit opening + period Dr - Cr, matching rpc_trial_balance (asset/liability/equity).';

UPDATE public.fs_lines l
SET value_basis = 'cumulative'
FROM public.fs_statements s
WHERE s.id = l.statement_id AND s.code = 'SOCI'
  AND l.line_code IN ('ASSETS', 'DUE_FROM_RELATED')
  AND l.value_basis <> 'cumulative';

-- ── 2. Memorandum section header on every existing SOCI ─────────────────────
INSERT INTO public.fs_lines
  (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, sort_order)
SELECT s.tenant_id, s.id, v.line_code, v.label, v.line_type, 'natural', v.emphasis, v.sort_order
FROM public.fs_statements s
CROSS JOIN (VALUES
  ('BS_MEMO_GAP',     '',                                              'spacer', 'normal', 125),
  ('BS_MEMO_HEADING', 'MEMORANDUM — NOT PART OF PROFIT OR LOSS',       'text',   'bold',   128)
) AS v(line_code, label, line_type, emphasis, sort_order)
WHERE s.code = 'SOCI'
ON CONFLICT (statement_id, line_code) DO NOTHING;

-- ── 3. Evaluator: detail lines honour value_basis ───────────────────────────
-- Only the detail step changes; computed / per_share / margin are byte-for-byte
-- the logic from 20260803000006 (+ its 20260803000007 / 20260803000008 /
-- 20260804000001 / 20260804000000 fixes, which are all in this body already).
CREATE OR REPLACE FUNCTION public.fn_fs_eval_statement(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (line_id uuid, value numeric, margin numeric, account_count integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_period_id  uuid;
  v_pass       int;
  v_rows       int;
  v_unresolved int;
  v_base_line  uuid;
  v_base_value numeric;
BEGIN
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  CREATE TEMP TABLE IF NOT EXISTS fs_eval_values (
    line_id uuid PRIMARY KEY, value numeric, resolved boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  DELETE FROM fs_eval_values WHERE true;

  INSERT INTO fs_eval_values (line_id, value, resolved)
  SELECT id, NULL, false FROM public.fs_lines WHERE statement_id = p_statement_id;

  -- 1. detail lines. Per mapped account:
  --      period      -> debit - credit within [from, to]
  --      cumulative  -> audit opening + (debit - credit within [from, to]),
  --                     audit opening being the fiscal period's opening_balances
  --                     override where one exists, else the ledger opening
  --                     (everything posted before date_from). Identical to
  --                     rpc_trial_balance's Closing, deliberately.
  --    then sign is applied ('invert' negates, so income reads positive) and the
  --    accounts are summed into the line. LEFT JOINs throughout: an account with
  --    an opening balance but no movement, or no journal lines at all, must
  --    still contribute — dropping it is how a balance silently disappears.
  UPDATE fs_eval_values ev
  SET value = COALESCE(sub.v, 0), resolved = true
  FROM (
    WITH line_acct AS (
      SELECT l.id AS line_id, l.sign, l.value_basis, la.account_id
      FROM public.fs_lines l
      JOIN public.fs_line_accounts la ON la.line_id = l.id
      WHERE l.statement_id = p_statement_id AND l.line_type = 'detail'
    ),
    mv AS (
      SELECT jl.account_id,
             SUM(CASE WHEN je.entry_date < p_date_from
                      THEN COALESCE(jl.debit,0) - COALESCE(jl.credit,0) ELSE 0 END) AS led_open,
             SUM(CASE WHEN je.entry_date BETWEEN p_date_from AND p_date_to
                      THEN COALESCE(jl.debit,0) - COALESCE(jl.credit,0) ELSE 0 END) AS period_net
      FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
        AND je.entry_date <= p_date_to
        AND jl.account_id IN (SELECT la2.account_id FROM line_acct la2)
      GROUP BY jl.account_id
    ),
    ob AS (
      SELECT o.account_id, COALESCE(o.debit,0) - COALESCE(o.credit,0) AS aud_open
      FROM public.opening_balances o
      WHERE o.tenant_id = v_tenant
        AND v_period_id IS NOT NULL AND o.fiscal_period_id = v_period_id
    ),
    per_acct AS (
      SELECT la.line_id, la.sign,
             CASE WHEN la.value_basis = 'cumulative'
                  THEN COALESCE(ob.aud_open, mv.led_open, 0) + COALESCE(mv.period_net, 0)
                  ELSE COALESCE(mv.period_net, 0)
             END AS raw
      FROM line_acct la
      LEFT JOIN mv ON mv.account_id = la.account_id
      LEFT JOIN ob ON ob.account_id = la.account_id
    )
    SELECT pa.line_id, SUM(CASE WHEN pa.sign = 'invert' THEN -pa.raw ELSE pa.raw END) AS v
    FROM per_acct pa
    GROUP BY pa.line_id
  ) sub
  WHERE ev.line_id = sub.line_id;

  UPDATE fs_eval_values ev SET value = 0, resolved = true
  FROM public.fs_lines l
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type = 'detail' AND NOT ev.resolved;

  UPDATE fs_eval_values ev SET resolved = true
  FROM public.fs_lines l
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type IN ('spacer', 'text') AND NOT ev.resolved;

  -- 2. computed lines: fixed-point iteration, bounded at 20 passes.
  FOR v_pass IN 1..20 LOOP
    UPDATE fs_eval_values ev
    SET value = sub.v, resolved = true
    FROM (
      SELECT l.id AS line_id, SUM(t.factor * evt.value) AS v
      FROM public.fs_lines l
      JOIN public.fs_line_terms t ON t.line_id = l.id
      JOIN fs_eval_values evt ON evt.line_id = t.term_line_id
      WHERE l.statement_id = p_statement_id AND l.line_type = 'computed'
      GROUP BY l.id
      HAVING bool_and(evt.resolved)
    ) sub
    WHERE ev.line_id = sub.line_id AND NOT ev.resolved;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;

  SELECT count(*) INTO v_unresolved
  FROM fs_eval_values ev JOIN public.fs_lines l ON l.id = ev.line_id
  WHERE l.statement_id = p_statement_id AND l.line_type = 'computed' AND NOT ev.resolved;
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'CYCLE: % computed line(s) on this statement never reached a fixed point — check fs_line_terms for a cycle', v_unresolved
      USING ERRCODE = '55000';
  END IF;

  -- 3. per_share
  UPDATE fs_eval_values ev
  SET value = CASE WHEN p.value IS NULL OR p.value = 0 THEN NULL ELSE evt.value / p.value END,
      resolved = true
  FROM public.fs_lines l
  JOIN public.fs_line_terms t ON t.line_id = l.id
  JOIN fs_eval_values evt ON evt.line_id = t.term_line_id
  LEFT JOIN public.fs_parameters p
         ON p.tenant_id = v_tenant AND p.key = l.param_key
        AND p.fiscal_period_id IS NOT DISTINCT FROM v_period_id
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type = 'per_share' AND NOT ev.resolved;

  UPDATE fs_eval_values ev SET value = NULL, resolved = true
  FROM public.fs_lines l
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type = 'per_share' AND NOT ev.resolved;

  -- 4. margin
  SELECT l.id, ev.value INTO v_base_line, v_base_value
  FROM public.fs_lines l JOIN fs_eval_values ev ON ev.line_id = l.id
  WHERE l.statement_id = p_statement_id AND l.is_margin_base LIMIT 1;

  RETURN QUERY
  SELECT
    ev.line_id,
    ev.value,
    CASE WHEN l.show_margin AND v_base_value IS NOT NULL AND v_base_value <> 0
         THEN round(ev.value / v_base_value * 100, 2) ELSE NULL END,
    COALESCE(la.n, 0)::int
  FROM fs_eval_values ev
  JOIN public.fs_lines l ON l.id = ev.line_id
  LEFT JOIN (
    SELECT fla.line_id AS mapped_line_id, count(*) AS n
    FROM public.fs_line_accounts fla
    GROUP BY fla.line_id
  ) la ON la.mapped_line_id = ev.line_id
  WHERE l.statement_id = p_statement_id;
END
$fn$;

-- ── 4. Coverage: report balance-sheet accounts left off the statement ───────
-- Same body as 20260816000001 plus one aggregated UNMAPPED_BS_ACCOUNT warning.
-- Aggregated on purpose: a tenant has dozens of asset/liability/equity ledgers
-- and one row each would bury the P&L errors that actually block an export.
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
  v_bs_count     int;
  v_bs_amount    numeric;
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

  -- UNMAPPED_ACCOUNT (error): a P&L account with movement and no line. This is
  -- how a statement quietly understates income, so it stays an error.
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

  -- UNMAPPED_BS_ACCOUNT (warning): asset/liability/equity accounts carrying a
  -- balance at date_to that are not on this statement. A SOCI that omits them
  -- is the standard presentation, so this can never be an error — it exists so
  -- that "everything is on the statement" is a checkable claim, not a hope.
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
        SELECT 1 FROM public.fs_line_accounts la
        JOIN public.fs_lines l ON l.id = la.line_id
        WHERE la.account_id = a.id AND l.statement_id = v_statement_id
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
      AND a.id NOT IN (SELECT pk.account_id FROM parked pk);

    IF abs(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0)) > 0.005 THEN
      RETURN QUERY SELECT 'TIE_OUT_VARIANCE', 'error', NULL::uuid, NULL::text, NULL::text,
        'Profit for the year does not tie to the trial balance''s net P&L movement for this range',
        round(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0), 2);
    END IF;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_coverage(text, date, date) TO authenticated;

-- ── 5. Seed function: new tenants get the memo section on the same basis ────
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

  -- Memorandum section, fenced off below EPS. No fs_line_terms row ever
  -- references these lines, so they never touch profit; value_basis
  -- 'cumulative' values them as closing balances, not period movement.
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order) VALUES
    (v_tenant, v_stmt, 'BS_MEMO_GAP',      '',                                        'spacer', 'natural', 'normal', 'period',     125),
    (v_tenant, v_stmt, 'BS_MEMO_HEADING',  'MEMORANDUM — NOT PART OF PROFIT OR LOSS', 'text',   'natural', 'bold',   'period',     128),
    (v_tenant, v_stmt, 'ASSETS',           'Assets',                                  'detail', 'natural', 'normal', 'cumulative', 130),
    (v_tenant, v_stmt, 'DUE_FROM_RELATED', 'Amount Due From Related Parties',         'detail', 'natural', 'normal', 'cumulative', 140);

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
