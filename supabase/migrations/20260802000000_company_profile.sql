-- ============================================================
-- Company profile: tenant-scoped operational/presentation data for
-- invoices, distinct from the `tenants` control-plane table (written
-- by provision-tenant, managed by Super Admin).
--
-- ADDITIVE ONLY: tenants already carries company_name, country,
-- address, phone, tax_id (TIN), registration_number and logo_url
-- (see 20260620000000_tenant_invoice_branding.sql and
-- 20260623120000_vat_tax_invoice_fields.sql) — this table does NOT
-- duplicate those. It only adds what tenants has no room for: a
-- trading name distinct from the legal name, VAT/SVAT registration
-- numbers, the granular address remainder, contact email/website,
-- bank remittance details and invoice text defaults.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Identity: legal_name lives on tenants.company_name; this is the
  -- brand name shown in the logo lockup when it differs.
  trading_name         text,

  -- Tax registration: TIN already lives on tenants.tax_id.
  is_vat_registered    boolean NOT NULL DEFAULT false,
  vat_registration_no  text,
  svat_registration_no text,

  -- Address remainder: tenants.address holds the free-text line 1;
  -- these fill out the rest of a structured postal address.
  address_line2        text,
  city                 text,
  postal_code          text,

  -- Contact: tenants.phone already exists.
  email                text,
  website               text,

  -- Remittance
  bank_name             text,
  bank_branch           text,
  bank_account_name     text,
  bank_account_no       text,
  bank_swift            text,

  -- Document defaults
  invoice_terms         text,
  invoice_footer_note   text NOT NULL DEFAULT 'Thank you for your business',

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view company profile" ON public.company_profiles;
CREATE POLICY "Tenant members can view company profile"
ON public.company_profiles FOR SELECT TO authenticated
USING (public.is_super_admin() OR tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Tenant admins can manage company profile" ON public.company_profiles;
CREATE POLICY "Tenant admins can manage company profile"
ON public.company_profiles FOR ALL TO authenticated
USING (
  public.is_super_admin()
  OR (tenant_id = public.get_user_tenant_id()
      AND public.get_user_role_name() IN ('Company Admin', 'Primary Admin'))
)
WITH CHECK (
  public.is_super_admin()
  OR (tenant_id = public.get_user_tenant_id()
      AND public.get_user_role_name() IN ('Company Admin', 'Primary Admin'))
);

DROP TRIGGER IF EXISTS set_company_profiles_updated_at ON public.company_profiles;
CREATE TRIGGER set_company_profiles_updated_at
BEFORE UPDATE ON public.company_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill one (mostly empty) row per existing tenant.
INSERT INTO public.company_profiles (tenant_id)
SELECT t.id
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.company_profiles cp WHERE cp.tenant_id = t.id);

-- Auto-provision on new tenant creation — app-layer code (provision-tenant,
-- provision-google-user) and direct SQL both bypass a client-side insert,
-- so this must happen in the database.
CREATE OR REPLACE FUNCTION public.create_company_profile_for_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.company_profiles (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_company_profile ON public.tenants;
CREATE TRIGGER trg_create_company_profile
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.create_company_profile_for_tenant();
