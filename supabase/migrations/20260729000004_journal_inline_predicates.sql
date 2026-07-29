-- Inline the filter predicates. This is a correctness-of-plan fix, not a cleanup.
--
-- 20260729000002/3 factored the WHERE clause into je_matches_filters(...) so the
-- list and the count could not drift apart. That was the wrong trade: the planner
-- cannot see inside a function call, so it could no longer match
-- `description ILIKE '%term%'` to the trigram indexes from 20260729000001, and
-- every filtered read fell back to a full scan.
--
--   search 'rent', predicates wrapped in je_matches_filters   956 ms
--   search 'rent', predicates inline (trigram Bitmap Index)   2.3 ms
--
-- The UNION ALL arms added in ...0003 were the other half of the problem: the
-- `WHERE NOT p_backward` guard is not a plan-time constant, so both arms executed
-- on every call. Back to two plpgsql branches — only the taken branch is planned.
--
-- The filter text is therefore duplicated across the two branches here and again in
-- count_journal_entries below. That duplication is deliberate; keep the three copies
-- in step when changing filter semantics.

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
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_pattern text := CASE WHEN COALESCE(p_search, '') = '' THEN NULL
                         ELSE '%' || p_search || '%' END;
  v_status  text := NULLIF(p_status, 'all');
  v_source  text := NULLIF(p_source, 'all');
BEGIN
  IF NOT COALESCE(p_backward, false) THEN
    RETURN QUERY
    WITH page AS (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at
      FROM public.journal_entries je
      WHERE (v_status IS NULL OR je.status = v_status)
        AND (v_source IS NULL OR (
              CASE WHEN v_source = 'other' THEN
                COALESCE(NULLIF(je.source_type,''), NULLIF(je.entry_type,''), 'manual')
                  NOT IN ('manual','invoice','payment_received','credit_note','depreciation','opening_balance')
              ELSE
                COALESCE(NULLIF(je.source_type,''), NULLIF(je.entry_type,''), 'manual') = v_source
              END))
        AND (v_pattern IS NULL
             OR je.description ILIKE v_pattern
             OR je.reference   ILIKE v_pattern)
        AND (p_cursor_id IS NULL
             OR (je.entry_date, je.created_at, je.id) < (p_cursor_date, p_cursor_created, p_cursor_id))
      ORDER BY je.entry_date DESC, je.created_at DESC, je.id DESC
      LIMIT v_limit
    )
    SELECT p.id, p.entry_date, p.created_at, p.description, p.reference,
           p.status, p.source_type, p.entry_type, p.is_system_generated,
           p.reversal_of, p.void_reason, p.voided_at,
           COALESCE(l.total_debit, 0), COALESCE(l.total_credit, 0),
           COALESCE(l.lines, '[]'::jsonb)
    FROM page p
    LEFT JOIN LATERAL (
      -- One pass over just this page's lines (~100 rows), not one call per entry.
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
    ORDER BY p.entry_date DESC, p.created_at DESC, p.id DESC;

  ELSE
    -- Previous / Last: scan ascending away from the cursor, then flip the window
    -- back into display order.
    RETURN QUERY
    WITH page AS (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at
      FROM public.journal_entries je
      WHERE (v_status IS NULL OR je.status = v_status)
        AND (v_source IS NULL OR (
              CASE WHEN v_source = 'other' THEN
                COALESCE(NULLIF(je.source_type,''), NULLIF(je.entry_type,''), 'manual')
                  NOT IN ('manual','invoice','payment_received','credit_note','depreciation','opening_balance')
              ELSE
                COALESCE(NULLIF(je.source_type,''), NULLIF(je.entry_type,''), 'manual') = v_source
              END))
        AND (v_pattern IS NULL
             OR je.description ILIKE v_pattern
             OR je.reference   ILIKE v_pattern)
        AND (p_cursor_id IS NULL
             OR (je.entry_date, je.created_at, je.id) > (p_cursor_date, p_cursor_created, p_cursor_id))
      ORDER BY je.entry_date ASC, je.created_at ASC, je.id ASC
      LIMIT v_limit
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
    ORDER BY p.entry_date DESC, p.created_at DESC, p.id DESC;
  END IF;
END;
$$;

-- Same inlining, same reason: wrapped predicates cost this the trigram index too.
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
  v_pattern text := CASE WHEN COALESCE(p_search, '') = '' THEN NULL
                         ELSE '%' || p_search || '%' END;
  v_status  text := NULLIF(p_status, 'all');
  v_source  text := NULLIF(p_source, 'all');
  v_count   bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries je
  WHERE (v_status IS NULL OR je.status = v_status)
    AND (v_source IS NULL OR (
          CASE WHEN v_source = 'other' THEN
            COALESCE(NULLIF(je.source_type,''), NULLIF(je.entry_type,''), 'manual')
              NOT IN ('manual','invoice','payment_received','credit_note','depreciation','opening_balance')
          ELSE
            COALESCE(NULLIF(je.source_type,''), NULLIF(je.entry_type,''), 'manual') = v_source
          END))
    AND (v_pattern IS NULL
         OR je.description ILIKE v_pattern
         OR je.reference   ILIKE v_pattern);
  RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS public.je_matches_filters(text,text,text,text,text,text,text,text);

GRANT EXECUTE ON FUNCTION public.list_journal_entries(int,text,text,text,date,timestamptz,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_journal_entries(text,text,text) TO authenticated;
