-- ════════════════════════════════════════════════════════════════════════════
-- FIELD ATTENDANCE — morning late-cutoff policy.
-- Admins set a morning check-in cutoff for field employees and toggle it on/off.
-- When enabled, a field check-in AFTER the cutoff marks the day 'absent' instead
-- of 'present' (which the manual attendance summary already turns into an unpaid
-- absent day at payroll time — see rpc the WorkforceDashboard / payroll read).
-- When disabled, behaviour is unchanged: every field check-in is 'present'.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Per-tenant policy (singleton row per tenant) -----------------------------
CREATE TABLE IF NOT EXISTS public.field_attendance_settings (
  tenant_id           uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  late_cutoff_enabled boolean NOT NULL DEFAULT false,
  late_cutoff_time    time    NOT NULL DEFAULT '09:00',
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_attendance_settings ENABLE ROW LEVEL SECURITY;

-- Any tenant member may read the policy (the employee check-in screen shows it).
DO $$ BEGIN
  CREATE POLICY "Tenant members read field attendance settings"
    ON public.field_attendance_settings FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only non-Employee staff (admins) may change it.
DO $$ BEGIN
  CREATE POLICY "Tenant staff manage field attendance settings"
    ON public.field_attendance_settings FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
    WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Record which status a visit was stamped with (transparency in the grid). ---
ALTER TABLE public.field_visits
  ADD COLUMN IF NOT EXISTS attendance_status text;

-- 3. field_check_in: apply the cutoff when enabled. ---------------------------
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
  v_now_time time := (now() AT TIME ZONE 'Asia/Colombo')::time;
  v_enabled boolean := false;
  v_cutoff time;
  v_status text := 'present';
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

  -- Late-cutoff policy: if enabled and the check-in is past the cutoff, the day
  -- is marked absent.
  SELECT late_cutoff_enabled, late_cutoff_time INTO v_enabled, v_cutoff
    FROM public.field_attendance_settings WHERE tenant_id = v_tenant;
  IF COALESCE(v_enabled, false) AND v_cutoff IS NOT NULL AND v_now_time > v_cutoff THEN
    v_status := 'absent';
  END IF;

  INSERT INTO public.field_visits
    (tenant_id, employee_id, visit_date, check_in_at, check_in_lat, check_in_lng,
     check_in_accuracy, client_name, notes, attendance_status)
  VALUES
    (v_tenant, v_emp, v_today, now(), p_lat, p_lng, p_accuracy,
     NULLIF(btrim(p_client_name), ''), NULLIF(btrim(p_notes), ''), v_status)
  RETURNING * INTO v_visit;

  -- Mirror to the register so it shows in the grid and feeds payroll. A late
  -- (absent) field check-in must NOT overwrite an earlier on-time present for the
  -- same day, so an existing 'present' is only ever kept, never downgraded.
  INSERT INTO public.attendance_records
    (tenant_id, employee_id, attendance_date, status, check_in_time, entry_source)
  VALUES
    (v_tenant, v_emp, v_today, v_status, v_now_time, 'field')
  ON CONFLICT (tenant_id, employee_id, attendance_date)
  DO UPDATE SET status = CASE
                  WHEN public.attendance_records.status = 'present' THEN 'present'
                  ELSE EXCLUDED.status END,
                entry_source = 'field',
                check_in_time = COALESCE(public.attendance_records.check_in_time, EXCLUDED.check_in_time),
                updated_at = now()
    WHERE public.attendance_records.leave_request_id IS NULL
      AND public.attendance_records.entry_source <> 'manual';

  RETURN v_visit;
END; $$;

REVOKE ALL ON FUNCTION public.field_check_in(numeric, numeric, numeric, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.field_check_in(numeric, numeric, numeric, text, text) TO authenticated;
