-- Tenant admins could not save Company Information (name, country, BR number, logo)
-- from Settings: the only UPDATE path on public.tenants was the super-admin "ALL"
-- policy, so an admin's update matched 0 rows under RLS and silently no-op'd —
-- PostgREST returns success, the UI toasts "saved", but nothing persists, and the
-- invoice PDF reads back null registration_number / logo_url.
--
-- Allow a tenant's own admins to update their tenant row, mirroring the
-- get_user_role_name() IN (...) gating used across the rest of the schema.
drop policy if exists "Tenant admins can update own tenant" on public.tenants;
create policy "Tenant admins can update own tenant"
  on public.tenants
  for update
  using (
    id = public.get_user_tenant_id()
    and public.get_user_role_name() in ('Primary Admin', 'Company Admin', 'Super Admin')
  )
  with check (
    id = public.get_user_tenant_id()
    and public.get_user_role_name() in ('Primary Admin', 'Company Admin', 'Super Admin')
  );
