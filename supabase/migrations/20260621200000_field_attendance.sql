-- ════════════════════════════════════════════════════════════════════════════
-- FIELD / REMOTE ATTENDANCE — client-visit check-in/out with live GPS.
-- Employees check in/out from their portal; each visit is stored in field_visits
-- with coordinates, and the day is marked as a 'field' present in attendance_records
-- (so it feeds payroll like any worked day). Employees never write attendance
-- directly — only via the SECURITY DEFINER RPCs below, scoped to their own record.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Allow 'field' as an attendance entry source ------------------------------
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_attendance_records_entry_source;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_attendance_records_entry_source
  CHECK (entry_source IN ('manual','device','import','mobile','field'));

-- 2. field_visits -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  visit_date date NOT NULL,
  check_in_at timestamptz NOT NULL DEFAULT now(),
  check_in_lat numeric,
  check_in_lng numeric,
  check_in_accuracy numeric,
  check_out_at timestamptz,
  check_out_lat numeric,
  check_out_lng numeric,
  check_out_accuracy numeric,
  client_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_visits_tenant_emp_date
  ON public.field_visits (tenant_id, employee_id, visit_date);
-- At most one open (not-yet-checked-out) visit per employee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_visits_open_per_employee
  ON public.field_visits (employee_id) WHERE check_out_at IS NULL;

DROP TRIGGER IF EXISTS trg_field_visits_updated_at ON public.field_visits;
CREATE TRIGGER trg_field_visits_updated_at
  BEFORE UPDATE ON public.field_visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS ----------------------------------------------------------------------
ALTER TABLE public.field_visits ENABLE ROW LEVEL SECURITY;

-- Employees read their own visits.
DO $$ BEGIN
  CREATE POLICY "Employees read own field visits"
    ON public.field_visits FOR SELECT TO authenticated
    USING (employee_id = public.get_user_employee_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admins/staff (non-Employee tenant members) read all tenant visits.
DO $$ BEGIN
  CREATE POLICY "Tenant staff read field visits"
    ON public.field_visits FOR SELECT TO authenticated
    USING ((tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
           OR public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admins/staff may manage tenant visits (corrections). Employees write only via RPC.
DO $$ BEGIN
  CREATE POLICY "Tenant staff manage field visits"
    ON public.field_visits FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
    WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. RPC: check in ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.field_check_in(
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS public.field_visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid;
  v_tenant uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Colombo')::date;
  v_visit public.field_visits;
BEGIN
  v_emp := public.get_user_employee_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee profile linked to this account';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.employees WHERE id = v_emp;

  IF EXISTS (SELECT 1 FROM public.field_visits
             WHERE employee_id = v_emp AND check_out_at IS NULL) THEN
    RAISE EXCEPTION 'You already have an open field visit — check out first';
  END IF;

  INSERT INTO public.field_visits
    (tenant_id, employee_id, visit_date, check_in_at, check_in_lat, check_in_lng,
     check_in_accuracy, client_name, notes)
  VALUES
    (v_tenant, v_emp, v_today, now(), p_lat, p_lng, p_accuracy,
     NULLIF(btrim(p_client_name), ''), NULLIF(btrim(p_notes), ''))
  RETURNING * INTO v_visit;

  -- Mark the day present (field) so it shows in the grid and feeds payroll.
  INSERT INTO public.attendance_records
    (tenant_id, employee_id, attendance_date, status, check_in_time, entry_source)
  VALUES
    (v_tenant, v_emp, v_today, 'present', (now() AT TIME ZONE 'Asia/Colombo')::time, 'field')
  ON CONFLICT (tenant_id, employee_id, attendance_date)
  DO UPDATE SET status = 'present',
                entry_source = 'field',
                check_in_time = COALESCE(public.attendance_records.check_in_time,
                                         (now() AT TIME ZONE 'Asia/Colombo')::time),
                updated_at = now();

  RETURN v_visit;
END; $$;

-- 5. RPC: check out -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.field_check_out(
  p_visit_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL
) RETURNS public.field_visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid;
  v_visit public.field_visits;
BEGIN
  v_emp := public.get_user_employee_id();
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee profile linked to this account';
  END IF;

  SELECT * INTO v_visit FROM public.field_visits
    WHERE id = p_visit_id AND employee_id = v_emp FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field visit not found';
  END IF;
  IF v_visit.check_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'This visit is already checked out';
  END IF;

  UPDATE public.field_visits
     SET check_out_at = now(), check_out_lat = p_lat,
         check_out_lng = p_lng, check_out_accuracy = p_accuracy
   WHERE id = p_visit_id
   RETURNING * INTO v_visit;

  UPDATE public.attendance_records
     SET check_out_time = (now() AT TIME ZONE 'Asia/Colombo')::time, updated_at = now()
   WHERE tenant_id = v_visit.tenant_id
     AND employee_id = v_emp
     AND attendance_date = v_visit.visit_date
     AND entry_source = 'field';

  RETURN v_visit;
END; $$;

REVOKE ALL ON FUNCTION public.field_check_in(numeric, numeric, numeric, text, text) FROM public;
REVOKE ALL ON FUNCTION public.field_check_out(uuid, numeric, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.field_check_in(numeric, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.field_check_out(uuid, numeric, numeric, numeric) TO authenticated;
