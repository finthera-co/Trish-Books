
-- Allow unauthenticated users to create tenants during signup
CREATE POLICY "Anyone can create tenants during signup" ON public.tenants FOR INSERT WITH CHECK (true);

-- Allow unauthenticated users to create their first user record during signup
CREATE POLICY "Anyone can create users during signup" ON public.users FOR INSERT WITH CHECK (true);

-- Allow authenticated users to read their own user record
CREATE POLICY "Users can read their own record" ON public.users FOR SELECT USING (auth_user_id = auth.uid() OR tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
