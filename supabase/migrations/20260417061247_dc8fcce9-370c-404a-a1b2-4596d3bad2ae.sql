-- =========================================================
-- 1. financial_forecasts: per-category forecast points
-- =========================================================
CREATE TABLE IF NOT EXISTS public.financial_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period date NOT NULL,
  granularity text NOT NULL DEFAULT 'daily', -- daily | weekly | monthly
  category_id uuid NULL REFERENCES public.account_categories(id) ON DELETE CASCADE,
  category_name text NOT NULL, -- denormalized for fast display; 'TOTAL_CASH' for aggregate
  stream text NOT NULL DEFAULT 'cash', -- revenue | expense | cash
  forecast_value numeric NOT NULL DEFAULT 0,
  lower_bound numeric NOT NULL DEFAULT 0,
  upper_bound numeric NOT NULL DEFAULT 0,
  model_type text NOT NULL DEFAULT 'trend_seasonal', -- linear | trend_seasonal | etc.
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ff_tenant_period ON public.financial_forecasts(tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_ff_tenant_stream ON public.financial_forecasts(tenant_id, stream, period);
CREATE INDEX IF NOT EXISTS idx_ff_category ON public.financial_forecasts(category_id, period);

ALTER TABLE public.financial_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant financial_forecasts"
  ON public.financial_forecasts FOR SELECT
  USING ((tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE POLICY "Authorized users can manage financial_forecasts"
  ON public.financial_forecasts FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- =========================================================
-- 2. forecast_jobs: scheduler transparency / audit
-- =========================================================
CREATE TABLE IF NOT EXISTS public.forecast_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_time timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'running', -- running | success | failed
  duration_ms integer NULL,
  tenants_processed integer NOT NULL DEFAULT 0,
  forecast_rows_inserted integer NOT NULL DEFAULT 0,
  error_message text NULL,
  logs jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecast_jobs_run_time ON public.forecast_jobs(run_time DESC);

ALTER TABLE public.forecast_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view forecast_jobs"
  ON public.forecast_jobs FOR SELECT
  TO authenticated
  USING (true);

-- (Insert/update only via service role from edge function — no policy needed)

-- =========================================================
-- 3. SQL aggregation function: category time series
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_category_time_series(
  p_tenant_id uuid,
  p_granularity text DEFAULT 'daily',
  p_lookback_days integer DEFAULT 365
)
RETURNS TABLE (
  period date,
  category_id uuid,
  category_name text,
  account_type text,
  stream text,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bucketed AS (
    SELECT
      CASE p_granularity
        WHEN 'monthly' THEN date_trunc('month', je.entry_date)::date
        WHEN 'weekly'  THEN date_trunc('week',  je.entry_date)::date
        ELSE je.entry_date
      END AS period,
      a.category_id,
      COALESCE(ac.name, a.account_type) AS category_name,
      a.account_type,
      CASE
        WHEN a.account_type = 'Revenue' THEN 'revenue'
        WHEN a.account_type IN ('Expense','Cost of Goods Sold') THEN 'expense'
        ELSE 'other'
      END AS stream,
      CASE
        WHEN a.account_type = 'Revenue' THEN jl.credit - jl.debit
        WHEN a.account_type IN ('Expense','Cost of Goods Sold') THEN jl.debit - jl.credit
        ELSE 0
      END AS amount
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN accounts a       ON a.id = jl.account_id
    LEFT JOIN account_categories ac ON ac.id = a.category_id
    WHERE je.tenant_id = p_tenant_id
      AND je.status = 'posted'
      AND je.entry_date >= (CURRENT_DATE - (p_lookback_days || ' days')::interval)
      AND a.account_type IN ('Revenue','Expense','Cost of Goods Sold')
  )
  SELECT period, category_id, category_name, account_type, stream, SUM(amount)::numeric AS amount
  FROM bucketed
  GROUP BY period, category_id, category_name, account_type, stream
  ORDER BY period, category_name;
$$;

-- =========================================================
-- 4. Replace cashflow_forecast TABLE with VIEW over financial_forecasts
-- =========================================================
-- Drop dependent objects first
DROP TABLE IF EXISTS public.cashflow_forecast CASCADE;

CREATE VIEW public.cashflow_forecast AS
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

-- Grant view access (RLS on underlying table enforces tenant isolation)
GRANT SELECT ON public.cashflow_forecast TO authenticated, anon;