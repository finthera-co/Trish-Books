-- ============ 1. Add eligibility flags to employees ============
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS is_epf_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_etf_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_paye_applicable boolean NOT NULL DEFAULT false;

-- Smart defaults trigger based on employment_type
CREATE OR REPLACE FUNCTION public.set_employee_statutory_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.employment_type IN ('contract','casual','intern','consultant') THEN
      NEW.is_epf_applicable := COALESCE(NEW.is_epf_applicable, false);
      NEW.is_etf_applicable := COALESCE(NEW.is_etf_applicable, false);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_statutory_defaults ON public.employees;
CREATE TRIGGER trg_employee_statutory_defaults
BEFORE INSERT ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.set_employee_statutory_defaults();

-- ============ 2. Payroll Components ============
CREATE TABLE IF NOT EXISTS public.payroll_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earning','deduction','employer_contribution','derived','base')),
  is_taxable boolean NOT NULL DEFAULT false,
  is_statutory boolean NOT NULL DEFAULT false,
  gl_debit_account_id uuid REFERENCES public.accounts(id),
  gl_credit_account_id uuid REFERENCES public.accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_payroll_components_tenant ON public.payroll_components(tenant_id);

ALTER TABLE public.payroll_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read components"
  ON public.payroll_components FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Admins write components"
  ON public.payroll_components FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin','Super Admin')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin','Super Admin')
  );

CREATE TRIGGER trg_payroll_components_updated_at
BEFORE UPDATE ON public.payroll_components
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 3. Payroll Rules ============
CREATE TABLE IF NOT EXISTS public.payroll_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_component_code text NOT NULL,
  formula_type text NOT NULL CHECK (formula_type IN ('PERCENTAGE','FIXED','DERIVED','EXPRESSION','CONDITIONAL')),
  formula_value numeric NOT NULL DEFAULT 0,
  base_component_code text,
  expression text,
  condition_json jsonb,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_rules_tenant ON public.payroll_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_rules_target ON public.payroll_rules(tenant_id, target_component_code);

ALTER TABLE public.payroll_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read rules"
  ON public.payroll_rules FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Admins write rules"
  ON public.payroll_rules FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin','Super Admin')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin','Super Admin')
  );

CREATE TRIGGER trg_payroll_rules_updated_at
BEFORE UPDATE ON public.payroll_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 4. Seed defaults for every tenant ============
CREATE OR REPLACE FUNCTION public.seed_default_payroll_engine(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Components
  INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description) VALUES
    (p_tenant_id, 'BASIC',          'Basic Salary',           'base',                   true,  false, 'Employee base salary'),
    (p_tenant_id, 'OVERTIME',       'Overtime Pay',           'earning',                true,  false, 'Overtime earnings'),
    (p_tenant_id, 'BONUS',          'Bonus',                  'earning',                true,  false, 'Discretionary bonus'),
    (p_tenant_id, 'ALLOWANCES',     'Allowances',             'earning',                true,  false, 'Other allowances'),
    (p_tenant_id, 'GROSS_PAY',      'Gross Pay',              'derived',                false, false, 'Sum of earnings'),
    (p_tenant_id, 'EPF_EMPLOYEE',   'EPF Employee (8%)',      'deduction',              false, true,  'Employee EPF contribution'),
    (p_tenant_id, 'EPF_EMPLOYER',   'EPF Employer (12%)',     'employer_contribution',  false, true,  'Employer EPF contribution'),
    (p_tenant_id, 'ETF_EMPLOYER',   'ETF Employer (3%)',      'employer_contribution',  false, true,  'Employer ETF contribution'),
    (p_tenant_id, 'OTHER_DEDUCTIONS','Other Deductions',      'deduction',              false, false, 'Other custom deductions'),
    (p_tenant_id, 'NET_PAY',        'Net Pay',                'derived',                false, false, 'Take-home pay')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Rules (ordered by priority)
  INSERT INTO public.payroll_rules (tenant_id, name, target_component_code, formula_type, formula_value, base_component_code, expression, condition_json, priority, description) VALUES
    (p_tenant_id, 'Gross Pay = Basic + OT + Bonus + Allowances', 'GROSS_PAY',     'EXPRESSION', 0, NULL, 'BASIC + OVERTIME + BONUS + ALLOWANCES', NULL, 10, 'Computes gross pay'),
    (p_tenant_id, 'EPF Employee 8% of Basic',                    'EPF_EMPLOYEE',  'PERCENTAGE', 8, 'BASIC', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 50, 'Sri Lanka statutory EPF employee'),
    (p_tenant_id, 'EPF Employer 12% of Basic',                   'EPF_EMPLOYER',  'PERCENTAGE', 12, 'BASIC', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 60, 'Sri Lanka statutory EPF employer'),
    (p_tenant_id, 'ETF Employer 3% of Basic',                    'ETF_EMPLOYER',  'PERCENTAGE', 3, 'BASIC', NULL, jsonb_build_object('field','is_etf_applicable','operator','==','value',true), 70, 'Sri Lanka statutory ETF'),
    (p_tenant_id, 'Net Pay = Gross - EPF Employee - Other Deductions', 'NET_PAY', 'EXPRESSION', 0, NULL, 'GROSS_PAY - EPF_EMPLOYEE - OTHER_DEDUCTIONS', NULL, 999, 'Final take-home');
END;
$$;

-- Seed for all existing tenants
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_default_payroll_engine(t.id);
  END LOOP;
END $$;

-- Auto-seed for new tenants
CREATE OR REPLACE FUNCTION public.tenant_seed_payroll_engine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_payroll_engine(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_seed_payroll_engine ON public.tenants;
CREATE TRIGGER trg_tenant_seed_payroll_engine
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenant_seed_payroll_engine();