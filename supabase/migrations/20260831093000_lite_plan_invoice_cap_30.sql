-- Lite plan: cap the monthly invoice allowance at 30 (was uncapped).
UPDATE public.subscription_plans
SET features_json = features_json || '{"invoice_cap":30}'::jsonb
WHERE name = 'Lite';
