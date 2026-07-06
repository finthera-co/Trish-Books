-- =====================================================================
-- Migration: Auto-generate customer_code
--
-- Assigns per-tenant sequential codes (CUST-0001, CUST-0002, …) on
-- insert when no code is provided, using the concurrency-safe
-- tenant_number_counters infrastructure (same pattern as
-- employee_number). Backfills existing customers with no code.
-- Uniqueness is already enforced by customers_tenant_code_uniq.
-- =====================================================================

-- 1. Seed each tenant's counter past any manually entered CUST-#### codes
--    so generated codes never collide with existing ones.
INSERT INTO public.tenant_number_counters (tenant_id, counter_key, current_value)
SELECT tenant_id, 'customer', MAX((regexp_match(customer_code, '^CUST-(\d+)$'))[1]::bigint)
FROM public.customers
WHERE customer_code ~ '^CUST-\d+$'
GROUP BY tenant_id
ON CONFLICT (tenant_id, counter_key)
DO UPDATE SET current_value = GREATEST(tenant_number_counters.current_value, EXCLUDED.current_value);

-- 2. Auto-assign customer_code on insert
CREATE OR REPLACE FUNCTION public.set_customer_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_code IS NULL OR NEW.customer_code = '' THEN
    NEW.customer_code := 'CUST-' ||
      LPAD(public.next_tenant_number(NEW.tenant_id, 'customer')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_customer_code ON public.customers;
CREATE TRIGGER trg_set_customer_code
  BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_code();

-- 3. Backfill customer_code for existing rows
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, tenant_id FROM public.customers
    WHERE customer_code IS NULL OR customer_code = ''
    ORDER BY created_at
  LOOP
    UPDATE public.customers
      SET customer_code = 'CUST-' ||
        LPAD(public.next_tenant_number(r.tenant_id, 'customer')::text, 4, '0')
      WHERE id = r.id;
  END LOOP;
END $$;
