-- Removes the CREATE TEMP TABLE from fn_fs_eval_statement.
--
-- That one statement has now broken the live report twice, because it makes
-- the whole call chain's correctness depend on a HEADER KEYWORD: PostgREST
-- reads the entry point's provolatile to decide whether to open a read-only
-- transaction, and a read-only transaction cannot CREATE. Any future
-- CREATE OR REPLACE that types STABLE out of habit silently breaks the report
-- again, and no `supabase db query` test can catch it because that path never
-- applies PostgREST's transaction wrapping.
--
-- The fixed-point scratch state now lives in a jsonb local variable instead of
-- a temp table, so the function writes nothing, needs no particular volatility
-- to be correct, and runs happily in a read-only transaction. The arithmetic is
-- unchanged — verified row-for-row against the previous implementation on live
-- tenant data before this was applied.
--
-- State shape: { "<line_id>": {"v": <numeric|null>, "r": <bool>} }
-- "r" is resolved, tracked separately from "v" because a resolved line may
-- legitimately hold NULL (an EPS line with no share-count parameter).

CREATE OR REPLACE FUNCTION public.fn_fs_eval_statement(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (line_id uuid, value numeric, margin numeric, account_count integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_period_id  uuid;
  v_state      jsonb;
  v_delta      jsonb;
  v_pass       int;
  v_rows       int;
  v_unresolved int;
  v_base_value numeric;
BEGIN
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(l.id::text, jsonb_build_object('v', NULL, 'r', false)), '{}'::jsonb)
  INTO v_state
  FROM public.fs_lines l WHERE l.statement_id = p_statement_id;

  IF v_state = '{}'::jsonb THEN
    RETURN;
  END IF;

  -- 1. detail lines: SUM of the per-account valuation. Unmapped or no
  --    movement resolves to 0, not NULL — an empty line is a coverage issue,
  --    not a hole in the arithmetic.
  SELECT v_state || COALESCE(jsonb_object_agg(x.lid::text, jsonb_build_object('v', x.v, 'r', true)), '{}'::jsonb)
  INTO v_state
  FROM (
    SELECT l.id AS lid, COALESCE(sub.v, 0) AS v
    FROM public.fs_lines l
    LEFT JOIN (
      SELECT a.out_line_id AS acc_line_id, SUM(a.out_value) AS v
      FROM public.fn_fs_eval_accounts(p_statement_id, p_date_from, p_date_to) a
      GROUP BY a.out_line_id
    ) sub ON sub.acc_line_id = l.id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'detail'
  ) x;

  -- 2. spacer / text lines carry no figure but are resolved.
  SELECT v_state || COALESCE(jsonb_object_agg(l.id::text, jsonb_build_object('v', NULL, 'r', true)), '{}'::jsonb)
  INTO v_state
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.line_type IN ('spacer', 'text');

  -- 3. computed lines: fixed-point iteration, bounded at 20 passes. Terms are
  --    joined unconditionally so bool_and(r) is a true "every term is in" test.
  FOR v_pass IN 1..20 LOOP
    WITH st AS (
      SELECT (e.key)::uuid AS lid, (e.value ->> 'v')::numeric AS v, (e.value ->> 'r')::boolean AS r
      FROM jsonb_each(v_state) e
    ),
    newly AS (
      SELECT l.id AS lid, SUM(t.factor * term.v) AS v
      FROM public.fs_lines l
      JOIN st self ON self.lid = l.id AND NOT self.r
      JOIN public.fs_line_terms t ON t.line_id = l.id
      JOIN st term ON term.lid = t.term_line_id
      WHERE l.statement_id = p_statement_id AND l.line_type = 'computed'
      GROUP BY l.id
      HAVING bool_and(term.r)
    )
    SELECT COALESCE(jsonb_object_agg(n.lid::text, jsonb_build_object('v', n.v, 'r', true)), '{}'::jsonb),
           count(*)
    INTO v_delta, v_rows
    FROM newly n;

    v_state := v_state || v_delta;
    EXIT WHEN v_rows = 0;
  END LOOP;

  SELECT count(*) INTO v_unresolved
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.line_type = 'computed'
    AND NOT COALESCE((v_state -> l.id::text ->> 'r')::boolean, false);
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'CYCLE: % computed line(s) on this statement never reached a fixed point — check fs_line_terms for a cycle', v_unresolved
      USING ERRCODE = '55000';
  END IF;

  -- 4. per_share: numerator / fs_parameters[param_key] for the period. Missing
  --    or zero parameter -> NULL, never a divide-by-zero, never a fabricated
  --    denominator. DISTINCT ON pins a single numerator if a line ever grows a
  --    second term, rather than producing two conflicting answers.
  WITH st AS (
    SELECT (e.key)::uuid AS lid, (e.value ->> 'v')::numeric AS v, (e.value ->> 'r')::boolean AS r
    FROM jsonb_each(v_state) e
  ),
  ps AS (
    SELECT DISTINCT ON (l.id) l.id AS lid,
           CASE WHEN p.value IS NULL OR p.value = 0 THEN NULL ELSE term.v / p.value END AS v
    FROM public.fs_lines l
    JOIN st self ON self.lid = l.id AND NOT self.r
    JOIN public.fs_line_terms t ON t.line_id = l.id
    JOIN st term ON term.lid = t.term_line_id
    LEFT JOIN public.fs_parameters p
           ON p.tenant_id = v_tenant AND p.key = l.param_key
          AND p.fiscal_period_id IS NOT DISTINCT FROM v_period_id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'per_share'
    ORDER BY l.id, t.sort_order
  )
  SELECT COALESCE(jsonb_object_agg(ps.lid::text, jsonb_build_object('v', ps.v, 'r', true)), '{}'::jsonb)
  INTO v_delta FROM ps;
  v_state := v_state || v_delta;

  -- Any per_share line with no term at all still resolves, to NULL.
  SELECT COALESCE(jsonb_object_agg(l.id::text, jsonb_build_object('v', NULL, 'r', true)), '{}'::jsonb)
  INTO v_delta
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.line_type = 'per_share'
    AND NOT COALESCE((v_state -> l.id::text ->> 'r')::boolean, false);
  v_state := v_state || v_delta;

  -- 5. margin: value / the is_margin_base line's value.
  SELECT (v_state -> l.id::text ->> 'v')::numeric INTO v_base_value
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.is_margin_base LIMIT 1;

  RETURN QUERY
  SELECT l.id,
         (v_state -> l.id::text ->> 'v')::numeric,
         CASE WHEN l.show_margin AND v_base_value IS NOT NULL AND v_base_value <> 0
              THEN round(((v_state -> l.id::text ->> 'v')::numeric / v_base_value) * 100, 2)
              ELSE NULL END,
         COALESCE(la.n, 0)::int
  FROM public.fs_lines l
  LEFT JOIN (
    SELECT fla.line_id AS mapped_line_id, count(*) AS n
    FROM public.fs_line_accounts fla
    GROUP BY fla.line_id
  ) la ON la.mapped_line_id = l.id
  WHERE l.statement_id = p_statement_id;
END
$fn$;

-- The chain no longer writes anything, so the entry points are genuinely
-- read-only and can be routed as such.
ALTER FUNCTION public.rpc_fs_statement(text, date, date, date, date) STABLE;
ALTER FUNCTION public.rpc_fs_coverage(text, date, date) STABLE;

-- Guard the property itself rather than the keyword that used to stand in for
-- it: if a future edit reintroduces scratch-table creation anywhere in the
-- chain, this migration's invariant is the thing that must be revisited.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_fs_eval_statement', 'fn_fs_eval_accounts')
      AND pg_get_functiondef(p.oid) ILIKE '%CREATE TEMP TABLE%'
  ) THEN
    RAISE EXCEPTION 'The statement evaluator must not create temp tables — PostgREST runs it in a read-only transaction.';
  END IF;
END $$;
