-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 9: Sri Lanka seed data (effective-dated).
-- ALL RATES ARE INDICATIVE DEFAULTS — verify against current IRD
-- gazettes before filing. The engine stays inert until the tenant
-- enables flags on its tax profile (seeded all-false).
-- Idempotent: safe to re-run; existing rows are never duplicated.
-- ════════════════════════════════════════════════════════════════════

-- Resolve-or-create a COA account without colliding on account_code
-- (known issue: tenants have divergent code maps — match by name first).
CREATE OR REPLACE FUNCTION public.ensure_tax_account(
  p_tenant_id uuid, p_code text, p_name text, p_type text, p_subtype text, p_normal text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_code text := p_code;
  v_n int := 0;
BEGIN
  SELECT id INTO v_id FROM public.accounts
  WHERE tenant_id = p_tenant_id AND account_name = p_name LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  WHILE EXISTS (SELECT 1 FROM public.accounts WHERE tenant_id = p_tenant_id AND account_code = v_code) LOOP
    v_n := v_n + 1;
    v_code := p_code || '-' || v_n;
  END LOOP;

  INSERT INTO public.accounts (tenant_id, account_name, account_code, account_type, account_subtype, normal_balance, is_active)
  VALUES (p_tenant_id, p_name, v_code, p_type, p_subtype, p_normal, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.seed_tax_engine_for_tenant(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vat_out uuid; v_vat_in uuid; v_sscl_pay uuid;
  v_wht_pay uuid; v_wht_rec uuid; v_apit_pay uuid;
  v_code_id uuid; v_group_id uuid;
  v_vat18 uuid; v_sscl uuid; v_wht_svc uuid; v_wht_rent uuid;
  v_wht_int uuid; v_wht_div uuid; v_wht_nr uuid;
BEGIN
  -- ── COA additions (auto-mapped) ─────────────────────────────────────
  v_vat_out  := public.ensure_tax_account(p_tenant_id, '2310', 'VAT Output Payable',   'Liability', 'Tax Payable',    'credit');
  v_vat_in   := public.ensure_tax_account(p_tenant_id, '1310', 'VAT Input Receivable', 'Asset',     'Tax Receivable', 'debit');
  v_sscl_pay := public.ensure_tax_account(p_tenant_id, '2320', 'SSCL Payable',         'Liability', 'Tax Payable',    'credit');
  v_wht_pay  := public.ensure_tax_account(p_tenant_id, '2330', 'WHT Payable',          'Liability', 'Tax Payable',    'credit');
  v_wht_rec  := public.ensure_tax_account(p_tenant_id, '1320', 'WHT Receivable',       'Asset',     'Tax Receivable', 'debit');
  v_apit_pay := public.ensure_tax_account(p_tenant_id, '2340', 'APIT Payable',         'Liability', 'Tax Payable',    'credit');

  -- ── Tax codes + effective-dated rates ───────────────────────────────
  -- VAT18 output (15% 2022-09-01 → 2023-12-31, 18% from 2024-01-01)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, output_liability_account_id)
  VALUES (p_tenant_id, 'VAT18', 'VAT Standard Rate (output)', 'VAT', 'output', true, v_vat_out)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_vat18 FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='VAT18';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_vat18) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from, effective_to) VALUES
      (p_tenant_id, v_vat18, 15, DATE '2022-09-01', DATE '2023-12-31'),
      (p_tenant_id, v_vat18, 18, DATE '2024-01-01', NULL);
  END IF;

  -- VAT0 zero-rated (exports)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, output_liability_account_id)
  VALUES (p_tenant_id, 'VAT0', 'VAT Zero-Rated', 'VAT', 'output', true, v_vat_out)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_code_id FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='VAT0';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from) VALUES
      (p_tenant_id, v_code_id, 0, DATE '2022-09-01');
  END IF;

  -- VAT-EX exempt (0%, value reported separately on the return)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, output_liability_account_id)
  VALUES (p_tenant_id, 'VAT-EX', 'VAT Exempt', 'VAT', 'output', false, v_vat_out)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_code_id FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='VAT-EX';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from) VALUES
      (p_tenant_id, v_code_id, 0, DATE '2022-09-01');
  END IF;

  -- VAT-RC reverse charge on imported services (self-assessed)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable,
    output_liability_account_id, input_receivable_account_id)
  VALUES (p_tenant_id, 'VAT-RC', 'VAT Reverse Charge (imported services)', 'VAT', 'reverse_charge', true, v_vat_out, v_vat_in)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_code_id FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='VAT-RC';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from, effective_to) VALUES
      (p_tenant_id, v_code_id, 15, DATE '2022-09-01', DATE '2023-12-31'),
      (p_tenant_id, v_code_id, 18, DATE '2024-01-01', NULL);
  END IF;

  -- VAT18-IN input VAT on purchases (recoverable when VAT-registered)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, input_receivable_account_id)
  VALUES (p_tenant_id, 'VAT18-IN', 'VAT Standard Rate (input)', 'VAT', 'input', true, v_vat_in)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_code_id FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='VAT18-IN';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from, effective_to) VALUES
      (p_tenant_id, v_code_id, 15, DATE '2022-09-01', DATE '2023-12-31'),
      (p_tenant_id, v_code_id, 18, DATE '2024-01-01', NULL);
  END IF;

  -- SSCL 2.5% from 2022-10-01 — output side, non-recoverable
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, output_liability_account_id)
  VALUES (p_tenant_id, 'SSCL', 'Social Security Contribution Levy', 'SSCL', 'output', false, v_sscl_pay)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_sscl FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='SSCL';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_sscl) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from) VALUES
      (p_tenant_id, v_sscl, 2.5, DATE '2022-10-01');
  END IF;

  -- WHT (AIT) codes — payable side
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, wht_payable_account_id)
  VALUES
    (p_tenant_id, 'WHT-SVC',  'WHT on Service Fees',          'WHT', 'withholding_payable', false, v_wht_pay),
    (p_tenant_id, 'WHT-RENT', 'WHT on Rent',                  'WHT', 'withholding_payable', false, v_wht_pay),
    (p_tenant_id, 'WHT-INT',  'WHT on Interest',              'WHT', 'withholding_payable', false, v_wht_pay),
    (p_tenant_id, 'WHT-DIV',  'WHT on Dividends',             'WHT', 'withholding_payable', false, v_wht_pay),
    (p_tenant_id, 'WHT-NR',   'WHT on Non-Resident Services', 'WHT', 'withholding_payable', false, v_wht_pay)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_wht_svc  FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='WHT-SVC';
  SELECT id INTO v_wht_rent FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='WHT-RENT';
  SELECT id INTO v_wht_int  FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='WHT-INT';
  SELECT id INTO v_wht_div  FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='WHT-DIV';
  SELECT id INTO v_wht_nr   FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='WHT-NR';
  -- WHT code rates (informational — the actual rate comes from wht_rules)
  FOR v_code_id IN SELECT unnest(ARRAY[v_wht_svc, v_wht_rent, v_wht_int, v_wht_div, v_wht_nr]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
      INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from)
      VALUES (p_tenant_id, v_code_id,
        CASE v_code_id WHEN v_wht_rent THEN 10 WHEN v_wht_int THEN 10
                       WHEN v_wht_div THEN 15 WHEN v_wht_nr THEN 14 ELSE 5 END,
        DATE '2025-01-01');
    END IF;
  END LOOP;

  -- WHT receivable (customers withholding from us)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, wht_receivable_account_id)
  VALUES (p_tenant_id, 'WHT-CUST', 'WHT Withheld by Customers', 'WHT', 'withholding_receivable', false, v_wht_rec)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_code_id FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='WHT-CUST';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from)
    VALUES (p_tenant_id, v_code_id, 5, DATE '2025-01-01');
  END IF;

  -- APIT (PAYE) — bracket-driven (rate row 0%, brackets in apit_schedules)
  INSERT INTO public.tax_codes (tenant_id, code, name, tax_type, collection_mode, is_recoverable, wht_payable_account_id)
  VALUES (p_tenant_id, 'APIT', 'APIT (PAYE) on Employment Income', 'APIT', 'withholding_payable', false, v_apit_pay)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_code_id FROM public.tax_codes WHERE tenant_id=p_tenant_id AND code='APIT';
  IF NOT EXISTS (SELECT 1 FROM public.tax_code_rates WHERE tax_code_id=v_code_id) THEN
    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from)
    VALUES (p_tenant_id, v_code_id, 0, DATE '2025-01-01');
  END IF;

  -- ── Group: VAT+SSCL (SSCL order 1, VAT order 2 compounding on SSCL) ──
  INSERT INTO public.tax_groups (tenant_id, code, name)
  VALUES (p_tenant_id, 'VAT+SSCL', 'VAT 18% + SSCL 2.5% (compound)')
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO v_group_id FROM public.tax_groups WHERE tenant_id=p_tenant_id AND code='VAT+SSCL';
  INSERT INTO public.tax_group_members (tenant_id, tax_group_id, tax_code_id, apply_order, compound_on_previous) VALUES
    (p_tenant_id, v_group_id, v_sscl, 1, false),
    (p_tenant_id, v_group_id, v_vat18, 2, true)
  ON CONFLICT (tax_group_id, tax_code_id) DO NOTHING;

  -- ── WHT rules (INDICATIVE — verify against IRD gazettes) ─────────────
  IF NOT EXISTS (SELECT 1 FROM public.wht_rules WHERE tenant_id=p_tenant_id) THEN
    INSERT INTO public.wht_rules (tenant_id, tax_code_id, payment_nature, payee_type, rate,
      threshold_amount, threshold_period, effective_from, certificate_required) VALUES
      -- Service fees > Rs 100,000/month to resident individuals: 5%
      (p_tenant_id, v_wht_svc,  'service_fee', 'resident_individual', 5,  100000, 'per_month', DATE '2025-01-01', true),
      (p_tenant_id, v_wht_svc,  'contractor',  'resident_individual', 5,  100000, 'per_month', DATE '2025-01-01', true),
      -- Rent to residents: 10%
      (p_tenant_id, v_wht_rent, 'rent', 'resident_individual', 10, NULL, NULL, DATE '2025-01-01', true),
      (p_tenant_id, v_wht_rent, 'rent', 'resident_company',    10, NULL, NULL, DATE '2025-01-01', true),
      -- Interest: 10%
      (p_tenant_id, v_wht_int,  'interest', 'resident_individual', 10, NULL, NULL, DATE '2025-01-01', true),
      (p_tenant_id, v_wht_int,  'interest', 'resident_company',    10, NULL, NULL, DATE '2025-01-01', true),
      -- Dividends: 15%
      (p_tenant_id, v_wht_div,  'dividend', 'resident_individual', 15, NULL, NULL, DATE '2025-01-01', true),
      (p_tenant_id, v_wht_div,  'dividend', 'resident_company',    15, NULL, NULL, DATE '2025-01-01', true),
      -- Non-resident services: 14%
      (p_tenant_id, v_wht_nr,   'service_fee', 'non_resident', 14, NULL, NULL, DATE '2025-01-01', true),
      (p_tenant_id, v_wht_nr,   'royalty',     'non_resident', 14, NULL, NULL, DATE '2025-01-01', true);
  END IF;

  -- ── Default tax profile: all false — engine inert until configured ──
  INSERT INTO public.tenant_tax_profiles (tenant_id, is_vat_registered, is_sscl_liable, wht_agent)
  VALUES (p_tenant_id, false, false, true)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- ── Payroll: PAYE component + GL mapping (Cr APIT Payable) ───────────
  INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description)
  VALUES (p_tenant_id, 'PAYE', 'APIT (PAYE)', 'deduction', false, true, 'Advance Personal Income Tax withheld from employees')
  ON CONFLICT (tenant_id, code) DO NOTHING;
  INSERT INTO public.payroll_component_accounts (tenant_id, component_code, posting_side, account_id, is_active)
  SELECT p_tenant_id, 'PAYE', 'credit', v_apit_pay, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.payroll_component_accounts
    WHERE tenant_id = p_tenant_id AND component_code = 'PAYE'
  );
END $$;

-- ── Seed on tenant creation ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_seed_tax_engine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_tax_engine_for_tenant(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenant_seed_tax_engine ON public.tenants;
CREATE TRIGGER trg_tenant_seed_tax_engine
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenant_seed_tax_engine();

-- ── One-off for existing tenants ──────────────────────────────────────
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_tax_engine_for_tenant(v_t);
  END LOOP;
END $$;
