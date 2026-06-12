-- ═════════════════════════════════════════════════════════════════════════════
-- ATTENDANCE REGISTER & LEAVE MANAGEMENT (manual entry, device-ready schema)
-- Feeds payroll pro-rata: deduction = (basic / working_days) * unpaid_absent_days
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. leave_types (tenant-scoped catalogue)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  is_paid boolean NOT NULL DEFAULT true,
  annual_entitlement numeric NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_tenant ON public.leave_types(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. leave_requests
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  days numeric NOT NULL CHECK (days > 0),
  is_half_day boolean NOT NULL DEFAULT false,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_status ON public.leave_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_employee ON public.leave_requests(tenant_id, employee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. holidays
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  is_recurring boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_holidays_tenant_date ON public.holidays(tenant_id, holiday_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. attendance_records (manual entry now; device/import columns are
--    future-proofing only — fingerprint scanners will write entry_source='device')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','half_day','paid_leave','unpaid_leave','holiday','weekend')),
  check_in_time time,
  check_out_time time,
  overtime_hours numeric NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  leave_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  entry_source text NOT NULL DEFAULT 'manual' CHECK (entry_source IN ('manual','device','import')),
  device_id text,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON public.attendance_records(tenant_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_emp_date ON public.attendance_records(tenant_id, employee_id, attendance_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_attendance_records_updated_at ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_updated_at
BEFORE UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_leave_requests_updated_at ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_updated_at
BEFORE UPDATE ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — SELECT (tenant or super admin) + FOR ALL with USING AND WITH CHECK
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Tenant members read leave types"
    ON public.leave_types FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members write leave types"
    ON public.leave_types FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members read leave requests"
    ON public.leave_requests FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members write leave requests"
    ON public.leave_requests FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members read holidays"
    ON public.holidays FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members write holidays"
    ON public.holidays FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members read attendance"
    ON public.attendance_records FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members write attendance"
    ON public.attendance_records FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed default leave types (mirrors seed_default_payroll_engine pattern)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_default_leave_types(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.leave_types (tenant_id, name, code, is_paid, annual_entitlement, requires_approval) VALUES
    (p_tenant_id, 'Annual Leave',       'ANNUAL', true,  14, true),
    (p_tenant_id, 'Casual Leave',       'CASUAL', true,  7,  true),
    (p_tenant_id, 'Sick / Medical',     'SICK',   true,  7,  true),
    (p_tenant_id, 'No-Pay Leave',       'NOPAY',  false, 0,  true)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_default_leave_types(t.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tenant_seed_leave_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_leave_types(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_seed_leave_types ON public.tenants;
CREATE TRIGGER trg_tenant_seed_leave_types
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenant_seed_leave_types();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Payroll-lock guard: attendance covered by a processed/finalized run is
--    immutable. Enforced at the table level so direct upserts are blocked too.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_attendance_period_locked(p_tenant_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.status IN ('processed','finalized')
      AND p_date BETWEEN pr.period_start AND pr.period_end
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_locked_attendance_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND public.is_attendance_period_locked(NEW.tenant_id, NEW.attendance_date) THEN
    RAISE EXCEPTION 'Attendance for % is locked by a processed/finalized payroll run', NEW.attendance_date;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND public.is_attendance_period_locked(OLD.tenant_id, OLD.attendance_date) THEN
    RAISE EXCEPTION 'Attendance for % is locked by a processed/finalized payroll run', OLD.attendance_date;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_lock_guard ON public.attendance_records;
CREATE TRIGGER trg_attendance_lock_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_attendance_changes();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Leave approval / rejection / cancellation RPCs
--    Balance mapping (per current employees schema defaults):
--      ANNUAL → leave_balance (14) · CASUAL → vacation_balance (7)
--      SICK → sick_balance (7) · other paid types → leave_balance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_leave_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.leave_requests%ROWTYPE;
  v_type public.leave_types%ROWTYPE;
  v_tenant uuid := public.get_user_tenant_id();
  v_approver uuid;
  v_day date;
  v_status text;
  v_balance numeric;
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be approved (current status: %)', v_req.status;
  END IF;

  SELECT * INTO v_type FROM public.leave_types WHERE id = v_req.leave_type_id;

  -- Block approval if any day falls in a locked payroll period
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.tenant_id = v_tenant
      AND pr.status IN ('processed','finalized')
      AND pr.period_start <= v_req.end_date
      AND pr.period_end >= v_req.start_date
  ) THEN
    RAISE EXCEPTION 'Leave dates overlap a processed/finalized payroll period';
  END IF;

  -- Paid leave: check and decrement the matching balance column
  IF v_type.is_paid THEN
    SELECT CASE v_type.code
             WHEN 'SICK'   THEN sick_balance
             WHEN 'CASUAL' THEN vacation_balance
             ELSE leave_balance
           END
      INTO v_balance
      FROM public.employees
     WHERE id = v_req.employee_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Employee not found';
    END IF;
    IF COALESCE(v_balance, 0) < v_req.days THEN
      RAISE EXCEPTION 'Insufficient % balance: % remaining, % requested', v_type.name, COALESCE(v_balance, 0), v_req.days;
    END IF;
    UPDATE public.employees SET
      sick_balance     = CASE WHEN v_type.code = 'SICK'   THEN sick_balance - v_req.days ELSE sick_balance END,
      vacation_balance = CASE WHEN v_type.code = 'CASUAL' THEN vacation_balance - v_req.days ELSE vacation_balance END,
      leave_balance    = CASE WHEN v_type.code NOT IN ('SICK','CASUAL') THEN leave_balance - v_req.days ELSE leave_balance END
    WHERE id = v_req.employee_id;
  END IF;

  SELECT u.id INTO v_approver FROM public.users u WHERE u.auth_user_id = auth.uid();

  UPDATE public.leave_requests
     SET status = 'approved', approved_by = v_approver, approved_at = now()
   WHERE id = p_request_id;

  -- Half-day requests mark the day as half_day (0.5 present + 0.5 leave);
  -- full days are marked paid_leave/unpaid_leave per the leave type.
  v_status := CASE
    WHEN v_req.is_half_day THEN 'half_day'
    WHEN v_type.is_paid THEN 'paid_leave'
    ELSE 'unpaid_leave'
  END;

  v_day := v_req.start_date;
  WHILE v_day <= v_req.end_date LOOP
    IF EXTRACT(ISODOW FROM v_day) < 6
       AND NOT EXISTS (
         SELECT 1 FROM public.holidays h
         WHERE h.tenant_id = v_tenant
           AND (h.holiday_date = v_day
                OR (h.is_recurring
                    AND EXTRACT(MONTH FROM h.holiday_date) = EXTRACT(MONTH FROM v_day)
                    AND EXTRACT(DAY FROM h.holiday_date) = EXTRACT(DAY FROM v_day)))
       )
    THEN
      INSERT INTO public.attendance_records
        (tenant_id, employee_id, attendance_date, status, leave_request_id, entry_source, created_by)
      VALUES
        (v_tenant, v_req.employee_id, v_day, v_status, v_req.id, 'manual', v_approver)
      ON CONFLICT (tenant_id, employee_id, attendance_date)
      DO UPDATE SET status = EXCLUDED.status,
                    leave_request_id = EXCLUDED.leave_request_id,
                    updated_at = now();
    END IF;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_leave_request(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.leave_requests%ROWTYPE;
  v_tenant uuid := public.get_user_tenant_id();
  v_approver uuid;
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be rejected (current status: %)', v_req.status;
  END IF;

  SELECT u.id INTO v_approver FROM public.users u WHERE u.auth_user_id = auth.uid();

  UPDATE public.leave_requests
     SET status = 'rejected', approved_by = v_approver, approved_at = now(), rejection_reason = p_reason
   WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.leave_requests%ROWTYPE;
  v_type public.leave_types%ROWTYPE;
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF v_req.status NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Only pending or approved requests can be cancelled (current status: %)', v_req.status;
  END IF;

  IF v_req.status = 'approved' THEN
    -- Locked payroll period → attendance is immutable, balance already consumed
    IF EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.tenant_id = v_tenant
        AND pr.status IN ('processed','finalized')
        AND pr.period_start <= v_req.end_date
        AND pr.period_end >= v_req.start_date
    ) THEN
      RAISE EXCEPTION 'Cannot cancel: leave dates are covered by a processed/finalized payroll run';
    END IF;

    DELETE FROM public.attendance_records
     WHERE leave_request_id = v_req.id AND tenant_id = v_tenant;

    SELECT * INTO v_type FROM public.leave_types WHERE id = v_req.leave_type_id;
    IF v_type.is_paid THEN
      UPDATE public.employees SET
        sick_balance     = CASE WHEN v_type.code = 'SICK'   THEN sick_balance + v_req.days ELSE sick_balance END,
        vacation_balance = CASE WHEN v_type.code = 'CASUAL' THEN vacation_balance + v_req.days ELSE vacation_balance END,
        leave_balance    = CASE WHEN v_type.code NOT IN ('SICK','CASUAL') THEN leave_balance + v_req.days ELSE leave_balance END
      WHERE id = v_req.employee_id AND tenant_id = v_tenant;
    END IF;
  END IF;

  UPDATE public.leave_requests SET status = 'cancelled' WHERE id = p_request_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. get_attendance_summary — the payroll bridge.
--     Unmarked working days are reported separately (NOT treated as absent):
--     the payroll form defaults them to present and surfaces the count so the
--     user can correct the register.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  p_period_start date,
  p_period_end date,
  p_employee_id uuid DEFAULT NULL
) RETURNS TABLE (
  employee_id uuid,
  working_days numeric,
  days_present numeric,
  paid_leave_days numeric,
  unpaid_absent_days numeric,
  unmarked_days numeric,
  overtime_hours numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  RETURN QUERY
  WITH work_days AS (
    SELECT d::date AS day
    FROM generate_series(p_period_start, p_period_end, interval '1 day') d
    WHERE EXTRACT(ISODOW FROM d) < 6
      AND NOT EXISTS (
        SELECT 1 FROM public.holidays h
        WHERE h.tenant_id = v_tenant
          AND (h.holiday_date = d::date
               OR (h.is_recurring
                   AND EXTRACT(MONTH FROM h.holiday_date) = EXTRACT(MONTH FROM d)
                   AND EXTRACT(DAY FROM h.holiday_date) = EXTRACT(DAY FROM d)))
      )
  ),
  wd_count AS (SELECT COUNT(*)::numeric AS n FROM work_days),
  emps AS (
    SELECT e.id
    FROM public.employees e
    WHERE e.tenant_id = v_tenant
      AND (p_employee_id IS NULL OR e.id = p_employee_id)
  ),
  recs AS (
    SELECT ar.employee_id AS emp_id, ar.attendance_date, ar.status, ar.overtime_hours,
           COALESCE(lt.is_paid, false) AS leave_is_paid
    FROM public.attendance_records ar
    JOIN work_days w ON w.day = ar.attendance_date
    LEFT JOIN public.leave_requests lr ON lr.id = ar.leave_request_id
    LEFT JOIN public.leave_types lt ON lt.id = lr.leave_type_id
    WHERE ar.tenant_id = v_tenant
      AND (p_employee_id IS NULL OR ar.employee_id = p_employee_id)
  )
  SELECT
    e.id AS employee_id,
    (SELECT n FROM wd_count) AS working_days,
    COALESCE(SUM(CASE
      WHEN r.status = 'present' THEN 1
      WHEN r.status = 'half_day' THEN 0.5
      ELSE 0 END), 0)::numeric AS days_present,
    COALESCE(SUM(CASE
      WHEN r.status = 'paid_leave' THEN 1
      WHEN r.status = 'half_day' AND r.leave_is_paid THEN 0.5
      ELSE 0 END), 0)::numeric AS paid_leave_days,
    COALESCE(SUM(CASE
      WHEN r.status IN ('absent','unpaid_leave') THEN 1
      WHEN r.status = 'half_day' AND NOT r.leave_is_paid THEN 0.5
      ELSE 0 END), 0)::numeric AS unpaid_absent_days,
    ((SELECT n FROM wd_count) - COUNT(r.attendance_date) FILTER (
       WHERE r.status IN ('present','absent','half_day','paid_leave','unpaid_leave')
    ))::numeric AS unmarked_days,
    COALESCE(SUM(r.overtime_hours), 0)::numeric AS overtime_hours
  FROM emps e
  LEFT JOIN recs r ON r.emp_id = e.id
  GROUP BY e.id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Additive payroll_run_items columns (full contractual basic stays in
--     basic_salary; the pro-rata deduction is stored separately for audit)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS working_days numeric,
  ADD COLUMN IF NOT EXISTS days_present numeric,
  ADD COLUMN IF NOT EXISTS paid_leave_days numeric,
  ADD COLUMN IF NOT EXISTS unpaid_absent_days numeric,
  ADD COLUMN IF NOT EXISTS attendance_deduction numeric NOT NULL DEFAULT 0;
