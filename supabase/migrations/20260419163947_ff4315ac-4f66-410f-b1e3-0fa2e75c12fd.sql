CREATE POLICY "Admins can insert settings"
ON public.account_settings
FOR INSERT
TO authenticated
WITH CHECK (
  (tenant_id = get_user_tenant_id()) AND (is_primary_admin() OR is_super_admin())
);