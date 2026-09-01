-- Deleted journal entries were unviewable. delete_journal_entry() is a hard
-- delete, but before it drops the row it snapshots the complete entry AND every
-- one of its lines into audit_logs.details as {entry: {...}, lines: [...]}, so
-- the record has been sitting there since 20260817133841 with no way to read it
-- back. That is a real audit gap: "this entry existed and someone removed it" is
-- exactly what a reviewer needs to see, and the deletion is otherwise invisible
-- to everyone but a Super Admin reading raw audit logs.
--
-- These functions reconstruct a journal-entry row from that snapshot so the
-- Journal Entries list can render deleted entries with the same table, the same
-- expandable lines and the same paging as live ones.
--
-- SECURITY INVOKER (the default) throughout: audit_logs' own RLS policy is
-- `tenant_id = get_user_tenant_id() OR is_super_admin()`, so tenant isolation is
-- enforced by the same policy that guards every other read. Nothing here needs
-- to see across tenants, so nothing here is SECURITY DEFINER.

-- Partial index: audit_logs collects every action in the system, and this view
-- wants one narrow slice of it in deletion order. Restricting the index to that
-- slice keeps it small and makes the keyset cursor an Index Cond.
CREATE INDEX IF NOT EXISTS idx_audit_journal_deleted
  ON public.audit_logs (created_at DESC, id DESC)
  WHERE action = 'Journal Deleted' AND table_name = 'journal_entries';

-- Shared predicate, so the list and the count can never disagree about what
-- matches — the same reason je_filter_sql exists for live entries.
--
-- Every caller value goes in through format(%L), which quotes and escapes, so
-- input cannot alter the statement's structure.
CREATE OR REPLACE FUNCTION public.je_deleted_filter_sql(
  p_search text,
  p_source text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_where   text := $w$al.action = 'Journal Deleted' AND al.table_name = 'journal_entries' AND al.details ? 'entry'$w$;
  v_source  text := NULLIF(p_source, 'all');
  v_pattern text := CASE WHEN COALESCE(p_search, '') = '' THEN NULL
                         ELSE '%' || p_search || '%' END;
  -- Same effective-source rule the live list uses, read out of the snapshot.
  v_effective constant text := $e$COALESCE(NULLIF(al.details->'entry'->>'source_type',''), NULLIF(al.details->'entry'->>'entry_type',''), 'manual')$e$;
BEGIN
  IF v_source = 'other' THEN
    v_where := v_where || format(
      ' AND %s <> ALL (%L::text[])', v_effective,
      '{manual,invoice,payment_received,credit_note,depreciation,opening_balance}');
  ELSIF v_source IS NOT NULL THEN
    v_where := v_where || format(' AND %s = %L', v_effective, v_source);
  END IF;

  IF v_pattern IS NOT NULL THEN
    v_where := v_where || format(
      ' AND ((al.details->''entry''->>''description'') ILIKE %L OR (al.details->''entry''->>''reference'') ILIKE %L)',
      v_pattern, v_pattern);
  END IF;

  RETURN v_where;
END;
$$;

-- One page of deleted entries, newest deletion first.
--
-- The keyset runs on (al.created_at, al.id) — when it was deleted, not when it
-- was entered — because that is the order the page presents and the only one
-- the partial index can serve.
CREATE OR REPLACE FUNCTION public.list_deleted_journal_entries(
  p_limit          int         DEFAULT 50,
  p_search         text        DEFAULT NULL,
  p_source         text        DEFAULT NULL,
  p_cursor_deleted timestamptz DEFAULT NULL,
  p_cursor_audit   uuid        DEFAULT NULL,
  p_backward       boolean     DEFAULT false
)
RETURNS TABLE(
  id uuid, entry_date date, created_at timestamptz, description text, reference text,
  status text, source_type text, entry_type text, is_system_generated boolean,
  reversal_of uuid, void_reason text, voided_at timestamptz,
  total_debit numeric, total_credit numeric, journal_lines jsonb,
  audit_id uuid, deleted_at timestamptz, deleted_by text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit int     := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_back  boolean := COALESCE(p_backward, false);
  v_where text    := public.je_deleted_filter_sql(p_search, p_source);
  v_dir   text    := CASE WHEN v_back THEN 'ASC' ELSE 'DESC' END;
BEGIN
  IF p_cursor_audit IS NOT NULL THEN
    v_where := v_where || format(
      ' AND (al.created_at, al.id) %s (%L::timestamptz, %L::uuid)',
      CASE WHEN v_back THEN '>' ELSE '<' END,
      p_cursor_deleted, p_cursor_audit);
  END IF;

  RETURN QUERY EXECUTE format($q$
    WITH page AS (
      SELECT al.id AS audit_id, al.created_at AS deleted_at, al.user_id,
             al.details->'entry' AS je, al.details->'lines' AS jl
      FROM public.audit_logs al
      WHERE %s
      ORDER BY al.created_at %s, al.id %s
      LIMIT %s
    )
    SELECT (p.je->>'id')::uuid,
           (p.je->>'entry_date')::date,
           NULLIF(p.je->>'created_at','')::timestamptz,
           p.je->>'description',
           p.je->>'reference',
           p.je->>'status',
           p.je->>'source_type',
           p.je->>'entry_type',
           COALESCE((p.je->>'is_system_generated')::boolean, false),
           NULLIF(p.je->>'reversal_of','')::uuid,
           p.je->>'void_reason',
           NULLIF(p.je->>'voided_at','')::timestamptz,
           COALESCE(l.total_debit, 0),
           COALESCE(l.total_credit, 0),
           COALESCE(l.lines, '[]'::jsonb),
           p.audit_id,
           p.deleted_at,
           COALESCE(NULLIF(concat_ws(' ', u.first_name, u.last_name), ''), 'Unknown')
    FROM page p
    LEFT JOIN public.users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      -- Account names are joined live: the account may have been renamed, or
      -- itself deleted, since the entry was removed. LEFT JOIN so a missing
      -- account leaves nulls rather than dropping the line.
      SELECT COALESCE(SUM(COALESCE((e->>'debit')::numeric, 0)), 0)  AS total_debit,
             COALESCE(SUM(COALESCE((e->>'credit')::numeric, 0)), 0) AS total_credit,
             jsonb_agg(jsonb_build_object(
               'id', e->>'id',
               'account_id', e->>'account_id',
               'debit', COALESCE((e->>'debit')::numeric, 0),
               'credit', COALESCE((e->>'credit')::numeric, 0),
               'memo', e->>'memo',
               'seq', (e->>'seq')::int,
               'accounts', jsonb_build_object('account_code', a.account_code,
                                              'account_name', a.account_name)
             ) ORDER BY (e->>'seq')::int NULLS LAST) AS lines
      FROM jsonb_array_elements(COALESCE(p.jl, '[]'::jsonb)) e
      LEFT JOIN public.accounts a ON a.id = NULLIF(e->>'account_id','')::uuid
    ) l ON true
    -- The backward branch scanned ascending; both end up in display order here.
    ORDER BY p.deleted_at DESC, p.audit_id DESC
  $q$, v_where, v_dir, v_dir, v_limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_deleted_journal_entries(
  p_search text DEFAULT NULL,
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
  EXECUTE format('SELECT COUNT(*) FROM public.audit_logs al WHERE %s',
                 public.je_deleted_filter_sql(p_search, p_source))
  INTO v_count;
  RETURN v_count;
END;
$$;

-- Stat cards gain a Deleted tally. Return type changes, so this cannot be a
-- plain CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.journal_entry_stats();

CREATE OR REPLACE FUNCTION public.journal_entry_stats()
RETURNS TABLE(total bigint, posted bigint, voided bigint, deleted bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT s.total, s.posted, s.voided,
         (SELECT COUNT(*) FROM public.audit_logs al
           WHERE al.action = 'Journal Deleted' AND al.table_name = 'journal_entries')
  FROM (
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'posted') AS posted,
           COUNT(*) FILTER (WHERE status = 'voided') AS voided
    FROM public.journal_entries
  ) s;
$function$;

GRANT EXECUTE ON FUNCTION public.je_deleted_filter_sql(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_deleted_journal_entries(int,text,text,timestamptz,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_deleted_journal_entries(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.journal_entry_stats() TO authenticated;

COMMENT ON FUNCTION public.list_deleted_journal_entries(int,text,text,timestamptz,uuid,boolean) IS
  'Reconstructs hard-deleted journal entries from their audit_logs snapshot so they remain viewable (read-only) in the Journal Entries list. Tenant-scoped by audit_logs RLS.';
