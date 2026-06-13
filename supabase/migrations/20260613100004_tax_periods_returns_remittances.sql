-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 4: tax periods, returns, remittances,
-- period generation. (Created before tax_transactions, which FKs to
-- tax_periods.)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_type text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','filed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tax_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_tax_periods_lookup
  ON public.tax_periods(tenant_id, tax_type, period_start, period_end);

CREATE TABLE IF NOT EXISTS public.tax_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_period_id uuid NOT NULL REFERENCES public.tax_periods(id),
  return_type text NOT NULL,   -- 'VAT_RETURN','SSCL_RETURN','WHT_REMITTANCE','APIT_REMITTANCE'
  summary_json jsonb NOT NULL,
  total_payable numeric(18,2),
  total_credit numeric(18,2),
  filed_at timestamptz,
  filed_by uuid,
  ird_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','filed','amended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_returns_period ON public.tax_returns(tax_period_id);

CREATE TABLE IF NOT EXISTS public.tax_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_code_id uuid NOT NULL REFERENCES public.tax_codes(id),
  tax_period_id uuid REFERENCES public.tax_periods(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  remittance_date date NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  reference text,               -- IRD payment reference
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','voided')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_remit_tenant ON public.tax_remittances(tenant_id, tax_code_id);

DROP TRIGGER IF EXISTS trg_tax_remit_updated ON public.tax_remittances;
CREATE TRIGGER trg_tax_remit_updated BEFORE UPDATE ON public.tax_remittances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Period generation: monthly, or quarterly for VAT when the tenant
--    profile says so. Idempotent (ON CONFLICT DO NOTHING). ────────────
CREATE OR REPLACE FUNCTION public.generate_tax_periods(
  p_tenant_id uuid, p_tax_type text, p_year int
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_freq text := 'monthly';
  v_start date;
  v_count int := 0;
  v_step interval;
BEGIN
  IF p_tax_type = 'VAT' THEN
    SELECT COALESCE(vat_filing_frequency, 'monthly') INTO v_freq
    FROM public.tenant_tax_profiles WHERE tenant_id = p_tenant_id;
  END IF;

  v_step := CASE WHEN v_freq = 'quarterly' THEN interval '3 months' ELSE interval '1 month' END;
  v_start := make_date(p_year, 1, 1);

  WHILE extract(year FROM v_start)::int = p_year LOOP
    INSERT INTO public.tax_periods (tenant_id, tax_type, period_start, period_end)
    VALUES (p_tenant_id, p_tax_type, v_start, (v_start + v_step - interval '1 day')::date)
    ON CONFLICT (tenant_id, tax_type, period_start) DO NOTHING;
    v_count := v_count + 1;
    v_start := (v_start + v_step)::date;
  END LOOP;
  RETURN v_count;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.tax_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_remittances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tax_periods_select" ON public.tax_periods;
CREATE POLICY "tax_periods_select" ON public.tax_periods FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tax_periods_all" ON public.tax_periods;
CREATE POLICY "tax_periods_all" ON public.tax_periods FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tax_returns_select" ON public.tax_returns;
CREATE POLICY "tax_returns_select" ON public.tax_returns FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
-- Filing a return requires a tenant admin role (RBAC house rule)
DROP POLICY IF EXISTS "tax_returns_admin_all" ON public.tax_returns;
CREATE POLICY "tax_returns_admin_all" ON public.tax_returns FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "tax_remit_select" ON public.tax_remittances;
CREATE POLICY "tax_remit_select" ON public.tax_remittances FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tax_remit_insert" ON public.tax_remittances;
CREATE POLICY "tax_remit_insert" ON public.tax_remittances FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());
-- Voiding/updating a remittance requires a tenant admin role
DROP POLICY IF EXISTS "tax_remit_admin_update" ON public.tax_remittances;
CREATE POLICY "tax_remit_admin_update" ON public.tax_remittances FOR UPDATE
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  );
DROP POLICY IF EXISTS "tax_remit_admin_delete" ON public.tax_remittances;
CREATE POLICY "tax_remit_admin_delete" ON public.tax_remittances FOR DELETE
  USING (
    tenant_id = public.get_user_tenant_id() AND status = 'draft'
    AND (public.get_user_role_name() IN ('Primary Admin','Company Admin') OR public.is_super_admin())
  );
