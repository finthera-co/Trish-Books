
-- Add is_system flag to accounts (for OBE and other system accounts)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Add entry_type and is_system_generated to journal_entries
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS entry_type text DEFAULT 'manual';
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS is_system_generated boolean NOT NULL DEFAULT false;

-- Create system_settings table for tenant-level flags like obe_closed
CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  UNIQUE(tenant_id, setting_key)
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant system settings"
  ON public.system_settings FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Admins can manage system settings"
  ON public.system_settings FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id() AND (get_user_role_name() IN ('Company Admin', 'Primary Admin', 'Super Admin')))
  WITH CHECK (tenant_id = get_user_tenant_id() AND (get_user_role_name() IN ('Company Admin', 'Primary Admin', 'Super Admin')));
