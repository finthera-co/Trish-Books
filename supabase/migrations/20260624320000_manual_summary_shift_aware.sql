-- #8 — the manual attendance summary counted Mon–Fri working days, while the rest
-- of the system (count_working_days, biometric summary) is shift-aware (Mon–Sat
-- default). Align it: derive working days from the tenant's default-shift
-- working_days[], so both attendance paths use the same denominator.
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
  overtime_hours numeric,
  non_employed_days numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_dows int[];
BEGIN
  SELECT working_days INTO v_dows FROM public.work_shifts WHERE tenant_id = v_tenant AND is_default LIMIT 1;
  v_dows := COALESCE(v_dows, ARRAY[1,2,3,4,5,6]);  -- Mon–Sat default
  RETURN QUERY
  WITH work_days AS (
    SELECT d::date AS day
    FROM generate_series(p_period_start, p_period_end, interval '1 day') d
    WHERE EXTRACT(DOW FROM d)::int = ANY(v_dows)
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
    SELECT e.id, e.hire_date, e.termination_date
    FROM public.employees e
    WHERE e.tenant_id = v_tenant
      AND (p_employee_id IS NULL OR e.id = p_employee_id)
  ),
  emp_employed AS (
    SELECT e.id AS emp_id, COUNT(w.day)::numeric AS employed_days
    FROM emps e
    LEFT JOIN work_days w
      ON w.day >= COALESCE(e.hire_date, p_period_start)
     AND w.day <= COALESCE(e.termination_date, p_period_end)
    GROUP BY e.id
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
    (COALESCE(SUM(CASE
      WHEN r.status IN ('absent','unpaid_leave') THEN 1
      WHEN r.status = 'half_day' AND NOT r.leave_is_paid THEN 0.5
      ELSE 0 END), 0)
      + GREATEST(0, (SELECT n FROM wd_count) - COALESCE(MAX(ee.employed_days), (SELECT n FROM wd_count)))
    )::numeric AS unpaid_absent_days,
    ((SELECT n FROM wd_count) - COUNT(r.attendance_date) FILTER (
       WHERE r.status IN ('present','absent','half_day','paid_leave','unpaid_leave')
    ))::numeric AS unmarked_days,
    COALESCE(SUM(r.overtime_hours), 0)::numeric AS overtime_hours,
    GREATEST(0, (SELECT n FROM wd_count) - COALESCE(MAX(ee.employed_days), (SELECT n FROM wd_count)))::numeric AS non_employed_days
  FROM emps e
  LEFT JOIN recs r ON r.emp_id = e.id
  LEFT JOIN emp_employed ee ON ee.emp_id = e.id
  GROUP BY e.id;
END;
$$;
