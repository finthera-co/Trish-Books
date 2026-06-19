-- ============================================================
-- PAYROLL CORRECTNESS FIX: PAYE + EPF base + Net Pay
--  * PAYE/APIT now computed (engine) and stored
--  * EPF/ETF base corrected from BASIC -> EPF_BASE (= BASIC + ALLOWANCES)
--  * NET_PAY now subtracts PAYE
-- Idempotent; covers existing tenants (UPDATE/INSERT) and new ones (seed fn).
-- ============================================================

-- 1a. PAYE on the legacy cache + run roll-up -------------------
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS employee_paye numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS total_paye numeric NOT NULL DEFAULT 0;

-- 1c. PAYE bracket table (tenant-scoped, effective-dated) ------
CREATE TABLE IF NOT EXISTS public.paye_tax_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lower_bound numeric NOT NULL,           -- monthly taxable income, inclusive
  upper_bound numeric,                    -- NULL = open-ended top bracket
  rate numeric NOT NULL,                  -- e.g. 0.06 for 6%
  cumulative_deduction numeric NOT NULL DEFAULT 0, -- quick-formula subtraction constant
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paye_brackets_tenant ON public.paye_tax_brackets(tenant_id, effective_from);
ALTER TABLE public.paye_tax_brackets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins write paye brackets" ON public.paye_tax_brackets;
CREATE POLICY "Admins write paye brackets" ON public.paye_tax_brackets FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() = ANY (ARRAY['Primary Admin','Company Admin','Super Admin']))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() = ANY (ARRAY['Primary Admin','Company Admin','Super Admin']));
DROP POLICY IF EXISTS "Tenant members read paye brackets" ON public.paye_tax_brackets;
CREATE POLICY "Tenant members read paye brackets" ON public.paye_tax_brackets FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP TRIGGER IF EXISTS trg_paye_brackets_updated ON public.paye_tax_brackets;
CREATE TRIGGER trg_paye_brackets_updated BEFORE UPDATE ON public.paye_tax_brackets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PLACEHOLDER APIT brackets — verify against current IRD gazette before production use.
-- Structure: tax-free threshold then progressive bands; quick-formula = income*rate - cumulative_deduction.
INSERT INTO public.paye_tax_brackets (tenant_id, lower_bound, upper_bound, rate, cumulative_deduction)
SELECT t.id, b.lo, b.hi, b.rate, b.cum
FROM public.tenants t
CROSS JOIN (VALUES
  (0,        100000,  0.00, 0),
  (100000,   141667,  0.06, 6000),
  (141667,   183333,  0.12, 14500),
  (183333,   225000,  0.18, 25500),
  (225000,   266667,  0.24, 39000),
  (266667,   308333,  0.30, 55000),
  (308333,   NULL,    0.36, 73500)
) AS b(lo, hi, rate, cum)
WHERE NOT EXISTS (SELECT 1 FROM public.paye_tax_brackets x WHERE x.tenant_id = t.id);

-- 1d/1e. New-tenant seed function: PAYE + EPF_BASE components,
-- EPF_BASE rule, EPF/ETF on EPF_BASE, NET_PAY subtracts PAYE.
CREATE OR REPLACE FUNCTION public.seed_default_payroll_engine(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description) VALUES
    (p_tenant_id, 'BASIC',          'Basic Salary',           'base',                   true,  false, 'Employee base salary'),
    (p_tenant_id, 'OVERTIME',       'Overtime Pay',           'earning',                true,  false, 'Overtime earnings'),
    (p_tenant_id, 'BONUS',          'Bonus',                  'earning',                true,  false, 'Discretionary bonus'),
    (p_tenant_id, 'ALLOWANCES',     'Allowances',             'earning',                true,  false, 'Other allowances'),
    (p_tenant_id, 'GROSS_PAY',      'Gross Pay',              'derived',                false, false, 'Sum of earnings'),
    (p_tenant_id, 'EPF_BASE',       'EPF Base (Basic+Allow)', 'derived',                false, false, 'Earnings that attract EPF/ETF'),
    (p_tenant_id, 'EPF_EMPLOYEE',   'EPF Employee (8%)',      'deduction',              false, true,  'Employee EPF contribution'),
    (p_tenant_id, 'EPF_EMPLOYER',   'EPF Employer (12%)',     'employer_contribution',  false, true,  'Employer EPF contribution'),
    (p_tenant_id, 'ETF_EMPLOYER',   'ETF Employer (3%)',      'employer_contribution',  false, true,  'Employer ETF contribution'),
    (p_tenant_id, 'PAYE',           'PAYE / APIT Tax',        'deduction',              false, true,  'Employee income tax withheld at source'),
    (p_tenant_id, 'OTHER_DEDUCTIONS','Other Deductions',      'deduction',              false, false, 'Other custom deductions'),
    (p_tenant_id, 'NET_PAY',        'Net Pay',                'derived',                false, false, 'Take-home pay')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.payroll_rules (tenant_id, name, target_component_code, formula_type, formula_value, base_component_code, expression, condition_json, priority, description) VALUES
    (p_tenant_id, 'Gross Pay = Basic + OT + Bonus + Allowances', 'GROSS_PAY',     'EXPRESSION', 0, NULL, 'BASIC + OVERTIME + BONUS + ALLOWANCES', NULL, 10, 'Computes gross pay'),
    (p_tenant_id, 'EPF Base = Basic + Allowances',               'EPF_BASE',      'EXPRESSION', 0, NULL, 'BASIC + ALLOWANCES', NULL, 20, 'Earnings attracting EPF/ETF'),
    (p_tenant_id, 'EPF Employee 8% of EPF base',                 'EPF_EMPLOYEE',  'PERCENTAGE', 8, 'EPF_BASE', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 50, 'Sri Lanka statutory EPF employee'),
    (p_tenant_id, 'EPF Employer 12% of EPF base',                'EPF_EMPLOYER',  'PERCENTAGE', 12, 'EPF_BASE', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 60, 'Sri Lanka statutory EPF employer'),
    (p_tenant_id, 'ETF Employer 3% of EPF base',                 'ETF_EMPLOYER',  'PERCENTAGE', 3, 'EPF_BASE', NULL, jsonb_build_object('field','is_etf_applicable','operator','==','value',true), 70, 'Sri Lanka statutory ETF'),
    (p_tenant_id, 'Net Pay = Gross - EPF Employee - PAYE - Other', 'NET_PAY',     'EXPRESSION', 0, NULL, 'GROSS_PAY - EPF_EMPLOYEE - PAYE - OTHER_DEDUCTIONS', NULL, 999, 'Final take-home');
  -- PAYE itself is computed in the engine (bracket lookup) and injected into context before NET_PAY.
END;
$$;

-- Existing tenants: apply the deltas idempotently --------------
-- New components (PAYE, EPF_BASE)
INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description)
SELECT t.id, c.code, c.name, c.kind, false, c.stat, c.descr
FROM public.tenants t
CROSS JOIN (VALUES
  ('EPF_BASE', 'EPF Base (Basic+Allow)', 'derived',   false, 'Earnings that attract EPF/ETF'),
  ('PAYE',     'PAYE / APIT Tax',        'deduction', true,  'Employee income tax withheld at source')
) AS c(code, name, kind, stat, descr)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- EPF_BASE rule (priority 20) for tenants that don't have it yet
INSERT INTO public.payroll_rules (tenant_id, name, target_component_code, formula_type, formula_value, base_component_code, expression, condition_json, priority, description)
SELECT t.id, 'EPF Base = Basic + Allowances', 'EPF_BASE', 'EXPRESSION', 0, NULL, 'BASIC + ALLOWANCES', NULL, 20, 'Earnings attracting EPF/ETF'
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.payroll_rules r WHERE r.tenant_id = t.id AND r.target_component_code = 'EPF_BASE');

-- Re-point EPF/ETF rules from BASIC to EPF_BASE
UPDATE public.payroll_rules
  SET base_component_code = 'EPF_BASE', updated_at = now()
  WHERE target_component_code IN ('EPF_EMPLOYEE','EPF_EMPLOYER','ETF_EMPLOYER')
    AND base_component_code = 'BASIC';

-- Net pay now subtracts PAYE
UPDATE public.payroll_rules
  SET expression = 'GROSS_PAY - EPF_EMPLOYEE - PAYE - OTHER_DEDUCTIONS', updated_at = now()
  WHERE target_component_code = 'NET_PAY'
    AND expression = 'GROSS_PAY - EPF_EMPLOYEE - OTHER_DEDUCTIONS';
