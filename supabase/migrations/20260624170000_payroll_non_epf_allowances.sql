-- Gap 5 — allowances that must NOT attract EPF/ETF.
-- EPF_BASE = BASIC + ALLOWANCES lumped every allowance into the EPF base, so
-- reimbursements / non-pensionable allowances were over-charged EPF. Add a
-- separate NON_EPF_ALLOWANCES bucket: taxable and part of gross (so PAYE still
-- applies), but excluded from EPF_BASE. Defaults to 0 — no change unless used.

ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS non_epf_allowances numeric NOT NULL DEFAULT 0;

-- Component for existing tenants.
INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description)
SELECT t.id, 'NON_EPF_ALLOWANCES', 'Non-EPF Allowances', 'earning', true, false,
       'Taxable allowances that do NOT attract EPF/ETF (reimbursements, non-pensionable allowances)'
FROM public.tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Gross now includes the non-EPF allowances (EPF_BASE deliberately does not).
UPDATE public.payroll_rules
  SET expression = 'BASIC + OVERTIME + BONUS + ALLOWANCES + NON_EPF_ALLOWANCES', updated_at = now()
  WHERE target_component_code = 'GROSS_PAY'
    AND expression = 'BASIC + OVERTIME + BONUS + ALLOWANCES';

-- New-tenant seed: same component + gross definition.
CREATE OR REPLACE FUNCTION public.seed_default_payroll_engine(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description) VALUES
    (p_tenant_id, 'BASIC',          'Basic Salary',           'base',                   true,  false, 'Employee base salary'),
    (p_tenant_id, 'OVERTIME',       'Overtime Pay',           'earning',                true,  false, 'Overtime earnings'),
    (p_tenant_id, 'BONUS',          'Bonus',                  'earning',                true,  false, 'Discretionary bonus'),
    (p_tenant_id, 'ALLOWANCES',     'Allowances',             'earning',                true,  false, 'Allowances that attract EPF/ETF'),
    (p_tenant_id, 'NON_EPF_ALLOWANCES','Non-EPF Allowances',  'earning',                true,  false, 'Taxable allowances that do NOT attract EPF/ETF'),
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
    (p_tenant_id, 'Gross Pay = Basic + OT + Bonus + Allowances', 'GROSS_PAY',     'EXPRESSION', 0, NULL, 'BASIC + OVERTIME + BONUS + ALLOWANCES + NON_EPF_ALLOWANCES', NULL, 10, 'Computes gross pay'),
    (p_tenant_id, 'EPF Base = Basic + Allowances',               'EPF_BASE',      'EXPRESSION', 0, NULL, 'BASIC + ALLOWANCES', NULL, 20, 'Earnings attracting EPF/ETF'),
    (p_tenant_id, 'EPF Employee 8% of EPF base',                 'EPF_EMPLOYEE',  'PERCENTAGE', 8, 'EPF_BASE', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 50, 'Sri Lanka statutory EPF employee'),
    (p_tenant_id, 'EPF Employer 12% of EPF base',                'EPF_EMPLOYER',  'PERCENTAGE', 12, 'EPF_BASE', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 60, 'Sri Lanka statutory EPF employer'),
    (p_tenant_id, 'ETF Employer 3% of EPF base',                 'ETF_EMPLOYER',  'PERCENTAGE', 3, 'EPF_BASE', NULL, jsonb_build_object('field','is_etf_applicable','operator','==','value',true), 70, 'Sri Lanka statutory ETF'),
    (p_tenant_id, 'Net Pay = Gross - EPF Employee - PAYE - Other', 'NET_PAY',     'EXPRESSION', 0, NULL, 'GROSS_PAY - EPF_EMPLOYEE - PAYE - OTHER_DEDUCTIONS', NULL, 999, 'Final take-home');
END;
$$;
