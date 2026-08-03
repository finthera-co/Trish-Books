-- Fix: "cannot execute CREATE TABLE in a read-only transaction" when the real
-- browser client calls rpc_fs_statement / rpc_fs_coverage through PostgREST.
--
-- PostgREST inspects a called function's OWN declared volatility (pg_proc's
-- provolatile) to decide whether to wrap the request in a read-only
-- transaction — a STABLE-marked function gets one, for connection-pooling /
-- read-replica routing purposes. A Postgres transaction has a single
-- read-only flag for its whole duration, not one per nested call, so marking
-- fn_fs_eval_statement VOLATILE (already fixed, since it does CREATE TEMP
-- TABLE) was not enough: rpc_fs_statement and rpc_fs_coverage themselves are
-- still STABLE, so PostgREST still opens a read-only transaction around the
-- whole request, and the temp table create inside the nested call still fails.
--
-- This didn't surface during development because `supabase db query` runs as
-- a plain SQL session, bypassing PostgREST's per-request transaction wrapping
-- entirely — only a real client call through the REST API hits this path.
--
-- Fix: mark both entry points VOLATILE too. Bodies are otherwise unchanged.
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
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
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
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
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
