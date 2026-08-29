-- list_journal_entries() dropped journal_lines.memo from its payload, so the
-- Journal Entries list rendered every line's Description as the inherited entry
-- description — the line's own narration was simply not on the wire. That is
-- wrong for any entry whose legs differ from each other, and newly visible now
-- that a suspense line can be split across several accounts: three legs of one
-- reclass would all have read as the same text.
--
-- Also orders the legs by jl.seq (insertion order — the sole deterministic
-- intra-entry order, see 20260803000000) instead of account_code, so the list
-- expansion and the entry detail page show the lines in the same order.
--
-- Body is otherwise identical to 20260729000005_journal_dynamic_predicates.sql.

CREATE OR REPLACE FUNCTION public.list_journal_entries(
  p_limit          integer   DEFAULT 50,
  p_search         text      DEFAULT NULL,
  p_status         text      DEFAULT NULL,
  p_source         text      DEFAULT NULL,
  p_cursor_date    date      DEFAULT NULL,
  p_cursor_created timestamptz DEFAULT NULL,
  p_cursor_id      uuid      DEFAULT NULL,
  p_backward       boolean   DEFAULT false
)
RETURNS TABLE(
  id uuid, entry_date date, created_at timestamptz, description text, reference text,
  status text, source_type text, entry_type text, is_system_generated boolean,
  reversal_of uuid, void_reason text, voided_at timestamptz,
  total_debit numeric, total_credit numeric, journal_lines jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
               'memo', jl.memo, 'seq', jl.seq,
               'accounts', jsonb_build_object('account_code', a.account_code,
                                              'account_name', a.account_name)
             ) ORDER BY jl.seq) AS lines
      FROM public.journal_lines jl
      LEFT JOIN public.accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = p.id
    ) l ON true
    -- The backward branch scanned ascending; both end up in display order here.
    ORDER BY p.entry_date DESC, p.created_at DESC, p.id DESC
  $q$, v_where, v_dir, v_dir, v_dir, v_limit);
END;
$function$;
