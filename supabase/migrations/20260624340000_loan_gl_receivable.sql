-- #1 — put salary loans on the books as a receivable.
-- A new LOAN_DEDUCTION component carries the repayment so the payroll journal
-- credits a Loan Receivable (asset) instead of a generic deductions account, and a
-- loan-advance helper debits the receivable / credits bank when the loan is given.

-- Run-item column to persist the loan repayment applied (display + recalc).
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS loan_deduction numeric NOT NULL DEFAULT 0;

-- Component (deduction) for existing tenants.
INSERT INTO public.payroll_components (tenant_id, code, name, kind, is_taxable, is_statutory, description)
SELECT t.id, 'LOAN_DEDUCTION', 'Loan Repayment', 'deduction', false, false, 'Salary-advance / loan installment recovered this run'
FROM public.tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Net pay subtracts the loan repayment.
UPDATE public.payroll_rules
  SET expression = 'GROSS_PAY - EPF_EMPLOYEE - PAYE - OTHER_DEDUCTIONS - LOAN_DEDUCTION', updated_at = now()
  WHERE target_component_code = 'NET_PAY'
    AND expression = 'GROSS_PAY - EPF_EMPLOYEE - PAYE - OTHER_DEDUCTIONS';

-- Loan Receivable account + GL mapping (credit on repayment).
DO $$
DECLARE v_t uuid; v_acct uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    v_acct := public.ensure_tax_account(v_t, '1250', 'Staff Loans Receivable', 'Asset', 'Current Asset', 'debit');
    INSERT INTO public.payroll_component_accounts (tenant_id, component_code, posting_side, account_id, is_active)
    SELECT v_t, 'LOAN_DEDUCTION', 'credit', v_acct, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payroll_component_accounts
      WHERE tenant_id = v_t AND component_code = 'LOAN_DEDUCTION'
    );
  END LOOP;
END $$;

-- New-tenant seed: add LOAN_DEDUCTION component + the net-pay subtraction.
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
    (p_tenant_id, 'LOAN_DEDUCTION', 'Loan Repayment',         'deduction',              false, false, 'Salary-advance / loan installment'),
    (p_tenant_id, 'OTHER_DEDUCTIONS','Other Deductions',      'deduction',              false, false, 'Other custom deductions'),
    (p_tenant_id, 'NET_PAY',        'Net Pay',                'derived',                false, false, 'Take-home pay')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.payroll_rules (tenant_id, name, target_component_code, formula_type, formula_value, base_component_code, expression, condition_json, priority, description) VALUES
    (p_tenant_id, 'Gross Pay = Basic + OT + Bonus + Allowances', 'GROSS_PAY',     'EXPRESSION', 0, NULL, 'BASIC + OVERTIME + BONUS + ALLOWANCES + NON_EPF_ALLOWANCES', NULL, 10, 'Computes gross pay'),
    (p_tenant_id, 'EPF Base = Basic + Allowances',               'EPF_BASE',      'EXPRESSION', 0, NULL, 'BASIC + ALLOWANCES', NULL, 20, 'Earnings attracting EPF/ETF'),
    (p_tenant_id, 'EPF Employee 8% of EPF base',                 'EPF_EMPLOYEE',  'PERCENTAGE', 8, 'EPF_BASE', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 50, 'Sri Lanka statutory EPF employee'),
    (p_tenant_id, 'EPF Employer 12% of EPF base',                'EPF_EMPLOYER',  'PERCENTAGE', 12, 'EPF_BASE', NULL, jsonb_build_object('field','is_epf_applicable','operator','==','value',true), 60, 'Sri Lanka statutory EPF employer'),
    (p_tenant_id, 'ETF Employer 3% of EPF base',                 'ETF_EMPLOYER',  'PERCENTAGE', 3, 'EPF_BASE', NULL, jsonb_build_object('field','is_etf_applicable','operator','==','value',true), 70, 'Sri Lanka statutory ETF'),
    (p_tenant_id, 'Net Pay = Gross - EPF Employee - PAYE - Other - Loan', 'NET_PAY', 'EXPRESSION', 0, NULL, 'GROSS_PAY - EPF_EMPLOYEE - PAYE - OTHER_DEDUCTIONS - LOAN_DEDUCTION', NULL, 999, 'Final take-home');
END;
$$;

-- Post a loan advance to the GL: Dr Staff Loans Receivable / Cr Bank.
CREATE OR REPLACE FUNCTION public.rpc_post_loan_advance(p_loan_id uuid, p_bank_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_user uuid; v_loan RECORD; v_recv uuid; v_je uuid;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  SELECT * INTO v_loan FROM public.employee_loans WHERE id = p_loan_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found'; END IF;

  v_recv := public.ensure_tax_account(v_tenant, '1250', 'Staff Loans Receivable', 'Asset', 'Current Asset', 'debit');

  INSERT INTO public.journal_entries (tenant_id, description, entry_date, reference, created_by, status, is_system_generated)
  VALUES (v_tenant, 'Loan advance' || COALESCE(' - ' || v_loan.description, ''), v_loan.start_date, 'LOAN-' || left(p_loan_id::text, 8), v_user, 'posted', true)
  RETURNING id INTO v_je;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_recv, v_loan.principal, 0),
    (v_je, p_bank_account_id, 0, v_loan.principal);

  RETURN jsonb_build_object('ok', true, 'journal_entry_id', v_je);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_post_loan_advance(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_post_loan_advance(uuid, uuid) TO authenticated;
