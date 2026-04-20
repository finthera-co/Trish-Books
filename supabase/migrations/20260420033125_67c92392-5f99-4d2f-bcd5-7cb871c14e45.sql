DROP POLICY IF EXISTS "Admins can insert settings" ON public.account_settings;
DROP POLICY IF EXISTS "Admins can manage settings" ON public.account_settings;
DROP POLICY IF EXISTS "Tenant members can view settings" ON public.account_settings;

CREATE POLICY "Tenant members can view settings"
ON public.account_settings
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR tenant_id = public.get_user_tenant_id()
);

CREATE POLICY "Tenant admins can manage settings"
ON public.account_settings
FOR ALL
TO authenticated
USING (
  public.is_super_admin()
  OR (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Company Admin', 'Primary Admin')
  )
)
WITH CHECK (
  public.is_super_admin()
  OR (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Company Admin', 'Primary Admin')
  )
);