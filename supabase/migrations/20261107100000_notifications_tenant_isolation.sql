-- Notifications: strict per-tenant isolation, including for Super Admin.
--
-- The blanket "Super admins can manage notifications" policy (FOR ALL USING
-- is_super_admin()) made every tenant's notifications visible in the Super
-- Admin's bell/notification page and realtime toasts, because the client reads
-- `notifications` without a tenant filter and relies on RLS alone.
--
-- Nothing in the platform needs cross-tenant notification access: server-side
-- producers (invoice due reminders, storage alerts, edge functions) run as
-- SECURITY DEFINER / service_role and bypass RLS. With this policy gone the
-- Super Admin is governed by the same tenant-scoped policies as every user:
--   SELECT/UPDATE: tenant_id = get_user_tenant_id() AND (user_id IS NULL OR own user)
--   INSERT:        tenant_id = get_user_tenant_id()

DROP POLICY IF EXISTS "Super admins can manage notifications" ON public.notifications;
