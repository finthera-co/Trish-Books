-- ============================================================
-- PHASE 7: Client Visits + GPS Location Tracking
-- ============================================================

-- 7a. Alter attendance_records CHECK constraint for mobile entry source
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT constraint_name
        FROM information_schema.constraint_column_usage
        WHERE table_name = 'attendance_records' AND column_name = 'entry_source'
    LOOP
        EXECUTE 'ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_attendance_records_entry_source
  CHECK (entry_source IN ('manual', 'device', 'import', 'mobile'));

-- 7b. Create client_visits table
CREATE TABLE IF NOT EXISTS public.client_visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  client_name         text NOT NULL,
  visit_date          date NOT NULL DEFAULT CURRENT_DATE,
  check_in_time       timestamptz NOT NULL DEFAULT now(),
  check_out_time      timestamptz,
  check_in_latitude   numeric,
  check_in_longitude  numeric,
  check_out_latitude  numeric,
  check_out_longitude numeric,
  check_in_address    text,
  check_out_address   text,
  notes               text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Indices for rapid queries
CREATE INDEX IF NOT EXISTS idx_client_visits_tenant_date ON public.client_visits (tenant_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_client_visits_emp_date ON public.client_visits (employee_id, visit_date);

-- Enable RLS
ALTER TABLE public.client_visits ENABLE ROW LEVEL SECURITY;

-- Policies for RLS
CREATE POLICY "client_visits_manage" ON public.client_visits
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- 7c. Automated attendance synchronization trigger
CREATE OR REPLACE FUNCTION public.sync_client_visit_to_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id uuid;
  v_tenant_id uuid;
  v_date date;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_count bigint;
  v_notes text;
  v_locked boolean;
BEGIN
  -- Determine employee, tenant, and date depending on operation
  IF TG_OP = 'DELETE' THEN
    v_emp_id := OLD.employee_id;
    v_tenant_id := OLD.tenant_id;
    v_date := OLD.visit_date;
  ELSE
    v_emp_id := NEW.employee_id;
    v_tenant_id := NEW.tenant_id;
    v_date := NEW.visit_date;
  END IF;

  -- 1. Check if the period is locked by a finalized payroll run
  IF public.is_attendance_period_locked(v_tenant_id, v_date) THEN
    RAISE EXCEPTION 'Attendance for % is locked by a processed/finalized payroll run', v_date;
  END IF;

  -- 2. Aggregate visits for this employee and date
  SELECT
    MIN(check_in_time),
    MAX(check_out_time),
    COUNT(*)
  INTO
    v_first_in,
    v_last_out,
    v_count
  FROM public.client_visits
  WHERE employee_id = v_emp_id
    AND visit_date = v_date;

  -- 3. Sync to attendance_records
  IF v_count > 0 THEN
    -- Compile a list of visited client names for notes
    SELECT string_agg(client_name, ', ')
    INTO v_notes
    FROM (
      SELECT DISTINCT client_name
      FROM public.client_visits
      WHERE employee_id = v_emp_id AND visit_date = v_date
    ) t;

    INSERT INTO public.attendance_records (
      tenant_id,
      employee_id,
      attendance_date,
      status,
      check_in_time,
      check_out_time,
      entry_source,
      notes,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_emp_id,
      v_date,
      'present',
      v_first_in::time,
      v_last_out::time,
      'mobile',
      'Logged via client visits: ' || v_notes,
      now()
    )
    ON CONFLICT (tenant_id, employee_id, attendance_date)
    DO UPDATE SET
      check_in_time = EXCLUDED.check_in_time,
      check_out_time = EXCLUDED.check_out_time,
      notes = EXCLUDED.notes,
      status = 'present',
      entry_source = 'mobile',
      updated_at = now();
  ELSE
    -- If no visits remain for this date, delete the synchronized mobile attendance record
    DELETE FROM public.attendance_records
    WHERE tenant_id = v_tenant_id
      AND employee_id = v_emp_id
      AND attendance_date = v_date
      AND entry_source = 'mobile';
  END IF;

  RETURN NULL;
END;
$$;

-- Register the trigger
DROP TRIGGER IF EXISTS trg_sync_client_visit_to_attendance ON public.client_visits;
CREATE TRIGGER trg_sync_client_visit_to_attendance
  AFTER INSERT OR UPDATE OR DELETE ON public.client_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_client_visit_to_attendance();
