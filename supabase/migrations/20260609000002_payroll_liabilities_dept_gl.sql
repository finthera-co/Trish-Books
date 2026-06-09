-- Payroll Liability Tracking + Department Cost Centre GL Overrides

-- ──────────────────────────────────────────────────────────
-- Part 2a: payroll_remittances — track EPF/ETF remittances
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  remittance_type text NOT NULL,   -- 'EPF_EMPLOYEE','EPF_EMPLOYER','ETF_EMPLOYER','OTHER'
  period text NOT NULL,            -- YYYY-MM of the payroll period this covers
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  liability_account_id uuid NOT NULL REFERENCES public.accounts(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  reference text,
  notes text,
  payroll_run_id uuid REFERENCES public.payroll_runs(id),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_remittances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_payroll_remittances" ON public.payroll_remittances
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- ──────────────────────────────────────────────────────────
-- Part 3a: payroll_department_gl — cost centre overrides
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_department_gl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department text NOT NULL,
  component_code text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  posting_side text NOT NULL DEFAULT 'debit',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, department, component_code)
);
ALTER TABLE public.payroll_department_gl ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_payroll_dept_gl" ON public.payroll_department_gl
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());
