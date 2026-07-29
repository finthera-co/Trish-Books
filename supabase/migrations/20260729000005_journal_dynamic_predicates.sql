-- Build the WHERE clause dynamically so optional filters stay indexable.
--
-- 20260729000004 inlined the predicates but wrote each optional filter as
-- `(v_pattern IS NULL OR je.description ILIKE v_pattern)`. That OR is the problem:
-- the planner has to produce one plan that also works when v_pattern IS NULL, and
-- no index can serve that branch, so it falls back to a scan for everyone.
--
--   count, `IS NULL OR ILIKE` guard          21.5 ms
--   count, bind parameter, no guard           0.53 ms  (trigram Bitmap Index Scan)
--
-- A bind parameter is not the issue — a parameterised ILIKE uses the trigram index
-- fine. The guard is. So the predicate list is assembled per call and only the
-- filters actually in play are emitted; an unfiltered call gets a WHERE with no
-- ILIKE in it at all.
--
-- Every value goes in through format(%L), which quotes and escapes literals, so
-- caller input cannot alter the statement's structure. Nothing here is concatenated
-- raw.

CREATE OR REPLACE FUNCTION public.je_filter_sql(
  p_search text,
  p_status text,
  p_source text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_where   text := 'TRUE';
  v_status  text := NULLIF(p_status, 'all');
  v_source  text := NULLIF(p_source, 'all');
  v_pattern text := CASE WHEN COALESCE(p_search, '') = '' THEN NULL
                         ELSE '%' || p_search || '%' END;
  -- The UI's effective source is COALESCE(source_type, entry_type, 'manual').
  v_effective constant text :=
    format('COALESCE(NULLIF(je.source_type,%L), NULLIF(je.entry_type,%L), %L)', '', '', 'manual');
BEGIN
  IF v_status IS NOT NULL THEN
    v_where := v_where || format(' AND je.status = %L', v_status);
  END IF;

  IF v_source = 'other' THEN
    v_where := v_where || format(
      ' AND %s <> ALL (%L::text[])', v_effective,
      '{manual,invoice,payment_received,credit_note,depreciation,opening_balance}');
  ELSIF v_source IS NOT NULL THEN
    v_where := v_where || format(' AND %s = %L', v_effective, v_source);
  END IF;

  IF v_pattern IS NOT NULL THEN
    v_where := v_where || format(
      ' AND (je.description ILIKE %L OR je.reference ILIKE %L)', v_pattern, v_pattern);
  END IF;

  RETURN v_where;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_journal_entries(
  p_limit          int         DEFAULT 50,
  p_search         text        DEFAULT NULL,
  p_status         text        DEFAULT NULL,
  p_source         text        DEFAULT NULL,
  p_cursor_date    date        DEFAULT NULL,
  p_cursor_created timestamptz DEFAULT NULL,
  p_cursor_id      uuid        DEFAULT NULL,
  p_backward       boolean     DEFAULT false
)
RETURNS TABLE (
  id                  uuid,
  entry_date          date,
  created_at          timestamptz,
  description         text,
  reference           text,
  status              text,
  source_type         text,
  entry_type          text,
  is_system_generated boolean,
  reversal_of         uuid,
  void_reason         text,
  voided_at           timestamptz,
  total_debit         numeric,
  total_credit        numeric,
  journal_lines       jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit    int     := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_back     boolean := COALESCE(p_backward, false);
  v_where    text    := public.je_filter_sql(p_search, p_status, p_source);
  v_dir      text    := CASE WHEN v_back THEN 'ASC' ELSE 'DESC' END;
BEGIN
  -- Keyset cursor as a row-value comparison, which the planner turns into an
  -- Index Cond on idx_je_paging — the reason page 700 costs the same as page 1.
  IF p_cursor_id IS NOT NULL THEN
    v_where := v_where || format(
      ' AND (je.entry_date, je.created_at, je.id) %s (%L::date, %L::timestamptz, %L::uuid)',
      CASE WHEN v_back THEN '>' ELSE '<' END,
      p_cursor_date, p_cursor_created, p_cursor_id);
  END IF;

  RETURN QUERY EXECUTE format($q$
    WITH page AS (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at
      FROM public.journal_entries je
      WHERE %s
      ORDER BY je.entry_date %s, je.created_at %s, je.id %s
      LIMIT %s
    )
    SELECT p.id, p.entry_date, p.created_at, p.description, p.reference,
           p.status, p.source_type, p.entry_type, p.is_system_generated,
           p.reversal_of, p.void_reason, p.voided_at,
           COALESCE(l.total_debit, 0), COALESCE(l.total_credit, 0),
           COALESCE(l.lines, '[]'::jsonb)
    FROM page p
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(jl.debit), 0)  AS total_debit,
             COALESCE(SUM(jl.credit), 0) AS total_credit,
             jsonb_agg(jsonb_build_object(
               'id', jl.id, 'account_id', jl.account_id,
               'debit', jl.debit, 'credit', jl.credit,
               'accounts', jsonb_build_object('account_code', a.account_code,
                                              'account_name', a.account_name)
             ) ORDER BY a.account_code) AS lines
      FROM public.journal_lines jl
      LEFT JOIN public.accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = p.id
    ) l ON true
    -- The backward branch scanned ascending; both end up in display order here.
    ORDER BY p.entry_date DESC, p.created_at DESC, p.id DESC
  $q$, v_where, v_dir, v_dir, v_dir, v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.count_journal_entries(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_source text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  EXECUTE format('SELECT COUNT(*) FROM public.journal_entries je WHERE %s',
                 public.je_filter_sql(p_search, p_status, p_source))
    INTO v_count;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.je_filter_sql(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_journal_entries(int,text,text,text,date,timestamptz,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_journal_entries(text,text,text) TO authenticated;
