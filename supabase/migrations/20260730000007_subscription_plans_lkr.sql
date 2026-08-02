-- Bring subscription_plans in line with the tiers actually advertised on the site.
--
-- The table held seed data — "Starter" 15.00 and "Business" 35.00 — while the
-- landing page and the in-app Subscriptions page both present rupee pricing
-- (src/pages/Subscriptions.tsx already renders `LKR {plan.price}`, so those rows
-- were being displayed as "LKR 15"). The landing tiers are the real prices.
--
-- Two tenants reference the existing rows via tenants.subscription_plan_id, so the
-- legacy rows are UPDATED in place rather than deleted — the ids and therefore the
-- foreign keys survive. Each is remapped to the tier whose seat limit is at or above
-- its current one, so no tenant loses capacity in the process:
--
--   Starter  (5 seats)  -> Pro    (6 seats)
--   Business (10 seats) -> Scale  (20 seats)
--
-- If you would rather those two tenants land on a cheaper tier, change the mapping
-- here before running; both are currently on plans that no longer exist as sold.

-- Remap the two referenced rows.
UPDATE public.subscription_plans
SET name = 'Pro', price = 9900, max_users = 6, billing_cycle = 'monthly',
    features_json = '{"modules":["accounts","journals","reports","invoicing","expenses","budgeting","audit","payroll"],"companies":2}'::jsonb
WHERE name = 'Starter';

UPDATE public.subscription_plans
SET name = 'Scale', price = 18900, max_users = 20, billing_cycle = 'monthly',
    features_json = '{"modules":["accounts","journals","reports","invoicing","expenses","budgeting","audit","payroll","inventory","procurement"],"companies":3}'::jsonb
WHERE name = 'Business';

-- Add the remaining advertised tiers.
INSERT INTO public.subscription_plans (name, price, max_users, billing_cycle, features_json)
SELECT v.name, v.price, v.max_users, 'monthly', v.features::jsonb
FROM (VALUES
  ('Free',       0::numeric,     1, '{"modules":["accounts","journals","reports"],"companies":1,"invoice_cap":25}'),
  ('Lite',       2900::numeric,  1, '{"modules":["accounts","journals","reports","invoicing","expenses"],"companies":1}'),
  ('Standard',   5900::numeric,  3, '{"modules":["accounts","journals","reports","invoicing","expenses","budgeting"],"companies":1}'),
  ('Enterprise', 34900::numeric, 999, '{"modules":["accounts","journals","reports","invoicing","expenses","budgeting","audit","payroll","inventory","procurement"],"companies":999}')
) AS v(name, price, max_users, features)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscription_plans p WHERE p.name = v.name
);
