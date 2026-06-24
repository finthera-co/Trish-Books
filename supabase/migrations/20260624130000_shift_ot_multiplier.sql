-- Phase 1 — configurable OT rate & standard hours.
-- OT pay was derived from a hardcoded 8h/day and 1.5× multiplier in the
-- front-end. Make both come from the shift so a 9h-day or 2× tenant is correct.

ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS ot_multiplier numeric NOT NULL DEFAULT 1.5;

-- Period summary now also reports, per employee, the standard hours/day and OT
-- multiplier of their shift (falling back to the tenant default shift, then 8h /
-- 1.5×). The payroll OT math reads these instead of constants.
-- Return shape gains two columns, so drop the prior signature first.
DROP FUNCTION IF EXISTS public.rpc_period_attendance_summary(date, date, uuid[]);

CREATE FUNCTION public.rpc_period_attendance_summary(
  p_period_start date,
  p_period_end   date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  employee_id      uuid,
  worked_hours     numeric,
  ot_hours         numeric,
  present_days     int,
  half_days        int,
  expected_days    numeric,
  leave_days       numeric,
  absent_days      numeric,
  std_hours_per_day numeric,
  ot_multiplier    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_expected numeric := public.count_working_days(v_tenant, p_period_start, p_period_end, false);
BEGIN
  RETURN QUERY
  WITH att AS (
    SELECT ad.employee_id,
           COALESCE(SUM(ad.worked_hours), 0) AS worked_hours,
           COALESCE(SUM(ad.ot_hours), 0)     AS ot_hours,
           COUNT(*) FILTER (WHERE ad.status = 'half_day')                 AS half_days,
           COUNT(*) FILTER (WHERE ad.status NOT IN ('half_day','absent')) AS present_days
    FROM public.attendance_daily ad
    WHERE ad.tenant_id = v_tenant
      AND ad.work_date BETWEEN p_period_start AND p_period_end
      AND (p_employee_ids IS NULL OR ad.employee_id = ANY(p_employee_ids))
    GROUP BY ad.employee_id
  ),
  lv AS (
    SELECT lr.employee_id,
           SUM(public.count_working_days(
             lt.tenant_id,
             GREATEST(lr.start_date, p_period_start),
             LEAST(lr.end_date, p_period_end),
             lr.is_half_day)) AS leave_days
    FROM public.leave_requests lr
    JOIN public.leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.status IN ('approved','settled')
      AND lr.start_date <= p_period_end
      AND lr.end_date   >= p_period_start
      AND lt.tenant_id = v_tenant
      AND (p_employee_ids IS NULL OR lr.employee_id = ANY(p_employee_ids))
    GROUP BY lr.employee_id
  ),
  def AS (
    SELECT standard_hours, ot_multiplier
    FROM public.work_shifts WHERE tenant_id = v_tenant AND is_default LIMIT 1
  )
  SELECT
    a.employee_id,
    a.worked_hours,
    a.ot_hours,
    a.present_days::int,
    a.half_days::int,
    v_expected,
    COALESCE(l.leave_days, 0),
    GREATEST(0, v_expected - a.present_days - a.half_days - COALESCE(l.leave_days, 0)),
    COALESCE(es.standard_hours, (SELECT standard_hours FROM def), 8),
    COALESCE(es.ot_multiplier, (SELECT ot_multiplier FROM def), 1.5)
  FROM att a
  LEFT JOIN lv l ON l.employee_id = a.employee_id
  LEFT JOIN public.employees e ON e.id = a.employee_id
  LEFT JOIN public.work_shifts es ON es.id = e.shift_id;
END; $$;

REVOKE ALL ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) TO authenticated;
