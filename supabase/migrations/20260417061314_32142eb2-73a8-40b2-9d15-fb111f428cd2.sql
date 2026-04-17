DROP VIEW IF EXISTS public.cashflow_forecast;

CREATE VIEW public.cashflow_forecast
WITH (security_invoker = true) AS
SELECT
  id,
  tenant_id,
  period AS date,
  forecast_value AS predicted_balance,
  lower_bound,
  upper_bound,
  created_at
FROM public.financial_forecasts
WHERE stream = 'cash'
  AND category_name = 'TOTAL_CASH'
  AND granularity = 'daily';

GRANT SELECT ON public.cashflow_forecast TO authenticated, anon;