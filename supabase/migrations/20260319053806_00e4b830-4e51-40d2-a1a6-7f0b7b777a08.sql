
CREATE TABLE public.cashflow_forecast (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  predicted_balance numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, date)
);

ALTER TABLE public.cashflow_forecast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant forecasts"
  ON public.cashflow_forecast FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage forecasts"
  ON public.cashflow_forecast FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_cashflow_forecast_tenant_date ON public.cashflow_forecast(tenant_id, date);
