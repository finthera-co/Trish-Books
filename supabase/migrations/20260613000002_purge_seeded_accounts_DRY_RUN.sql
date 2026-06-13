-- ============================================================================
-- DRY RUN ONLY — DO NOT ENABLE WITHOUT PER-TENANT REVIEW
-- ============================================================================
-- Existing tenants were previously auto-seeded with a full default Chart of
-- Accounts. This migration helps identify those seed-generated accounts that
-- carry NO posted activity, so they can be reviewed and (manually) purged.
--
-- Some seeded accounts may already hold posted balances / journal activity and
-- MUST NOT be deleted. Therefore this file performs NO destructive action by
-- default. The SELECT below is for review only; the DELETE block is commented
-- out and must be enabled deliberately, per tenant, after review.
--
-- "Seed-generated, unused" is defined here as:
--   * is_system = false            (never touch the system OBE / control accounts)
--   * account_code <> '3900'       (never touch Opening Balance Equity)
--   * no journal_lines reference   (zero postings)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REVIEW STEP (non-destructive): list candidate accounts for removal.
-- ---------------------------------------------------------------------------
SELECT
  a.tenant_id,
  a.id,
  a.account_code,
  a.account_name,
  a.account_type,
  a.is_system,
  (SELECT count(*) FROM public.journal_lines jl WHERE jl.account_id = a.id) AS journal_line_count
FROM public.accounts a
WHERE a.is_system = false
  AND a.account_code <> '3900'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl WHERE jl.account_id = a.id
  )
ORDER BY a.tenant_id, a.account_code;

-- ---------------------------------------------------------------------------
-- DESTRUCTIVE STEP (DISABLED): uncomment ONLY after reviewing the list above.
-- Scope to a single tenant by adding:  AND a.tenant_id = '<tenant-uuid>'
-- Deletes accounts with zero journal_lines, zero transactions, and not OBE.
-- ---------------------------------------------------------------------------
-- DELETE FROM public.accounts a
-- WHERE a.is_system = false
--   AND a.account_code <> '3900'
--   AND NOT EXISTS (
--     SELECT 1 FROM public.journal_lines jl WHERE jl.account_id = a.id
--   );
