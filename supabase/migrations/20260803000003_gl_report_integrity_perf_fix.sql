-- Performance fix for rpc_gl_integrity: UNBALANCED_ENTRY, SINGLE_LINE_ENTRY and
-- DEGENERATE_LINE each independently re-scanned and re-joined every posted
-- line in range. Measured 535ms at a seeded 305-account/120k-line dataset —
-- over the <=300ms budget, and worse at the full 250k-line target. Sharing one
-- filtered join (range_lines) and one grouped pass (entry_agg) across all three
-- checks turns three full scans into one.
CREATE OR REPLACE FUNCTION public.rpc_gl_integrity(
  p_date_from date,
  p_date_to   date
)
RETURNS TABLE (
  severity   text,
  code       text,
  entity_id  uuid,
  detail     text,
  amount     numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public SET statement_timeout = '30s'
AS $fn$
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit (% days requested)', p_date_to - p_date_from
      USING ERRCODE = '22003';
  END IF;

  RETURN QUERY
  WITH range_lines AS (
    SELECT jl.id, jl.journal_entry_id, je.reference,
           COALESCE(jl.debit,0) AS debit, COALESCE(jl.credit,0) AS credit
    FROM public.journal_entries je
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.tenant_id = public.get_user_tenant_id()
      AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
  ),
  entry_agg AS (
    SELECT journal_entry_id, reference, count(*) AS n, sum(debit - credit) AS net
    FROM range_lines
    GROUP BY journal_entry_id, reference
  )
  SELECT 'error', 'UNBALANCED_ENTRY', journal_entry_id,
         'Entry ' || COALESCE(reference, journal_entry_id::text) || ' does not balance',
         round(net, 2)
  FROM entry_agg
  WHERE abs(net) > 0.005

  UNION ALL
  SELECT 'error', 'SINGLE_LINE_ENTRY', journal_entry_id,
         'Entry ' || COALESCE(reference, journal_entry_id::text) || ' has fewer than two lines', NULL
  FROM entry_agg
  WHERE n < 2

  UNION ALL
  SELECT 'warning', 'DEGENERATE_LINE', id,
         'Line has both debit and credit, or neither', NULL
  FROM range_lines
  WHERE (debit <> 0 AND credit <> 0) OR (debit = 0 AND credit = 0)

  UNION ALL
  SELECT 'error', 'CROSS_TENANT_LINE', jl.id,
         'Journal line references an account belonging to a different tenant', NULL
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE je.tenant_id = public.get_user_tenant_id() AND a.tenant_id <> je.tenant_id

  UNION ALL
  SELECT 'warning', 'POSTING_TO_PARENT', a.id,
         'Account ' || a.account_code || ' ' || a.account_name || ' is marked non-postable but has postings in range', NULL
  FROM public.accounts a
  WHERE a.tenant_id = public.get_user_tenant_id() AND a.is_postable = false
    AND EXISTS (
      SELECT 1 FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = a.id AND je.status = 'posted' AND je.voided_at IS NULL
        AND je.entry_date BETWEEN p_date_from AND p_date_to)

  UNION ALL
  SELECT 'warning', 'ORPHAN_ACCOUNT', a.id,
         'Account ' || a.account_code || ' has a parent that does not exist in this tenant', NULL
  FROM public.accounts a
  WHERE a.tenant_id = public.get_user_tenant_id() AND a.parent_account_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.accounts p
                    WHERE p.id = a.parent_account_id AND p.tenant_id = a.tenant_id);
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_gl_integrity(date, date) TO authenticated;
