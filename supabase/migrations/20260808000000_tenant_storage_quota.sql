-- Tenant storage quota tracking.
--
-- Base plans each carry a storage allotment (Free 500MB up to Enterprise 1TB)
-- but nothing tracked actual usage. This adds a per-tenant usage row, kept up
-- to date by the storage-quota-reconcile edge function (scheduled separately),
-- plus the per-plan byte caps in subscription_plans.features_json alongside
-- the existing modules/companies/invoice_cap keys.

CREATE TABLE public.tenant_storage_usage (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  bucket_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_bytes bigint NOT NULL DEFAULT 0,
  last_reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_storage_usage ENABLE ROW LEVEL SECURITY;

-- Tenant members see their own usage; super admins see everyone's (mirrors the
-- get_user_tenant_id() / is_super_admin() pattern used across the app's RLS).
CREATE POLICY "Users can view own tenant storage usage" ON public.tenant_storage_usage
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- No INSERT/UPDATE/DELETE policy for `authenticated` — only the
-- storage-quota-reconcile edge function (service role, bypasses RLS) writes here.

UPDATE public.subscription_plans SET features_json = features_json ||
  jsonb_build_object('storage_bytes', CASE name
    WHEN 'Free' THEN 500::bigint*1024*1024
    WHEN 'Lite' THEN 2::bigint*1024*1024*1024
    WHEN 'Standard' THEN 10::bigint*1024*1024*1024
    WHEN 'Pro' THEN 50::bigint*1024*1024*1024
    WHEN 'Scale' THEN 200::bigint*1024*1024*1024
    WHEN 'Enterprise' THEN 1024::bigint*1024*1024*1024
  END)
WHERE name IN ('Free', 'Lite', 'Standard', 'Pro', 'Scale', 'Enterprise');
