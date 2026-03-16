
-- Add new QuickBooks-style roles
INSERT INTO roles (role_name, description) VALUES
  ('Primary Admin', 'Company owner with full access including billing')
ON CONFLICT DO NOTHING;

INSERT INTO roles (role_name, description) VALUES
  ('Standard User', 'Configurable module-level permissions')
ON CONFLICT DO NOTHING;

INSERT INTO roles (role_name, description) VALUES
  ('Reports Only', 'View-only access to financial reports and transactions')
ON CONFLICT DO NOTHING;

INSERT INTO roles (role_name, description) VALUES
  ('Time Tracking', 'Can only log timesheets and view own hours')
ON CONFLICT DO NOTHING;

-- Add is_primary flag to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Create user_permissions table for module-level access control
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  module_name text NOT NULL,
  permission_level text NOT NULL DEFAULT 'no_access',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, module_name)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view permissions for users in same tenant
CREATE POLICY "Users can view own tenant user permissions"
ON public.user_permissions FOR SELECT TO authenticated
USING (
  user_id IN (
    SELECT id FROM public.users WHERE tenant_id = public.get_user_tenant_id()
  )
  OR public.is_super_admin()
);

-- RLS: Admins can manage user permissions
CREATE POLICY "Admins can manage user permissions"
ON public.user_permissions FOR ALL TO authenticated
USING (
  user_id IN (
    SELECT id FROM public.users WHERE tenant_id = public.get_user_tenant_id()
  )
  AND (
    public.get_user_role_name() IN ('Company Admin', 'Primary Admin', 'Super Admin')
  )
);

-- Security definer function to check module permission
CREATE OR REPLACE FUNCTION public.get_user_permission(p_user_id uuid, p_module text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT permission_level FROM public.user_permissions WHERE user_id = p_user_id AND module_name = p_module),
    'no_access'
  );
$$;

-- Security definer to check if user is primary admin of tenant
CREATE OR REPLACE FUNCTION public.is_primary_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.auth_user_id = auth.uid()
    AND (u.is_primary = true OR r.role_name = 'Primary Admin')
  );
$$;
