-- ============================================================
-- LEAVE MANAGEMENT — in-place upgrade.
-- leave_types / leave_requests / holidays already exist (20260612000002_attendance_leave).
-- This ALTERs them to the reserve/settle model, adds leave_balances, and
-- replaces the approve/reject/cancel RPCs with balance-aware versions.
-- ============================================================

-- 1. leave_types: add reserve-model columns -----------------
ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS default_annual_quota numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_consecutive_days int,
  ADD COLUMN IF NOT EXISTS allow_negative_balance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS color text;
-- Mirror the legacy annual_entitlement into the new quota column.
UPDATE public.leave_types SET default_annual_quota = COALESCE(annual_entitlement, 0)
  WHERE default_annual_quota = 0 AND annual_entitlement IS NOT NULL;

-- 2. leave_requests: add request#, half-day period, reject/cancel/settle audit ---
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS request_number text,
  ADD COLUMN IF NOT EXISTS half_day_period text,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_in_run_id uuid REFERENCES public.payroll_runs(id);

-- widen status to allow 'settled'
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('pending','approved','rejected','cancelled','settled'));

-- half-day period domain (NOT VALID: enforce on new rows, don't fail on legacy)
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS chk_leave_req_half_period;
ALTER TABLE public.leave_requests ADD CONSTRAINT chk_leave_req_half_period
  CHECK (half_day_period IS NULL OR half_day_period IN ('morning','afternoon')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON public.leave_requests (tenant_id, employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests (tenant_id, status);

-- 3. leave_balances (new) -----------------------------------
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  year int NOT NULL,
  entitled numeric NOT NULL DEFAULT 0,
  carried_forward numeric NOT NULL DEFAULT 0,
  adjustment numeric NOT NULL DEFAULT 0,
  taken numeric NOT NULL DEFAULT 0,
  reserved numeric NOT NULL DEFAULT 0,
  available numeric GENERATED ALWAYS AS (entitled + carried_forward + adjustment - taken - reserved) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, year)
);
CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON public.leave_balances (tenant_id, employee_id, year);
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_balances_manage" ON public.leave_balances;
CREATE POLICY "leave_balances_manage" ON public.leave_balances FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "leave_balances_select" ON public.leave_balances;
CREATE POLICY "leave_balances_select" ON public.leave_balances FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP TRIGGER IF EXISTS trg_leave_balances_updated ON public.leave_balances;
CREATE TRIGGER trg_leave_balances_updated BEFORE UPDATE ON public.leave_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Working-day counter (excl Sunday + holidays incl recurring) ---
CREATE OR REPLACE FUNCTION public.count_working_days(
  p_tenant_id uuid, p_start date, p_end date, p_is_half_day boolean DEFAULT false
) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_count numeric := 0; d date;
BEGIN
  IF p_is_half_day AND p_start = p_end THEN
    IF EXTRACT(DOW FROM p_start) <> 0
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = p_tenant_id
         AND (h.holiday_date = p_start OR (h.is_recurring
           AND EXTRACT(MONTH FROM h.holiday_date)=EXTRACT(MONTH FROM p_start)
           AND EXTRACT(DAY FROM h.holiday_date)=EXTRACT(DAY FROM p_start))))
    THEN RETURN 0.5; ELSE RETURN 0; END IF;
  END IF;
  d := p_start;
  WHILE d <= p_end LOOP
    IF EXTRACT(DOW FROM d) <> 0
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = p_tenant_id
         AND (h.holiday_date = d OR (h.is_recurring
           AND EXTRACT(MONTH FROM h.holiday_date)=EXTRACT(MONTH FROM d)
           AND EXTRACT(DAY FROM h.holiday_date)=EXTRACT(DAY FROM d))))
    THEN v_count := v_count + 1; END IF;
    d := d + 1;
  END LOOP;
  RETURN v_count;
END; $$;

-- 5. Triggers: compute days + request number -----------------
CREATE OR REPLACE FUNCTION public.set_leave_request_days()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.days := public.count_working_days(NEW.tenant_id, NEW.start_date, NEW.end_date, NEW.is_half_day);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_set_leave_days ON public.leave_requests;
CREATE TRIGGER trg_set_leave_days
  BEFORE INSERT OR UPDATE OF start_date, end_date, is_half_day ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_leave_request_days();

CREATE OR REPLACE FUNCTION public.set_leave_request_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  IF NEW.request_number IS NULL OR NEW.request_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(request_number,'\D','','g'),'')::int),0)+1
      INTO v_n FROM public.leave_requests WHERE tenant_id = NEW.tenant_id;
    NEW.request_number := 'LR-' || lpad(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_set_leave_request_number ON public.leave_requests;
CREATE TRIGGER trg_set_leave_request_number BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_leave_request_number();

-- 6. Balance helper ------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_leave_balance(p_tenant uuid, p_emp uuid, p_type uuid, p_year int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_quota numeric;
BEGIN
  SELECT id INTO v_id FROM public.leave_balances
    WHERE employee_id = p_emp AND leave_type_id = p_type AND year = p_year;
  IF v_id IS NULL THEN
    SELECT default_annual_quota INTO v_quota FROM public.leave_types WHERE id = p_type;
    INSERT INTO public.leave_balances (tenant_id, employee_id, leave_type_id, year, entitled)
      VALUES (p_tenant, p_emp, p_type, p_year, COALESCE(v_quota,0)) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END; $$;

-- The legacy approve/reject/cancel returned void; ours return jsonb, so drop first
-- (CREATE OR REPLACE cannot change a function's return type).
DROP FUNCTION IF EXISTS public.approve_leave_request(uuid);
DROP FUNCTION IF EXISTS public.reject_leave_request(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_leave_request(uuid);
DROP FUNCTION IF EXISTS public.settle_leave_for_period(date, date, uuid);

-- 7. Approve (reserve) ---------------------------------------
CREATE OR REPLACE FUNCTION public.approve_leave_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid; v_tenant uuid; v_role text;
  v_req public.leave_requests%ROWTYPE;
  v_bal_id uuid; v_available numeric; v_allow_neg boolean; v_year int; v_overlap int;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := public.get_user_role_name();
  IF v_role NOT IN ('Primary Admin','Company Admin','Super Admin') THEN
    RAISE EXCEPTION 'Not authorized to approve leave';
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be approved (current: %)', v_req.status; END IF;

  SELECT COUNT(*) INTO v_overlap FROM public.leave_requests r
    WHERE r.employee_id = v_req.employee_id AND r.id <> v_req.id
      AND r.status IN ('approved','settled')
      AND r.start_date <= v_req.end_date AND r.end_date >= v_req.start_date;
  IF v_overlap > 0 THEN RAISE EXCEPTION 'Employee already has approved leave overlapping these dates'; END IF;

  v_year := EXTRACT(YEAR FROM v_req.start_date);
  v_bal_id := public.ensure_leave_balance(v_tenant, v_req.employee_id, v_req.leave_type_id, v_year);
  SELECT allow_negative_balance INTO v_allow_neg FROM public.leave_types WHERE id = v_req.leave_type_id;

  SELECT available INTO v_available FROM public.leave_balances WHERE id = v_bal_id FOR UPDATE;
  IF NOT COALESCE(v_allow_neg,false) AND v_available < v_req.days THEN
    RAISE EXCEPTION 'Insufficient balance: % available, % requested', v_available, v_req.days;
  END IF;

  UPDATE public.leave_balances SET reserved = reserved + v_req.days WHERE id = v_bal_id;
  UPDATE public.leave_requests SET status='approved', approved_by=v_user, approved_at=now() WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'status','approved', 'days', v_req.days, 'available_after', v_available - v_req.days);
END; $$;

-- 8. Reject --------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_leave_request(p_request_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_tenant uuid; v_role text; v_status text;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := public.get_user_role_name();
  IF v_role NOT IN ('Primary Admin','Company Admin','Super Admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT status INTO v_status FROM public.leave_requests WHERE id = p_request_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be rejected'; END IF;
  UPDATE public.leave_requests SET status='rejected', rejected_by=v_user, rejected_at=now(),
    rejection_reason=p_reason WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'status','rejected');
END; $$;

-- 9. Cancel (restore reserve if was approved) ---------------
CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_tenant uuid; v_req public.leave_requests%ROWTYPE; v_bal_id uuid; v_year int;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF v_req.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Cannot cancel a % request', v_req.status; END IF;
  IF v_req.status = 'approved' THEN
    v_year := EXTRACT(YEAR FROM v_req.start_date);
    SELECT id INTO v_bal_id FROM public.leave_balances
      WHERE employee_id = v_req.employee_id AND leave_type_id = v_req.leave_type_id AND year = v_year FOR UPDATE;
    IF v_bal_id IS NOT NULL THEN
      UPDATE public.leave_balances SET reserved = GREATEST(0, reserved - v_req.days) WHERE id = v_bal_id;
    END IF;
  END IF;
  UPDATE public.leave_requests SET status='cancelled', cancelled_at=now() WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'status','cancelled');
END; $$;

-- 10. Settle for a payroll period (reserved -> taken) --------
CREATE OR REPLACE FUNCTION public.settle_leave_for_period(p_period_start date, p_period_end date, p_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_user uuid; v_count int := 0; r RECORD; v_bal_id uuid; v_year int;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR r IN
    SELECT * FROM public.leave_requests
    WHERE tenant_id = v_tenant AND status = 'approved'
      AND start_date <= p_period_end AND end_date >= p_period_start
    FOR UPDATE
  LOOP
    v_year := EXTRACT(YEAR FROM r.start_date);
    SELECT id INTO v_bal_id FROM public.leave_balances
      WHERE employee_id = r.employee_id AND leave_type_id = r.leave_type_id AND year = v_year FOR UPDATE;
    IF v_bal_id IS NOT NULL THEN
      UPDATE public.leave_balances SET reserved = GREATEST(0, reserved - r.days), taken = taken + r.days WHERE id = v_bal_id;
    END IF;
    UPDATE public.leave_requests SET status='settled', settled_at=now(), settled_in_run_id=p_run_id WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'settled', v_count);
END; $$;

REVOKE ALL ON FUNCTION public.approve_leave_request(uuid) FROM public;
REVOKE ALL ON FUNCTION public.reject_leave_request(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.cancel_leave_request(uuid) FROM public;
REVOKE ALL ON FUNCTION public.settle_leave_for_period(date, date, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_leave_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_leave_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_leave_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_leave_for_period(date, date, uuid) TO authenticated;

-- 11. Seed default types (where missing) + current-year balances -------
INSERT INTO public.leave_types (tenant_id, name, code, is_paid, annual_entitlement, default_annual_quota, color)
SELECT t.id, x.name, x.code, x.is_paid, x.quota, x.quota, x.color
FROM public.tenants t
CROSS JOIN (VALUES
  ('Annual Leave','ANNUAL', true, 14, '#3b82f6'),
  ('Casual Leave','CASUAL', true, 7,  '#8b5cf6'),
  ('Sick Leave','SICK',     true, 7,  '#ef4444'),
  ('No-Pay Leave','NOPAY',  false,0,  '#6b7280')
) AS x(name, code, is_paid, quota, color)
WHERE NOT EXISTS (SELECT 1 FROM public.leave_types lt WHERE lt.tenant_id = t.id AND lt.code = x.code);

-- current-year balances seeded from legacy employee columns (available matches old number)
INSERT INTO public.leave_balances (tenant_id, employee_id, leave_type_id, year, entitled)
SELECT e.tenant_id, e.id, lt.id, EXTRACT(YEAR FROM CURRENT_DATE)::int,
  CASE lt.code
    WHEN 'ANNUAL' THEN COALESCE(e.leave_balance, lt.default_annual_quota)
    WHEN 'CASUAL' THEN COALESCE(e.vacation_balance, lt.default_annual_quota)
    WHEN 'SICK'   THEN COALESCE(e.sick_balance, lt.default_annual_quota)
    ELSE lt.default_annual_quota
  END
FROM public.employees e
JOIN public.leave_types lt ON lt.tenant_id = e.tenant_id
WHERE NOT EXISTS (SELECT 1 FROM public.leave_balances b
  WHERE b.employee_id = e.id AND b.leave_type_id = lt.id AND b.year = EXTRACT(YEAR FROM CURRENT_DATE)::int);
