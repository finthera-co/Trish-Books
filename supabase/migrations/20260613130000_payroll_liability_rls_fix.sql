-- ============================================================================
-- Fix tenant isolation on payroll_liability_summary.
--
-- The view (20260609000003) is a plain Postgres view. By default a view runs
-- with the DEFINER's privileges and bypasses RLS on its underlying tables
-- (payroll_results, payroll_runs, payroll_remittances), so EVERY tenant saw
-- the same unfiltered aggregate — a tenant-isolation defect.
--
-- Postgres on this project is 17.6 (>= 15), so security_invoker is available.
-- With it on, the view evaluates the underlying tables with the QUERYING
-- user's privileges, applying their RLS. All three underlying tables already
-- have tenant-scoped SELECT policies keyed on get_user_tenant_id():
--   * payroll_runs        — "Users can view own tenant payroll runs"
--   * payroll_results     — "Tenant read payroll results"
--   * payroll_remittances — "tenant_payroll_remittances" (ALL)
-- so no new policy is required; the view simply starts honoring them.
--
-- This migration does NOT touch the void / partial-unique-index logic in
-- 20260609000003, and does not redefine the view body.
-- ============================================================================

ALTER VIEW public.payroll_liability_summary SET (security_invoker = on);

COMMENT ON VIEW public.payroll_liability_summary IS
  'EPF/ETF liability aggregate per tenant/period. Runs with security_invoker=on '
  '(PG15+) so the underlying tables'' tenant RLS policies filter results to the '
  'querying tenant. Hooks also pass an explicit .eq(tenant_id) as defense-in-depth.';
