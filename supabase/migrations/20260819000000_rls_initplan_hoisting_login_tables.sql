-- Extend the InitPlan-hoisting fix from 20260729000007_rls_initplan_hoisting.sql to
-- the tables the app reads on every login (src/lib/criticalQueries.ts): invoices,
-- customers, vendors, fiscal_periods. Their SELECT/ALL policies still called
-- get_user_tenant_id() / is_super_admin() directly, which Postgres re-evaluates per
-- row instead of once per query -- the same cost pattern already fixed for
-- journal_entries/journal_lines/accounts.
--
-- This is the root cause of the "connection is slow" banner (src/hooks/useNetworkStatus.ts,
-- 5s threshold) firing right after login: AppLayout fires 5 CRITICAL_QUERIES in
-- parallel, and the invoices query compounds two unhoisted, non-sargable RLS
-- filters (its own, plus the embedded customers(name) join's) with an
-- ORDER BY ... LIMIT 100 that could not use a tenant-leading index while tenant_id
-- was compared against a function call rather than a constant.
--
-- Wrapping each call in a scalar subquery turns it into an InitPlan: evaluated once,
-- then treated as a constant. The helpers are all STABLE and take no arguments, so
-- this changes only WHEN they are evaluated, never the result -- the policies grant
-- and deny exactly what they did before.

-- ── customers ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant customers" ON public.customers;
CREATE POLICY "Users can view own tenant customers"
  ON public.customers FOR SELECT
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage customers" ON public.customers;
CREATE POLICY "Authorized users can manage customers"
  ON public.customers FOR ALL
  USING (tenant_id = (SELECT public.get_user_tenant_id()));

-- ── invoices ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant invoices" ON public.invoices;
CREATE POLICY "Users can view own tenant invoices"
  ON public.invoices FOR SELECT
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage invoices" ON public.invoices;
CREATE POLICY "Authorized users can manage invoices"
  ON public.invoices FOR ALL
  USING (tenant_id = (SELECT public.get_user_tenant_id()));

-- ── vendors ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant vendors" ON public.vendors;
CREATE POLICY "Users can view own tenant vendors"
  ON public.vendors FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage vendors" ON public.vendors;
CREATE POLICY "Authorized users can manage vendors"
  ON public.vendors FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()));

-- ── fiscal_periods ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Users can view own tenant fiscal periods"
  ON public.fiscal_periods FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Authorized users can manage fiscal periods"
  ON public.fiscal_periods FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id()));

-- With tenant_id now compared against a constant, a tenant-leading index is usable
-- for the login-time read: .eq(tenant_id).order(issue_date desc).limit(100)
-- (src/lib/criticalQueries.ts).
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_issue_date
  ON public.invoices (tenant_id, issue_date DESC);

ANALYZE public.customers;
ANALYZE public.invoices;
ANALYZE public.vendors;
ANALYZE public.fiscal_periods;
