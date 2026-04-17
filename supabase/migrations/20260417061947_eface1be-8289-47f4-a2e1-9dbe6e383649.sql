-- Scenario Models for "what-if" forecast simulations
CREATE TABLE public.scenario_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  horizon_months INTEGER NOT NULL DEFAULT 12,

  -- Assumption inputs
  revenue_uplift_pct NUMERIC NOT NULL DEFAULT 0,      -- e.g. +10 means +10% revenue
  expense_reduction_pct NUMERIC NOT NULL DEFAULT 0,   -- e.g. 5 means -5% expense
  capital_injection NUMERIC NOT NULL DEFAULT 0,       -- one-time cash injection
  one_time_investment NUMERIC NOT NULL DEFAULT 0,     -- one-time investment (cost)

  -- Computed outputs (cached on simulate)
  baseline_revenue NUMERIC NOT NULL DEFAULT 0,
  baseline_expense NUMERIC NOT NULL DEFAULT 0,
  baseline_cash NUMERIC NOT NULL DEFAULT 0,
  projected_revenue NUMERIC NOT NULL DEFAULT 0,
  projected_expense NUMERIC NOT NULL DEFAULT 0,
  projected_cash NUMERIC NOT NULL DEFAULT 0,
  projected_profit NUMERIC NOT NULL DEFAULT 0,
  roi_pct NUMERIC NOT NULL DEFAULT 0,
  payback_months NUMERIC,

  result_series JSONB,  -- monthly projected series for charting

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_models_tenant ON public.scenario_models(tenant_id);

ALTER TABLE public.scenario_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tenant scenarios"
ON public.scenario_models FOR SELECT
USING ((tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE POLICY "Users manage own tenant scenarios"
ON public.scenario_models FOR ALL
USING (tenant_id = get_user_tenant_id())
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE TRIGGER trg_scenario_models_updated_at
BEFORE UPDATE ON public.scenario_models
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();