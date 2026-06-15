-- =====================================================================
-- Migration: Expand customer master to enterprise-grade
--
-- Adds identity, statutory, contact and financial-control fields to
-- customers, and promotes the bare customer_addresses table to a proper
-- billing/shipping store. Also backfills the missing WITH CHECK clauses
-- on the FOR ALL policies (cross-tenant poisoning gap from the audit).
--
-- NOTE: the existing `tin` and `withholds_tax` columns are kept as-is.
-- We do NOT introduce tax_id / withholding_applicable duplicates.
--   tin                -> TIN (already present)
--   withholds_tax      -> customer deducts WHT when paying us (already present)
--   is_tax_exempt      -> NEW, distinct concept (customer pays no output tax)
--   vat_number         -> NEW
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Expand the customers table
-- ---------------------------------------------------------------------
ALTER TABLE public.customers
  -- Identity / classification
  ADD COLUMN IF NOT EXISTS customer_code      TEXT,
  ADD COLUMN IF NOT EXISTS legal_name         TEXT,
  ADD COLUMN IF NOT EXISTS customer_type      TEXT NOT NULL DEFAULT 'business',  -- 'business' | 'individual'
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'inactive' | 'on_hold'

  -- Statutory (TIN already lives in customers.tin; withholding in withholds_tax)
  ADD COLUMN IF NOT EXISTS vat_number         TEXT,
  ADD COLUMN IF NOT EXISTS is_tax_exempt      BOOLEAN NOT NULL DEFAULT false,

  -- Contact
  ADD COLUMN IF NOT EXISTS contact_person     TEXT,
  ADD COLUMN IF NOT EXISTS mobile             TEXT,
  ADD COLUMN IF NOT EXISTS website            TEXT,

  -- Financial controls
  ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'LKR',
  ADD COLUMN IF NOT EXISTS credit_hold        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_tax_id     UUID REFERENCES public.taxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ar_account_id      UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,

  -- Misc
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS registration_date  DATE;

-- Constrain enumerated values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_customer_type_chk') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_customer_type_chk
      CHECK (customer_type IN ('business', 'individual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_status_chk') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_status_chk
      CHECK (status IN ('active', 'inactive', 'on_hold'));
  END IF;
END $$;

-- Customer code must be unique within a tenant (when provided)
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_code_uniq
  ON public.customers (tenant_id, customer_code)
  WHERE customer_code IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Promote customer_addresses to a real billing/shipping store
--    (existing columns: id, customer_id, address_line1, city, country, postal_code)
-- ---------------------------------------------------------------------
ALTER TABLE public.customer_addresses
  ADD COLUMN IF NOT EXISTS tenant_id      UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS address_type   TEXT NOT NULL DEFAULT 'billing',  -- 'billing' | 'shipping'
  ADD COLUMN IF NOT EXISTS address_line2  TEXT,
  ADD COLUMN IF NOT EXISTS state_province TEXT,
  ADD COLUMN IF NOT EXISTS is_primary     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_addresses_type_chk') THEN
    ALTER TABLE public.customer_addresses
      ADD CONSTRAINT customer_addresses_type_chk
      CHECK (address_type IN ('billing', 'shipping'));
  END IF;
END $$;

-- Backfill tenant_id on any existing address rows from their parent customer
UPDATE public.customer_addresses ca
SET tenant_id = c.tenant_id
FROM public.customers c
WHERE ca.customer_id = c.id
  AND ca.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON public.customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_tenant   ON public.customer_addresses(tenant_id);

-- ---------------------------------------------------------------------
-- 3. RLS — add WITH CHECK to prevent cross-tenant poisoning
--    (per project security audit: FOR ALL needs USING + WITH CHECK)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authorized users can manage customers" ON public.customers;
CREATE POLICY "Authorized users can manage customers"
  ON public.customers FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Authorized users can manage customer addresses" ON public.customer_addresses;
CREATE POLICY "Authorized users can manage customer addresses"
  ON public.customer_addresses FOR ALL
  USING (customer_id IN (SELECT id FROM public.customers WHERE tenant_id = public.get_user_tenant_id()))
  WITH CHECK (customer_id IN (SELECT id FROM public.customers WHERE tenant_id = public.get_user_tenant_id()));

-- Refresh the addresses SELECT policy to also key off tenant_id for index efficiency
DROP POLICY IF EXISTS "Users can view own tenant customer addresses" ON public.customer_addresses;
CREATE POLICY "Users can view own tenant customer addresses"
  ON public.customer_addresses FOR SELECT
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE tenant_id = public.get_user_tenant_id())
    OR public.is_super_admin()
  );
