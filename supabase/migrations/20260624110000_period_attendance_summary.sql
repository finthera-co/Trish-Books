-- Accurate per-period attendance reconciliation for payroll.
--
-- Problem this fixes: the biometric pay pull summed attendance_daily, which only
-- has rows for days an employee PUNCHED. An absent day has no row and the engine
-- never writes an 'absent' status, so absent_days was always 0 — a salaried
-- worker who attended 12 of 26 days still drew full basic. Separately, the
-- denominator used a Mon–Sat count that ignored public holidays.
--
-- This RPC derives, per employee that has biometric data in the period:
--   present_days / half_days / worked_hours / ot_hours  — from attendance_daily
--   expected_days  — count_working_days() (Sundays + holidays excluded; the same
--                    holiday-aware counter leave and the rest of payroll use)
--   leave_days     — approved/settled leave clipped to the period & working days
--   absent_days    — expected − present − half − leave, floored at 0
--
-- Absence EXCLUDES leave so it never double-charges: unpaid leave is prorated
-- separately in useCreatePayrollRun, and paid leave is paid. Only employees with
-- at least one attendance_daily row are returned — staff with no biometric data
-- are intentionally omitted so the caller never zeroes someone who simply isn't
-- on a device (or was absent the entire period, which is indistinguishable here).

CREATE OR REPLACE FUNCTION public.rpc_period_attendance_summary(
  p_period_start date,
  p_period_end   date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  employee_id   uuid,
  worked_hours  numeric,
  ot_hours      numeric,
  present_days  int,
  half_days     int,
  expected_days numeric,
  leave_days    numeric,
  absent_days   numeric
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
  )
  SELECT
    a.employee_id,
    a.worked_hours,
    a.ot_hours,
    a.present_days::int,
    a.half_days::int,
    v_expected,
    COALESCE(l.leave_days, 0),
    GREATEST(0, v_expected - a.present_days - a.half_days - COALESCE(l.leave_days, 0))
  FROM att a
  LEFT JOIN lv l ON l.employee_id = a.employee_id;
END; $$;

REVOKE ALL ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) TO authenticated;
