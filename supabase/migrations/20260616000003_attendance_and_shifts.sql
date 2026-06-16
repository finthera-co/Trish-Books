-- ============================================================
-- PHASE 6: Shifts + attendance pipeline
-- ============================================================

-- 6a. Configurable shift patterns ----------------------------
CREATE TABLE public.work_shifts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name               text NOT NULL,
  start_time         time NOT NULL DEFAULT '09:00',
  end_time           time NOT NULL DEFAULT '17:00',
  break_minutes      int  NOT NULL DEFAULT 60,
  standard_hours     numeric NOT NULL DEFAULT 8,    -- net hours before OT
  ot_threshold_hours numeric NOT NULL DEFAULT 8,    -- worked beyond this = OT
  late_grace_minutes int  NOT NULL DEFAULT 15,
  crosses_midnight   boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  is_default         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_work_shifts_one_default
  ON public.work_shifts (tenant_id) WHERE is_default;
ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shifts_manage" ON public.work_shifts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "shifts_select" ON public.work_shifts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Per-employee default shift
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.work_shifts(id) ON DELETE SET NULL;

-- 6b. Saved device column-mapping profiles -------------------
CREATE TABLE public.attendance_device_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  file_format          text NOT NULL DEFAULT 'csv',         -- csv | xlsx
  column_mapping       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {device_id, date, time, datetime, direction}
  datetime_format      text,                                -- informational
  has_separate_date_time boolean NOT NULL DEFAULT false,
  direction_mode       text NOT NULL DEFAULT 'inferred',    -- explicit | inferred(alternating)
  in_values            text[] DEFAULT ARRAY['in','i','0','checkin','check-in','c/in'],
  out_values           text[] DEFAULT ARRAY['out','o','1','checkout','check-out','c/out'],
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_device_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adp_manage" ON public.attendance_device_profiles FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "adp_select" ON public.attendance_device_profiles FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- 6c. Import batches (audit) ---------------------------------
CREATE TABLE public.attendance_import_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_profile_id uuid REFERENCES public.attendance_device_profiles(id) ON DELETE SET NULL,
  file_name         text NOT NULL,
  period_start      date,
  period_end        date,
  total_rows        int NOT NULL DEFAULT 0,
  matched_rows      int NOT NULL DEFAULT 0,
  unmatched_rows    int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'parsed', -- parsed | aggregated | error
  imported_by       uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aib_manage" ON public.attendance_import_batches FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "aib_select" ON public.attendance_import_batches FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- 6d. Raw punches --------------------------------------------
CREATE TABLE public.attendance_punches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  batch_id       uuid NOT NULL REFERENCES public.attendance_import_batches(id) ON DELETE CASCADE,
  employee_id    uuid REFERENCES public.employees(id) ON DELETE SET NULL, -- null until matched
  raw_device_id  text NOT NULL,
  punch_at       timestamptz NOT NULL,
  direction      text NOT NULL DEFAULT 'unknown',  -- in | out | unknown
  is_matched     boolean NOT NULL DEFAULT false,
  raw_row        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_punches_batch ON public.attendance_punches (batch_id);
CREATE INDEX idx_punches_emp_time ON public.attendance_punches (employee_id, punch_at);
ALTER TABLE public.attendance_punches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "punch_manage" ON public.attendance_punches FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "punch_select" ON public.attendance_punches FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- 6e. Aggregated daily attendance ----------------------------
CREATE TABLE public.attendance_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date           date NOT NULL,
  shift_id            uuid REFERENCES public.work_shifts(id) ON DELETE SET NULL,
  first_in            timestamptz,
  last_out            timestamptz,
  worked_hours        numeric NOT NULL DEFAULT 0,
  ot_hours            numeric NOT NULL DEFAULT 0,
  late_minutes        int NOT NULL DEFAULT 0,
  early_leave_minutes int NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'present', -- present | absent | half_day | holiday | leave
  source              text NOT NULL DEFAULT 'biometric',
  batch_id            uuid REFERENCES public.attendance_import_batches(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_attendance_emp_date ON public.attendance_daily (employee_id, work_date);
ALTER TABLE public.attendance_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "att_manage" ON public.attendance_daily FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "att_select" ON public.attendance_daily FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
