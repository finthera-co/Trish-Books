-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 3: Withholding tax (AIT) rules, vendor /
-- customer tax attributes, WHT certificate numbering, payment columns.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wht_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_code_id uuid NOT NULL REFERENCES public.tax_codes(id),
  payment_nature text NOT NULL CHECK (payment_nature IN
    ('service_fee','rent','interest','dividend','royalty','contractor','other')),
  payee_type text NOT NULL CHECK (payee_type IN
    ('resident_individual','resident_company','non_resident')),
  rate numeric(7,4) NOT NULL,
  threshold_amount numeric(18,2),
  threshold_period text CHECK (threshold_period IN ('per_payment','per_month','per_annum')),
  effective_from date NOT NULL,
  effective_to date,
  certificate_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_wht_rules_tenant
  ON public.wht_rules(tenant_id, payment_nature, payee_type, effective_from);

-- ── Vendor / customer tax attributes ─────────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS payee_type text
    CHECK (payee_type IS NULL OR payee_type IN ('resident_individual','resident_company','non_resident')),
  ADD COLUMN IF NOT EXISTS default_payment_nature text
    CHECK (default_payment_nature IS NULL OR default_payment_nature IN
      ('service_fee','rent','interest','dividend','royalty','contractor','other')),
  ADD COLUMN IF NOT EXISTS wht_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wht_exemption_ref text,
  ADD COLUMN IF NOT EXISTS tin text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tin text,
  ADD COLUMN IF NOT EXISTS withholds_tax boolean NOT NULL DEFAULT false;

-- ── Bill payments: WHT at settlement ─────────────────────────────────
ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS wht_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_rule_id uuid REFERENCES public.wht_rules(id),
  ADD COLUMN IF NOT EXISTS wht_certificate_no text,
  ADD COLUMN IF NOT EXISTS wht_override_reason text,  -- manual WHT override audit
  ADD COLUMN IF NOT EXISTS payment_nature text;

-- ── Payments received: WHT withheld by the customer ──────────────────
ALTER TABLE public.payments_received
  ADD COLUMN IF NOT EXISTS wht_amount numeric(18,2) NOT NULL DEFAULT 0;

-- ── WHT certificate numbering: WHT-YYYY-NNNNN per tenant per year ────
CREATE OR REPLACE FUNCTION public.generate_wht_certificate_no(p_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'WHT-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
    LPAD((
      COALESCE((
        SELECT COUNT(*)::int + 1 FROM public.bill_payments
        WHERE tenant_id = p_tenant_id
          AND wht_certificate_no LIKE 'WHT-' || to_char(CURRENT_DATE, 'YYYY') || '-%'
      ), 1)
    )::text, 5, '0');
$$;

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.wht_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wht_rules_select" ON public.wht_rules;
CREATE POLICY "wht_rules_select" ON public.wht_rules FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "wht_rules_all" ON public.wht_rules;
CREATE POLICY "wht_rules_all" ON public.wht_rules FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
