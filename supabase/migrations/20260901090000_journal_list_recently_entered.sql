-- The Journal Entries list could only be read in entry-date order, which hides
-- the work you just did: an entry keyed in today against a March date lands
-- hundreds of pages down, and there was no way to ask "what has just been
-- entered?". p_order = 'created_at' re-sorts the same result set by when each
-- entry was actually recorded.
--
-- A sort, not a filter — nothing leaves the set, so count_journal_entries is
-- untouched and the pager totals stay correct in both modes.
--
-- The cursor payload already carried created_at, so the keyset needs no new
-- columns: in 'created_at' mode the row-value comparison simply drops
-- entry_date and compares (created_at, id).
--
-- p_order is collapsed to a boolean before it reaches the ORDER BY, so caller
-- input can never alter the statement's structure — same discipline as
-- je_filter_sql's format(%L) literals.

-- Mirrors idx_je_paging: sort keys only, no tenant_id. Leading with the sort
-- keys is what makes the cursor an Index Cond and leaves the RLS tenant check
-- as a cheap residual filter; tenant_id first would demote the cursor to a
-- filter and bring back the deep-page cost measured in 20260729000002.
CREATE INDEX IF NOT EXISTS idx_je_paging_created
  ON public.journal_entries (created_at DESC, id DESC);

-- The 8-arg version has to go: leaving it in place would give PostgREST two
-- overloads to choose between and it refuses the call as ambiguous.
DROP FUNCTION IF EXISTS public.list_journal_entries(int,text,text,text,date,timestamptz,uuid,boolean);

CREATE OR REPLACE FUNCTION public.list_journal_entries(
  p_limit          int         DEFAULT 50,
  p_search         text        DEFAULT NULL,
  p_status         text        DEFAULT NULL,
  p_source         text        DEFAULT NULL,
  p_cursor_date    date        DEFAULT NULL,
  p_cursor_created timestamptz DEFAULT NULL,
  p_cursor_id      uuid        DEFAULT NULL,
  p_backward       boolean     DEFAULT false,
  p_order          text        DEFAULT 'entry_date'
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
  v_limit   int     := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_back    boolean := COALESCE(p_backward, false);
  v_where   text    := public.je_filter_sql(p_search, p_status, p_source);
  v_dir     text    := CASE WHEN v_back THEN 'ASC' ELSE 'DESC' END;
  v_recent  boolean := COALESCE(p_order, 'entry_date') = 'created_at';
  v_keys    text;   -- inner sort keys, scan direction depends on p_backward
  v_outkeys text;   -- outer sort keys, always display order
BEGIN
  IF v_recent THEN
    v_keys    := format('je.created_at %1$s, je.id %1$s', v_dir);
    v_outkeys := 'p.created_at DESC, p.id DESC';
  ELSE
    v_keys    := format('je.entry_date %1$s, je.created_at %1$s, je.id %1$s', v_dir);
    v_outkeys := 'p.entry_date DESC, p.created_at DESC, p.id DESC';
  END IF;

  -- Keyset cursor as a row-value comparison, which the planner turns into an
  -- Index Cond — the reason page 700 costs the same as page 1, in either mode.
  IF p_cursor_id IS NOT NULL THEN
    IF v_recent THEN
      v_where := v_where || format(
        ' AND (je.created_at, je.id) %s (%L::timestamptz, %L::uuid)',
        CASE WHEN v_back THEN '>' ELSE '<' END,
        p_cursor_created, p_cursor_id);
    ELSE
      v_where := v_where || format(
        ' AND (je.entry_date, je.created_at, je.id) %s (%L::date, %L::timestamptz, %L::uuid)',
        CASE WHEN v_back THEN '>' ELSE '<' END,
        p_cursor_date, p_cursor_created, p_cursor_id);
    END IF;
  END IF;

  RETURN QUERY EXECUTE format($q$
    WITH page AS (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at
      FROM public.journal_entries je
      WHERE %s
      ORDER BY %s
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
    ORDER BY %s
  $q$, v_where, v_keys, v_limit, v_outkeys);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_journal_entries(int,text,text,text,date,timestamptz,uuid,boolean,text) TO authenticated;
