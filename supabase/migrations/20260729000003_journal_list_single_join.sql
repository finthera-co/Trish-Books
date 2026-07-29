-- Fold the per-row lines lookup into a single join.
--
-- 20260729000002 attached lines via CROSS JOIN LATERAL je_lines_json(je.id), which
-- is one set-returning function call per row — 50 calls a page, ~24 ms total. The
-- underlying keyset scan is 0.22 ms, so nearly all of that was call overhead.
--
-- Restructured: a CTE takes the page (indexed keyset scan, still 0.22 ms), then a
-- single join pulls the ~100 lines belonging to those 50 entries and aggregates
-- them in one pass. Same output shape, one scan instead of fifty.

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
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  RETURN QUERY
  WITH page AS (
    -- Forward and backward are two separate scans UNIONed rather than one scan with
    -- a conditional ORDER BY: a CASE in the sort key is opaque to the planner and
    -- would cost the index scan that makes this fast. Only one arm ever matches,
    -- and the other is pruned as a one-time filter.
    (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at
      FROM public.journal_entries je
      WHERE NOT COALESCE(p_backward, false)
        AND public.je_matches_filters(p_status, p_source, p_search,
                                      je.status, je.source_type, je.entry_type,
                                      je.description, je.reference)
        AND (
          p_cursor_id IS NULL
          OR (je.entry_date, je.created_at, je.id) < (p_cursor_date, p_cursor_created, p_cursor_id)
        )
      ORDER BY je.entry_date DESC, je.created_at DESC, je.id DESC
      LIMIT v_limit
    )
    UNION ALL
    (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at
      FROM public.journal_entries je
      WHERE COALESCE(p_backward, false)
        AND public.je_matches_filters(p_status, p_source, p_search,
                                      je.status, je.source_type, je.entry_type,
                                      je.description, je.reference)
        AND (
          p_cursor_id IS NULL
          OR (je.entry_date, je.created_at, je.id) > (p_cursor_date, p_cursor_created, p_cursor_id)
        )
      ORDER BY je.entry_date ASC, je.created_at ASC, je.id ASC
      LIMIT v_limit
    )
  ),
  lines AS (
    SELECT jl.journal_entry_id,
           COALESCE(SUM(jl.debit), 0)  AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit,
           jsonb_agg(
             jsonb_build_object(
               'id',         jl.id,
               'account_id', jl.account_id,
               'debit',      jl.debit,
               'credit',     jl.credit,
               'accounts',   jsonb_build_object(
                 'account_code', a.account_code,
                 'account_name', a.account_name
               )
             )
             ORDER BY a.account_code
           ) AS lines
    FROM public.journal_lines jl
    LEFT JOIN public.accounts a ON a.id = jl.account_id
    WHERE jl.journal_entry_id IN (SELECT page.id FROM page)
    GROUP BY jl.journal_entry_id
  )
  SELECT p.id, p.entry_date, p.created_at, p.description, p.reference,
         p.status, p.source_type, p.entry_type, p.is_system_generated,
         p.reversal_of, p.void_reason, p.voided_at,
         COALESCE(l.total_debit, 0), COALESCE(l.total_credit, 0),
         COALESCE(l.lines, '[]'::jsonb)
  FROM page p
  LEFT JOIN lines l ON l.journal_entry_id = p.id
  -- The backward arm scanned ascending; both arms are re-sorted here into the
  -- single display order the UI expects.
  ORDER BY p.entry_date DESC, p.created_at DESC, p.id DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.je_lines_json(uuid);

GRANT EXECUTE ON FUNCTION public.list_journal_entries(int,text,text,text,date,timestamptz,uuid,boolean) TO authenticated;
