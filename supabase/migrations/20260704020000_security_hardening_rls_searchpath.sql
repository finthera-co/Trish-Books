-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING
--   #5  Pin search_path on SECURITY DEFINER functions (Supabase linter:
--       "Function Search Path Mutable"). Without a fixed search_path a caller
--       who can create objects in an earlier schema could shadow the tables /
--       functions these run against.
--   #6  Close the "Primary Admin" RLS gap on public.users. The policy that lets
--       tenant admins manage their team granted only 'Company Admin', silently
--       excluding 'Primary Admin' (the role provisioned admins actually get), so
--       Primary Admins could not update/deactivate users from the UI. While
--       widening it, also forbid any tenant admin from assigning the Super Admin
--       role via a direct table write.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── #5: pin search_path ──────────────────────────────────────────────────────
ALTER FUNCTION public.ap_aging_report(p_as_of_date date) SET search_path = 'public';
ALTER FUNCTION public.ap_reconciliation_check(p_as_of_date date) SET search_path = 'public';
ALTER FUNCTION public.ar_aging_report(p_as_of_date date) SET search_path = 'public';
ALTER FUNCTION public.ar_reconciliation_check(p_as_of_date date) SET search_path = 'public';
ALTER FUNCTION public.asset_reconciliation_check() SET search_path = 'public';
ALTER FUNCTION public.calculate_gl_balance_for_account(p_account_id uuid, p_tenant_id uuid) SET search_path = 'public';

-- ── #6: Primary Admin can manage tenant users; block Super Admin assignment ───
DROP POLICY IF EXISTS "Company admins can manage tenant users" ON public.users;

CREATE POLICY "Tenant admins can manage tenant users" ON public.users
  FOR ALL TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role_name() = ANY (ARRAY['Company Admin'::text, 'Primary Admin'::text])
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role_name() = ANY (ARRAY['Company Admin'::text, 'Primary Admin'::text])
    -- A tenant admin may never create or promote a Super Admin.
    AND role_id <> (SELECT id FROM public.roles WHERE role_name = 'Super Admin')
  );
