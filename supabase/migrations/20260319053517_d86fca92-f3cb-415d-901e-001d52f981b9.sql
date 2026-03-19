
CREATE TABLE public.anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed')),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant anomalies"
  ON public.anomalies FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage anomalies"
  ON public.anomalies FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_anomalies_tenant ON public.anomalies(tenant_id, created_at DESC);
CREATE INDEX idx_anomalies_status ON public.anomalies(tenant_id, status);
