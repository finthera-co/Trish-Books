
-- 1. Fix audit_logs INSERT policy: enforce tenant_id matches caller's tenant
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit logs"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (tenant_id = get_user_tenant_id() OR tenant_id IS NULL)
    AND (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()) OR user_id IS NULL)
  );

-- 2. Fix roles table: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "Anyone can view roles" ON public.roles;
CREATE POLICY "Authenticated users can view roles"
  ON public.roles
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Fix permissions table: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "Anyone can view permissions" ON public.permissions;
CREATE POLICY "Authenticated users can view permissions"
  ON public.permissions
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. Fix role_permissions table: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "Anyone can view role_permissions" ON public.role_permissions;
CREATE POLICY "Authenticated users can view role_permissions"
  ON public.role_permissions
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. Fix receipts storage bucket: tenant-scoped folder enforcement
-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Users can view own receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload receipts" ON storage.objects;

-- Tenant-scoped SELECT: users can only read files in their tenant's folder
CREATE POLICY "Users can view own tenant receipts"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM public.tenants WHERE id = get_user_tenant_id())
  );

-- Tenant-scoped INSERT: users can only upload to their tenant's folder
CREATE POLICY "Users can upload own tenant receipts"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM public.tenants WHERE id = get_user_tenant_id())
  );

-- Tenant-scoped DELETE: users can delete files in their tenant's folder
CREATE POLICY "Users can delete own tenant receipts"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = (SELECT id::text FROM public.tenants WHERE id = get_user_tenant_id())
  );
