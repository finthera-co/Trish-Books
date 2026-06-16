-- ============================================================
-- PHASE 1: Employee master expansion
-- ============================================================

-- 1a. New columns on employees -------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS date_of_birth     date,
  ADD COLUMN IF NOT EXISTS gender            text,
  ADD COLUMN IF NOT EXISTS civil_status      text,
  ADD COLUMN IF NOT EXISTS personal_phone    text,
  ADD COLUMN IF NOT EXISTS address_line1     text,
  ADD COLUMN IF NOT EXISTS address_line2     text,
  ADD COLUMN IF NOT EXISTS city              text,
  ADD COLUMN IF NOT EXISTS district          text,
  ADD COLUMN IF NOT EXISTS postal_code       text,
  ADD COLUMN IF NOT EXISTS employee_number   text,
  ADD COLUMN IF NOT EXISTS designation       text,
  ADD COLUMN IF NOT EXISTS manager_id        uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tin_number        text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS biometric_id      text;

-- Lenient CHECK constraints (kept permissive on purpose)
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS chk_employees_gender,
  DROP CONSTRAINT IF EXISTS chk_employees_civil_status;
ALTER TABLE public.employees
  ADD CONSTRAINT chk_employees_gender
    CHECK (gender IS NULL OR gender IN ('male','female','other')),
  ADD CONSTRAINT chk_employees_civil_status
    CHECK (civil_status IS NULL OR civil_status IN ('single','married','divorced','widowed'));

-- 1b. Per-tenant number counter (skip if one already exists) --
CREATE TABLE IF NOT EXISTS public.tenant_number_counters (
  tenant_id     uuid   NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  counter_key   text   NOT NULL,
  current_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, counter_key)
);
-- Internal mechanism: lock direct access, expose only via SECURITY DEFINER fn.
ALTER TABLE public.tenant_number_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_tenant_number(p_tenant_id uuid, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_next bigint;
BEGIN
  INSERT INTO public.tenant_number_counters (tenant_id, counter_key, current_value)
  VALUES (p_tenant_id, p_key, 1)
  ON CONFLICT (tenant_id, counter_key)
  DO UPDATE SET current_value = tenant_number_counters.current_value + 1
  RETURNING current_value INTO v_next;
  RETURN v_next;
END;
$$;

-- 1c. Auto-assign employee_number on insert ------------------
CREATE OR REPLACE FUNCTION public.set_employee_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_number IS NULL OR NEW.employee_number = '' THEN
    NEW.employee_number := 'EMP-' ||
      LPAD(public.next_tenant_number(NEW.tenant_id, 'employee')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_employee_number ON public.employees;
CREATE TRIGGER trg_set_employee_number
  BEFORE INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_employee_number();

-- 1d. Uniqueness (per-tenant) --------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_emp_number
  ON public.employees (tenant_id, employee_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_biometric_id
  ON public.employees (tenant_id, biometric_id) WHERE biometric_id IS NOT NULL;

-- 1e. Backfill employee_number for existing rows -------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, tenant_id FROM public.employees
    WHERE employee_number IS NULL OR employee_number = ''
    ORDER BY created_at
  LOOP
    UPDATE public.employees
      SET employee_number = 'EMP-' ||
        LPAD(public.next_tenant_number(r.tenant_id, 'employee')::text, 4, '0')
      WHERE id = r.id;
  END LOOP;
END $$;
