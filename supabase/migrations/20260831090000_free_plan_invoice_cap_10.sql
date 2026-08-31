-- Free plan: lower the monthly invoice allowance from 25 to 10.
UPDATE public.subscription_plans
SET features_json = features_json || '{"invoice_cap":10}'::jsonb
WHERE name = 'Free';
