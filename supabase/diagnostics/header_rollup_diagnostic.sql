-- ============================================================================
-- DIAGNOSTIC (READ-ONLY) — Header roll-up integrity check
--
-- DO NOT commit this as a migration and DO NOT run it as DDL. It only SELECTs.
-- Run it for human review BEFORE the opt-in re-parenting in
-- reparent_1710_under_1700.sql.
--
-- How to run:
--   • Supabase Studio → SQL Editor → paste & run, OR
--   • psql "$SUPABASE_DB_URL" -f supabase/diagnostics/header_rollup_diagnostic.sql
--
-- Multi-tenant: every row is tenant-scoped (tenant_id is printed). The query is
-- read-only and never crosses tenants — parent/child always share a tenant_id.
--
-- It surfaces two classes of mis-displaying header accounts:
--   A. POSTABLE_PARENT  — an account that IS referenced as a parent_account_id
--      by ≥1 child but is still is_postable = TRUE. It will both mis-display
--      and (until flipped) accept erroneous direct postings.
--   B. MISLINKED_CHILD  — an account whose 4-digit code prefix implies it
--      belongs under a header (e.g. '1710' under '1700') but whose
--      parent_account_id is NULL or points elsewhere. A matching header must
--      exist in the same tenant for the row to surface. This is a HEURISTIC for
--      review only — nothing is changed based on it.
-- ============================================================================

-- Part A: parents that are still postable -----------------------------------
SELECT
  'POSTABLE_PARENT'                AS issue,
  p.tenant_id,
  p.account_code,
  p.account_name,
  p.is_postable,
  p.parent_account_id,
  NULL::text                       AS inferred_parent_code
FROM public.accounts p
WHERE p.is_postable = TRUE
  AND EXISTS (
    SELECT 1
    FROM public.accounts c
    WHERE c.parent_account_id = p.id
  )

UNION ALL

-- Part B: children whose code prefix implies a header they are not linked to --
SELECT
  'MISLINKED_CHILD'                AS issue,
  c.tenant_id,
  c.account_code,
  c.account_name,
  c.is_postable,
  c.parent_account_id,
  h.account_code                   AS inferred_parent_code
FROM public.accounts c
JOIN public.accounts h
  ON  h.tenant_id    = c.tenant_id
  AND h.account_code = substr(c.account_code, 1, 2) || '00'   -- e.g. 1710 -> 1700
  AND h.id <> c.id
WHERE c.account_code ~ '^[0-9]{4}$'             -- only plain 4-digit codes
  AND substr(c.account_code, 3, 2) <> '00'      -- the child is not itself a header
  AND (c.parent_account_id IS DISTINCT FROM h.id)

ORDER BY tenant_id, account_code;
