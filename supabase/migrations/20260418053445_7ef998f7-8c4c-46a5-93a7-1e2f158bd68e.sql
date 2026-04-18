-- Payroll → GL account mapping (QuickBooks-style: per-component, per-tenant, with optional employee/department override hooks for future)
CREATE TABLE public.payroll_component_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  component_code text NOT NULL,           -- e.g. BASIC, EPF_EMPLOYEE, EPF_EMPLOYER, ETF_EMPLOYER, NET_PAY, OTHER_DEDUCTIONS, OVERTIME, BONUS, ALLOWANCES
  posting_side text NOT NULL CHECK (posting_side IN ('debit','credit')),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, component_code, posting_side)
);

CREATE INDEX idx_pca_tenant ON public.payroll_component_accounts(tenant_id);

ALTER TABLE public.payroll_component_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read mapping"
  ON public.payroll_component_accounts FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Tenant admins manage mapping"
  ON public.payroll_component_accounts FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin')
  );

CREATE TRIGGER trg_pca_updated_at
BEFORE UPDATE ON public.payroll_component_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
