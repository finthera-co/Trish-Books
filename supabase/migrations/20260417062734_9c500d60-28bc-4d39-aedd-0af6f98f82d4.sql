-- 1. forecast_runs: versioning table
CREATE TABLE IF NOT EXISTS public.forecast_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  model_version TEXT NOT NULL DEFAULT 'trend_seasonal_v1',
  notes TEXT,
  forecast_job_id UUID REFERENCES public.forecast_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.forecast_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant forecast_runs"
ON public.forecast_runs FOR SELECT
USING ((tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE INDEX idx_forecast_runs_tenant ON public.forecast_runs(tenant_id, run_timestamp DESC);

-- 2. forecast_validations
CREATE TABLE IF NOT EXISTS public.forecast_validations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  forecast_run_id UUID NOT NULL REFERENCES public.forecast_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'warning')),
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.forecast_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant forecast_validations"
ON public.forecast_validations FOR SELECT
USING ((tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE INDEX idx_forecast_validations_run ON public.forecast_validations(forecast_run_id);

-- 3. forecast_accuracy (backtesting results)
CREATE TABLE IF NOT EXISTS public.forecast_accuracy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  forecast_run_id UUID NOT NULL REFERENCES public.forecast_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  stream TEXT NOT NULL,
  mape NUMERIC NOT NULL DEFAULT 0,
  rmse NUMERIC NOT NULL DEFAULT 0,
  evaluated_period TEXT NOT NULL,
  data_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.forecast_accuracy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant forecast_accuracy"
ON public.forecast_accuracy FOR SELECT
USING ((tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE INDEX idx_forecast_accuracy_run ON public.forecast_accuracy(forecast_run_id);

-- 4. Extend financial_forecasts with quality/explainability columns
ALTER TABLE public.financial_forecasts
  ADD COLUMN IF NOT EXISTS forecast_run_id UUID REFERENCES public.forecast_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residual_std_dev NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_points_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_quality_score NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_financial_forecasts_run ON public.financial_forecasts(forecast_run_id);

-- 5. Extend scenario_models with determinism + investment metrics
ALTER TABLE public.scenario_models
  ADD COLUMN IF NOT EXISTS input_parameters JSONB,
  ADD COLUMN IF NOT EXISTS base_forecast_run_id UUID REFERENCES public.forecast_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS npv NUMERIC,
  ADD COLUMN IF NOT EXISTS irr NUMERIC,
  ADD COLUMN IF NOT EXISTS time_horizon_years INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS discount_rate NUMERIC NOT NULL DEFAULT 0.10;