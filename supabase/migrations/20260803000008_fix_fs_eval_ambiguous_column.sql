-- Fix: the account_count subquery's unqualified `line_id` (both in its SELECT
-- list and GROUP BY) collided with the plpgsql OUT-parameter variable of the
-- same name that RETURNS TABLE(line_id, ...) implicitly declares in scope.
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
  DELETE FROM fs_eval_values;

  INSERT INTO fs_eval_values (line_id, value, resolved)
  SELECT id, NULL, false FROM public.fs_lines WHERE statement_id = p_statement_id;

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
