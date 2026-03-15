
-- Expand employees table with payroll-related fields
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'salaried',
  ADD COLUMN IF NOT EXISTS pay_rate_type text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS pay_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS epf_number text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS bank_account_no text,
  ADD COLUMN IF NOT EXISTS nic_number text,
  ADD COLUMN IF NOT EXISTS leave_balance numeric NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS vacation_balance numeric NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sick_balance numeric NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Pay schedules table
CREATE TABLE public.pay_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  anchor_date date,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pay_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage pay schedules"
  ON public.pay_schedules FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view own tenant pay schedules"
  ON public.pay_schedules FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Link employees to pay schedules
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pay_schedule_id uuid REFERENCES public.pay_schedules(id);

-- Earning/deduction types
CREATE TABLE public.payroll_earning_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'earning',
  is_taxable boolean NOT NULL DEFAULT true,
  is_statutory boolean NOT NULL DEFAULT false,
  rate numeric DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_earning_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage earning types"
  ON public.payroll_earning_types FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view own tenant earning types"
  ON public.payroll_earning_types FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Payroll runs (batch payroll)
CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_number text NOT NULL,
  pay_schedule_id uuid REFERENCES public.pay_schedules(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  payment_date date,
  status text NOT NULL DEFAULT 'draft',
  total_gross numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  total_net numeric NOT NULL DEFAULT 0,
  total_employer_epf numeric NOT NULL DEFAULT 0,
  total_employer_etf numeric NOT NULL DEFAULT 0,
  approved_by text,
  approved_at timestamptz,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage payroll runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view own tenant payroll runs"
  ON public.payroll_runs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Payroll run items (one per employee per run)
CREATE TABLE public.payroll_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  basic_salary numeric NOT NULL DEFAULT 0,
  hours_worked numeric DEFAULT 0,
  overtime_hours numeric DEFAULT 0,
  overtime_pay numeric NOT NULL DEFAULT 0,
  gross_pay numeric NOT NULL DEFAULT 0,
  employee_epf numeric NOT NULL DEFAULT 0,
  employer_epf numeric NOT NULL DEFAULT 0,
  employer_etf numeric NOT NULL DEFAULT 0,
  other_deductions numeric NOT NULL DEFAULT 0,
  bonuses numeric NOT NULL DEFAULT 0,
  allowances numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_run_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage payroll run items"
  ON public.payroll_run_items FOR ALL TO authenticated
  USING (run_id IN (SELECT id FROM public.payroll_runs WHERE tenant_id = get_user_tenant_id()));

CREATE POLICY "Users can view own tenant payroll run items"
  ON public.payroll_run_items FOR SELECT TO authenticated
  USING (run_id IN (SELECT id FROM public.payroll_runs WHERE tenant_id = get_user_tenant_id()) OR is_super_admin());

-- Payroll item details (individual earnings/deductions per employee per run)
CREATE TABLE public.payroll_item_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_item_id uuid NOT NULL REFERENCES public.payroll_run_items(id) ON DELETE CASCADE,
  earning_type_id uuid REFERENCES public.payroll_earning_types(id),
  category text NOT NULL DEFAULT 'earning',
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_item_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage payroll item details"
  ON public.payroll_item_details FOR ALL TO authenticated
  USING (run_item_id IN (
    SELECT pri.id FROM public.payroll_run_items pri
    JOIN public.payroll_runs pr ON pr.id = pri.run_id
    WHERE pr.tenant_id = get_user_tenant_id()
  ));

CREATE POLICY "Users can view own tenant payroll item details"
  ON public.payroll_item_details FOR SELECT TO authenticated
  USING (run_item_id IN (
    SELECT pri.id FROM public.payroll_run_items pri
    JOIN public.payroll_runs pr ON pr.id = pri.run_id
    WHERE pr.tenant_id = get_user_tenant_id()
  ) OR is_super_admin());
