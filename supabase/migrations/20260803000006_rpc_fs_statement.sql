-- Statement evaluation engine: rpc_fs_statement (figures) + rpc_fs_coverage
-- (diagnostics — part of the same commit because a caller must not be able to
-- render figures while forgetting to check coverage).
--
-- fn_fs_eval_statement is the shared per-period evaluator: detail lines sum
-- their mapped accounts' movement (sign applied uniformly), computed lines
-- iterate fs_line_terms to a fixed point (bounded passes; no progress with
-- unresolved computed lines remaining = a real cycle, not a partial statement),
-- per_share divides by a period fs_parameters value, and margin divides by the
-- statement's is_margin_base line. Both rpc_fs_statement (current + optional
-- comparative) and rpc_fs_coverage (CYCLE/MISSING_PARAM detection) call it.

CREATE OR REPLACE FUNCTION public.fn_fs_eval_statement(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (line_id uuid, value numeric, margin numeric, account_count integer)
-- VOLATILE (not STABLE): it uses a scratch CREATE TEMP TABLE internally, and
-- CREATE is rejected inside a non-volatile function regardless of caller. The
-- temp table is purely internal working state, dropped/refilled each call — no
-- externally visible side effect, so this is a labeling technicality, not a
-- real read/write concern for the STABLE callers (rpc_fs_statement, rpc_fs_coverage).
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
  DELETE FROM fs_eval_values;

  INSERT INTO fs_eval_values (line_id, value, resolved)
  SELECT id, NULL, false FROM public.fs_lines WHERE statement_id = p_statement_id;

  -- 1. detail lines: SUM over mapped accounts, sign applied. No mapped accounts
  --    (or no movement) -> 0, not NULL — an unmapped detail line is a coverage
  --    issue (rpc_fs_coverage), not a hole in the arithmetic.
  UPDATE fs_eval_values ev
  SET value = COALESCE(sub.v, 0), resolved = true
  FROM (
    SELECT l.id AS line_id,
           SUM(CASE WHEN l.sign = 'invert' THEN COALESCE(jl.credit,0) - COALESCE(jl.debit,0)
                    ELSE COALESCE(jl.debit,0) - COALESCE(jl.credit,0) END) AS v
    FROM public.fs_lines l
    JOIN public.fs_line_accounts la ON la.line_id = l.id
    JOIN public.journal_lines jl ON jl.account_id = la.account_id
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'detail'
      AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
    GROUP BY l.id
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

  -- 2. computed lines: fixed-point iteration, bounded at 20 passes. A line's
  --    terms are joined unconditionally (not pre-filtered to resolved-only) so
  --    bool_and(evt.resolved) in HAVING is a true "every term is in" check —
  --    the SUM alongside it is only ever looked at for rows that pass HAVING.
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

  -- 3. per_share: numerator (its single fs_line_terms row) / fs_parameters[param_key]
  --    for the enclosing period. Missing or zero parameter -> NULL, never a
  --    divide-by-zero and never a fabricated denominator.
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

  -- 4. margin: value / (is_margin_base line's value) for lines with show_margin.
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
    SELECT line_id, count(*) AS n FROM public.fs_line_accounts GROUP BY line_id
  ) la ON la.line_id = ev.line_id
  WHERE l.statement_id = p_statement_id;
END
$fn$;

-- ── rpc_fs_statement ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fs_statement(
  p_statement_code text,
  p_date_from      date,
  p_date_to        date,
  p_cmp_date_from  date DEFAULT NULL,
  p_cmp_date_to    date DEFAULT NULL
)
RETURNS TABLE (
  line_id        uuid,
  line_code      text,
  label          text,
  note_ref       text,
  line_type      text,
  emphasis       text,
  show_margin    boolean,
  sort_order     integer,
  current_value  numeric,
  compare_value  numeric,
  current_margin numeric,
  compare_margin numeric,
  account_count  integer
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE v_statement_id uuid;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit' USING ERRCODE = '22003';
  END IF;
  IF p_cmp_date_from IS NOT NULL THEN
    IF p_cmp_date_to IS NULL OR p_cmp_date_to < p_cmp_date_from THEN
      RAISE EXCEPTION 'Invalid comparative range' USING ERRCODE = '22007';
    END IF;
  END IF;

  SELECT id INTO v_statement_id FROM public.fs_statements
  WHERE tenant_id = public.get_user_tenant_id() AND code = p_statement_code;
  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'No statement with code % for this tenant', p_statement_code USING ERRCODE = '42704';
  END IF;

  RETURN QUERY
  SELECT
    l.id, l.line_code, l.label, l.note_ref, l.line_type, l.emphasis, l.show_margin, l.sort_order,
    cur.value,
    CASE WHEN p_cmp_date_from IS NULL THEN NULL ELSE cmp.value END,
    cur.margin,
    CASE WHEN p_cmp_date_from IS NULL THEN NULL ELSE cmp.margin END,
    cur.account_count
  FROM public.fs_lines l
  JOIN public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to) cur ON cur.line_id = l.id
  -- Plain (non-lateral) join, called once for all lines — a LATERAL correlated
  -- only via the final line_id match would re-run the whole fixed-point
  -- evaluation once per line instead of once per statement. When no comparative
  -- range was requested, fall back to evaluating the current range again (cheap,
  -- already-cached-by-the-planner-adjacent call) and just null the columns out.
  LEFT JOIN public.fn_fs_eval_statement(
    v_statement_id,
    COALESCE(p_cmp_date_from, p_date_from),
    COALESCE(p_cmp_date_to, p_date_to)
  ) cmp ON cmp.line_id = l.id
  WHERE l.statement_id = v_statement_id
  ORDER BY l.sort_order;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_statement(text, date, date, date, date) TO authenticated;

-- ── rpc_fs_coverage ──────────────────────────────────────────────────────────
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
  -- P&L movement for the same range, same sign convention (credit - debit).
  SELECT id INTO v_profit_line FROM public.fs_lines
  WHERE statement_id = v_statement_id AND line_code = 'PROFIT_FOR_YEAR';

  IF v_profit_line IS NOT NULL THEN
    SELECT value INTO v_stmt_profit
    FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to)
    WHERE line_id = v_profit_line;

    SELECT SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)) INTO v_tb_profit
    FROM public.accounts a
    JOIN public.journal_lines jl ON jl.account_id = a.id
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE a.tenant_id = v_tenant
      AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
      AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to;

    IF abs(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0)) > 0.005 THEN
      RETURN QUERY SELECT 'TIE_OUT_VARIANCE', 'error', NULL::uuid, NULL::text, NULL::text,
        'Profit for the year does not tie to the trial balance''s net P&L movement for this range',
        round(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0), 2);
    END IF;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_coverage(text, date, date) TO authenticated;
