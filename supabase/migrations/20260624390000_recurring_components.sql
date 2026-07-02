-- Standing / recurring per-employee earnings & deductions. These pre-fill the
-- payroll run (allowances / non-EPF allowances / other deductions) so they don't
-- have to be re-typed every period.
CREATE TABLE IF NOT EXISTS public.employee_recurring_components (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  label          text NOT NULL,
  component_type text NOT NULL CHECK (component_type IN ('earning_epf','earning_non_epf','deduction')),
  amount         numeric NOT NULL CHECK (amount >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_components_emp
  ON public.employee_recurring_components (tenant_id, employee_id, is_active);
ALTER TABLE public.employee_recurring_components ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "recurring_components_rw" ON public.employee_recurring_components FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP TRIGGER IF EXISTS trg_recurring_components_updated ON public.employee_recurring_components;
CREATE TRIGGER trg_recurring_components_updated BEFORE UPDATE ON public.employee_recurring_components
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
