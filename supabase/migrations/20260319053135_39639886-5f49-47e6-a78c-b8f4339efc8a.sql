
CREATE TABLE public.insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant insights"
  ON public.insights FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage insights"
  ON public.insights FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_insights_tenant_created ON public.insights(tenant_id, created_at DESC);
CREATE INDEX idx_insights_type ON public.insights(tenant_id, type);
