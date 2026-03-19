
-- Fix: Recreate view with SECURITY INVOKER (default, uses querying user's permissions)
DROP VIEW IF EXISTS public.monthly_financials;

CREATE VIEW public.monthly_financials
WITH (security_invoker = true)
AS
SELECT
  tenant_id,
  DATE_TRUNC('month', date)::date as month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as net
FROM public.transactions
GROUP BY tenant_id, DATE_TRUNC('month', date);
