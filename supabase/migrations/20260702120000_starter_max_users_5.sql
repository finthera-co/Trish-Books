-- Bump the Starter plan user limit from 3 to 5
UPDATE public.subscription_plans
SET max_users = 5
WHERE name = 'Starter';
