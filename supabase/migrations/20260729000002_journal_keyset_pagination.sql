-- Keyset (cursor) pagination for the journal entry list.
--
-- Measured on the ~35k-entry tenant, fetching the deepest page:
--
--   OFFSET 34900, no composite index      57 ms   (Incremental Sort)
--   OFFSET 34900, + idx_je_tenant_paging  254 ms  (index scan + random heap fetch
--                                                  for every skipped row — WORSE)
--   keyset ROW(...) < ROW(...)            0.22 ms (Index Cond, flat with depth)
--
-- OFFSET is O(depth) whatever you index: the server still has to walk and discard
-- every row before the window. Keyset turns the cursor into an index condition, so
-- page 700 costs the same as page 1.
--
-- Two things about the index shape are load-bearing:
--
--   * It deliberately does NOT lead with tenant_id. The SELECT policy on this table
--     is `tenant_id = get_user_tenant_id() OR is_super_admin()`, and that OR stops
--     the planner using any tenant-leading index — idx_je_tenant_paging (added in
--     20260729000001) was never usable under RLS and is dropped below. With the
--     sort keys alone the cursor is an Index Cond and the tenant check is a cheap
--     residual filter.
--   * The column order matches the ORDER BY exactly, including DESC. A btree scans
--     either direction, so this serves the backward (last-page) branch too.

DROP INDEX IF EXISTS public.idx_je_tenant_paging;

CREATE INDEX IF NOT EXISTS idx_je_paging
  ON public.journal_entries (entry_date DESC, created_at DESC, id DESC);

-- Shared filter predicate, kept in one place so the list and the count can never
-- disagree about what matches.
--
-- The UI's notion of an entry's source is COALESCE(source_type, entry_type, 'manual').
-- That expression has no PostgREST equivalent, which is why this lives in SQL.
CREATE OR REPLACE FUNCTION public.je_matches_filters(
  p_status       text,
  p_source       text,
  p_search       text,
  p_row_status   text,
  p_source_type  text,
  p_entry_type   text,
  p_description  text,
  p_reference    text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    (p_status IS NULL OR p_status = 'all' OR p_row_status = p_status)
    AND (
      p_source IS NULL OR p_source = 'all'
      OR CASE
           WHEN p_source = 'other' THEN
             COALESCE(NULLIF(p_source_type, ''), NULLIF(p_entry_type, ''), 'manual')
               NOT IN ('manual','invoice','payment_received','credit_note','depreciation','opening_balance')
           ELSE
             COALESCE(NULLIF(p_source_type, ''), NULLIF(p_entry_type, ''), 'manual') = p_source
         END
    )
    AND (
      p_search IS NULL OR p_search = ''
      OR p_description ILIKE '%' || p_search || '%'
      OR p_reference   ILIKE '%' || p_search || '%'
    );
$$;

-- Lines for one entry, pre-aggregated with account code/name plus the entry totals
-- the list renders. Defined before its callers so both branches below can share it.
-- SECURITY INVOKER, so RLS on journal_lines/accounts still applies.
CREATE OR REPLACE FUNCTION public.je_lines_json(p_entry_id uuid)
RETURNS TABLE (total_debit numeric, total_credit numeric, lines jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(jl.debit), 0),
    COALESCE(SUM(jl.credit), 0),
    COALESCE(
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
      ),
      '[]'::jsonb
    )
  FROM public.journal_lines jl
  LEFT JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = p_entry_id;
$$;

-- One page of entries, lines included, in a single round trip.
--
-- SECURITY INVOKER on purpose: RLS still applies, so tenant isolation stays in the
-- policy rather than being re-implemented (and possibly mis-implemented) here.
--
-- Forward and backward are separate RETURN QUERY branches rather than a CASE in the
-- ORDER BY, because a conditional sort key is opaque to the planner and would give
-- up the index scan that makes this fast.
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
  IF NOT COALESCE(p_backward, false) THEN
    RETURN QUERY
    SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
           je.status, je.source_type, je.entry_type, je.is_system_generated,
           je.reversal_of, je.void_reason, je.voided_at,
           l.total_debit, l.total_credit, l.lines
    FROM public.journal_entries je
    CROSS JOIN LATERAL public.je_lines_json(je.id) l
    WHERE public.je_matches_filters(p_status, p_source, p_search,
                                    je.status, je.source_type, je.entry_type,
                                    je.description, je.reference)
      AND (
        p_cursor_id IS NULL
        OR (je.entry_date, je.created_at, je.id) < (p_cursor_date, p_cursor_created, p_cursor_id)
      )
    ORDER BY je.entry_date DESC, je.created_at DESC, je.id DESC
    LIMIT v_limit;
  ELSE
    -- Walking backwards (Previous / Last): scan ascending from the cursor, then
    -- flip the window back into display order.
    RETURN QUERY
    SELECT win.id, win.entry_date, win.created_at, win.description, win.reference,
           win.status, win.source_type, win.entry_type, win.is_system_generated,
           win.reversal_of, win.void_reason, win.voided_at,
           win.total_debit, win.total_credit, win.lines
    FROM (
      SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
             je.status, je.source_type, je.entry_type, je.is_system_generated,
             je.reversal_of, je.void_reason, je.voided_at,
             l.total_debit, l.total_credit, l.lines
      FROM public.journal_entries je
      CROSS JOIN LATERAL public.je_lines_json(je.id) l
      WHERE public.je_matches_filters(p_status, p_source, p_search,
                                      je.status, je.source_type, je.entry_type,
                                      je.description, je.reference)
        AND (
          p_cursor_id IS NULL
          OR (je.entry_date, je.created_at, je.id) > (p_cursor_date, p_cursor_created, p_cursor_id)
        )
      ORDER BY je.entry_date ASC, je.created_at ASC, je.id ASC
      LIMIT v_limit
    ) win
    ORDER BY win.entry_date DESC, win.created_at DESC, win.id DESC;
  END IF;
END;
$$;

-- Total matching the same filters. Separate from the page so turning pages does not
-- recount — the client only needs this when the filters change.
CREATE OR REPLACE FUNCTION public.count_journal_entries(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_source text DEFAULT NULL
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)
  FROM public.journal_entries je
  WHERE public.je_matches_filters(p_status, p_source, p_search,
                                  je.status, je.source_type, je.entry_type,
                                  je.description, je.reference);
$$;

-- Status tallies for the stat cards, in one round trip instead of three.
CREATE OR REPLACE FUNCTION public.journal_entry_stats()
RETURNS TABLE (total bigint, posted bigint, voided bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'posted'),
         COUNT(*) FILTER (WHERE status = 'voided')
  FROM public.journal_entries;
$$;

GRANT EXECUTE ON FUNCTION public.je_matches_filters(text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.je_lines_json(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_journal_entries(int,text,text,text,date,timestamptz,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_journal_entries(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.journal_entry_stats() TO authenticated;

ANALYZE public.journal_entries;
