-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 1: tenant tax profiles, tax codes,
-- effective-dated rates, rate resolution helper, RLS.
-- Additive + idempotent. Does NOT touch public.taxes / public.tax_records.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tenant tax profile (drives all engine behavior) ───────────────
CREATE TABLE IF NOT EXISTS public.tenant_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_vat_registered boolean NOT NULL DEFAULT false,
  vat_registration_number text,
  vat_registered_from date,
  vat_filing_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (vat_filing_frequency IN ('monthly','quarterly')),
  is_sscl_liable boolean NOT NULL DEFAULT false,
  sscl_registration_number text,
  is_svat_registered boolean NOT NULL DEFAULT false,  -- legacy SVAT; informational only
  wht_agent boolean NOT NULL DEFAULT true,            -- tenant must deduct AIT on payments
  tin text,
  default_sales_tax_group_id uuid,                    -- FK added in tax_groups migration
  default_purchase_tax_code_id uuid,                  -- FK added below after tax_codes
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Tax codes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,                  -- 'VAT18','VAT0','VAT-EX','VAT-RC','SSCL','WHT-SVC',...
  name text NOT NULL,
  tax_type text NOT NULL CHECK (tax_type IN ('VAT','SSCL','WHT','APIT','STAMP','OTHER')),
  collection_mode text NOT NULL CHECK (collection_mode IN
    ('output','input','withholding_payable','withholding_receivable','reverse_charge')),
  is_compound boolean NOT NULL DEFAULT false,
  is_recoverable boolean NOT NULL DEFAULT true,
  is_inclusive_default boolean NOT NULL DEFAULT false,
  rounding_method text NOT NULL DEFAULT 'half_up'
    CHECK (rounding_method IN ('half_up','half_even','down')),
  rounding_level text NOT NULL DEFAULT 'line'
    CHECK (rounding_level IN ('line','document')),
  output_liability_account_id uuid REFERENCES public.accounts(id),
  input_receivable_account_id uuid REFERENCES public.accounts(id),
  wht_payable_account_id uuid REFERENCES public.accounts(id),
  wht_receivable_account_id uuid REFERENCES public.accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE public.tenant_tax_profiles
  DROP CONSTRAINT IF EXISTS ttp_default_purchase_tax_code_fk;
ALTER TABLE public.tenant_tax_profiles
  ADD CONSTRAINT ttp_default_purchase_tax_code_fk
  FOREIGN KEY (default_purchase_tax_code_id) REFERENCES public.tax_codes(id);

-- ── 3. Effective-dated rates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_code_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_code_id uuid NOT NULL REFERENCES public.tax_codes(id) ON DELETE CASCADE,
  rate numeric(7,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_tax_code_rates_code
  ON public.tax_code_rates(tax_code_id, effective_from);

-- Prevent overlapping effective ranges per tax code
CREATE OR REPLACE FUNCTION public.check_tax_rate_overlap()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tax_code_rates r
    WHERE r.tax_code_id = NEW.tax_code_id
      AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND daterange(r.effective_from, COALESCE(r.effective_to, 'infinity'::date), '[]')
       && daterange(NEW.effective_from, COALESCE(NEW.effective_to, 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'Rate effective range overlaps an existing rate for this tax code. Close the previous rate first.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tax_rate_overlap ON public.tax_code_rates;
CREATE TRIGGER trg_tax_rate_overlap
  BEFORE INSERT OR UPDATE ON public.tax_code_rates
  FOR EACH ROW EXECUTE FUNCTION public.check_tax_rate_overlap();

-- Audit trail: rates that have come into force are insert-only.
-- Closing an open-ended row's effective_to (to add a successor) is allowed;
-- changing the rate value or effective_from of an in-force row is not.
CREATE OR REPLACE FUNCTION public.lock_historical_tax_rates()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.effective_from < CURRENT_DATE THEN
      RAISE EXCEPTION 'Cannot delete a tax rate already in force (from %). Add a new effective-dated rate instead.', OLD.effective_from;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.effective_from < CURRENT_DATE THEN
    IF NEW.rate IS DISTINCT FROM OLD.rate
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.tax_code_id IS DISTINCT FROM OLD.tax_code_id THEN
      RAISE EXCEPTION 'Tax rate in force since % is immutable. Add a new effective-dated rate instead.', OLD.effective_from;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_historical_tax_rates ON public.tax_code_rates;
CREATE TRIGGER trg_lock_historical_tax_rates
  BEFORE UPDATE OR DELETE ON public.tax_code_rates
  FOR EACH ROW EXECUTE FUNCTION public.lock_historical_tax_rates();

-- ── 4. Rate resolution: ALWAYS by document date, never "current" ─────
CREATE OR REPLACE FUNCTION public.get_tax_rate(p_tax_code_id uuid, p_as_of date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.rate FROM public.tax_code_rates r
  WHERE r.tax_code_id = p_tax_code_id
    AND r.effective_from <= p_as_of
    AND (r.effective_to IS NULL OR r.effective_to >= p_as_of)
  ORDER BY r.effective_from DESC
  LIMIT 1;
$$;

-- ── 5. updated_at maintenance ────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ttp_updated ON public.tenant_tax_profiles;
CREATE TRIGGER trg_ttp_updated BEFORE UPDATE ON public.tenant_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_tax_codes_updated ON public.tax_codes;
CREATE TRIGGER trg_tax_codes_updated BEFORE UPDATE ON public.tax_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 6. RLS (explicit WITH CHECK on every write policy — house rule) ──
ALTER TABLE public.tenant_tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_code_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ttp_select" ON public.tenant_tax_profiles;
CREATE POLICY "ttp_select" ON public.tenant_tax_profiles FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
-- Editing the tax profile requires a tenant admin role (RBAC house rule)
DROP POLICY IF EXISTS "ttp_admin_all" ON public.tenant_tax_profiles;
CREATE POLICY "ttp_admin_all" ON public.tenant_tax_profiles FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "tax_codes_select" ON public.tax_codes;
CREATE POLICY "tax_codes_select" ON public.tax_codes FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tax_codes_all" ON public.tax_codes;
CREATE POLICY "tax_codes_all" ON public.tax_codes FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tax_code_rates_select" ON public.tax_code_rates;
CREATE POLICY "tax_code_rates_select" ON public.tax_code_rates FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tax_code_rates_all" ON public.tax_code_rates;
CREATE POLICY "tax_code_rates_all" ON public.tax_code_rates FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
