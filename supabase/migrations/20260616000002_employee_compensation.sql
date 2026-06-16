-- ============================================================
-- PHASE 2: Dated compensation history
-- ============================================================
CREATE TABLE public.employee_compensation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  effective_from date    NOT NULL DEFAULT CURRENT_DATE,
  basic_salary   numeric NOT NULL DEFAULT 0,
  pay_rate       numeric NOT NULL DEFAULT 0,   -- hourly rate, when applicable
  pay_frequency  text    NOT NULL DEFAULT 'monthly',
  is_current     boolean NOT NULL DEFAULT true,
  notes          text,
  created_by     uuid REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Exactly one current row per employee
CREATE UNIQUE INDEX uq_emp_comp_one_current
  ON public.employee_compensation (employee_id) WHERE is_current;
CREATE INDEX idx_emp_comp_employee ON public.employee_compensation (employee_id, effective_from DESC);

-- Demote prior current rows before a new current row lands
CREATE OR REPLACE FUNCTION public.handle_compensation_current()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.employee_compensation
      SET is_current = false
      WHERE employee_id = NEW.employee_id
        AND is_current
        AND id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_compensation_current ON public.employee_compensation;
CREATE TRIGGER trg_compensation_current
  BEFORE INSERT OR UPDATE ON public.employee_compensation
  FOR EACH ROW EXECUTE FUNCTION public.handle_compensation_current();

-- Mirror the current comp row back to employees (backward-compat bridge)
CREATE OR REPLACE FUNCTION public.sync_employee_current_compensation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_emp   uuid := COALESCE(NEW.employee_id, OLD.employee_id);
  v_basic numeric;
  v_rate  numeric;
BEGIN
  SELECT basic_salary, pay_rate INTO v_basic, v_rate
    FROM public.employee_compensation
    WHERE employee_id = v_emp AND is_current
    ORDER BY effective_from DESC LIMIT 1;
  UPDATE public.employees
    SET salary   = COALESCE(v_basic, 0),
        pay_rate = COALESCE(v_rate, 0)
    WHERE id = v_emp;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_employee_compensation ON public.employee_compensation;
CREATE TRIGGER trg_sync_employee_compensation
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_compensation
  FOR EACH ROW EXECUTE FUNCTION public.sync_employee_current_compensation();

-- RLS (USING + WITH CHECK)
ALTER TABLE public.employee_compensation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emp_comp_manage" ON public.employee_compensation
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "emp_comp_select" ON public.employee_compensation
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Backfill: seed a current comp row from any existing employees.salary
INSERT INTO public.employee_compensation
  (tenant_id, employee_id, effective_from, basic_salary, pay_rate, pay_frequency, is_current)
SELECT e.tenant_id, e.id, COALESCE(e.hire_date, CURRENT_DATE),
       COALESCE(e.salary, 0), COALESCE(e.pay_rate, 0),
       COALESCE(e.pay_rate_type, 'monthly'), true
FROM public.employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_compensation c WHERE c.employee_id = e.id
);
