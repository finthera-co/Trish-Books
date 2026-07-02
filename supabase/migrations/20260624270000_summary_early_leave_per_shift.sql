-- #1 (undertime includes early-leave) + #2 (per-employee shift working_days).
--
-- count_working_days_dows: like count_working_days but takes an explicit working-day
-- set, so the period summary can use EACH employee's shift working_days[] for the
-- expected/employed/leave denominators (a multi-shift tenant with different patterns
-- now gets the right denominator per employee). Holidays excluded as before.

CREATE OR REPLACE FUNCTION public.count_working_days_dows(
  p_tenant_id uuid, p_start date, p_end date, p_dows int[], p_is_half_day boolean DEFAULT false
) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_count numeric := 0; d date; v_dows int[] := COALESCE(p_dows, ARRAY[1,2,3,4,5,6]);
BEGIN
  IF p_is_half_day AND p_start = p_end THEN
    IF EXTRACT(DOW FROM p_start)::int = ANY(v_dows)
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = p_tenant_id
         AND (h.holiday_date = p_start OR (h.is_recurring
           AND EXTRACT(MONTH FROM h.holiday_date)=EXTRACT(MONTH FROM p_start)
           AND EXTRACT(DAY FROM h.holiday_date)=EXTRACT(DAY FROM p_start))))
    THEN RETURN 0.5; ELSE RETURN 0; END IF;
  END IF;
  d := p_start;
  WHILE d <= p_end LOOP
    IF EXTRACT(DOW FROM d)::int = ANY(v_dows)
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = p_tenant_id
         AND (h.holiday_date = d OR (h.is_recurring
           AND EXTRACT(MONTH FROM h.holiday_date)=EXTRACT(MONTH FROM d)
           AND EXTRACT(DAY FROM h.holiday_date)=EXTRACT(DAY FROM d))))
    THEN v_count := v_count + 1; END IF;
    d := d + 1;
  END LOOP;
  RETURN v_count;
END; $$;

-- Same return shape as before (no signature change), so CREATE OR REPLACE is fine.
CREATE OR REPLACE FUNCTION public.rpc_period_attendance_summary(
  p_period_start date,
  p_period_end   date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  employee_id           uuid,
  worked_hours          numeric,
  ot_hours              numeric,
  holiday_ot_hours      numeric,
  present_days          int,
  half_days             int,
  expected_days         numeric,
  leave_days            numeric,
  absent_days           numeric,
  non_employed_days     numeric,
  review_days           int,
  undertime_minutes     numeric,
  std_hours_per_day     numeric,
  ot_multiplier         numeric,
  holiday_ot_multiplier numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  RETURN QUERY
  WITH def AS (
    SELECT standard_hours, ot_multiplier, holiday_ot_multiplier, working_days
    FROM public.work_shifts WHERE tenant_id = v_tenant AND is_default LIMIT 1
  ),
  bio AS (
    SELECT ad.employee_id, ad.work_date, ad.worked_hours, ad.ot_hours,
           ad.holiday_ot_hours, ad.status, ad.is_rest_day,
           ad.late_minutes, ad.early_leave_minutes, ad.notes
    FROM public.attendance_daily ad
    WHERE ad.tenant_id = v_tenant
      AND ad.work_date BETWEEN p_period_start AND p_period_end
      AND (p_employee_ids IS NULL OR ad.employee_id = ANY(p_employee_ids))
  ),
  emp_with_bio AS (SELECT DISTINCT employee_id FROM bio),
  emp_meta AS (
    SELECT eb.employee_id,
           COALESCE(es.standard_hours,        (SELECT standard_hours        FROM def), 8)   AS std_h,
           COALESCE(es.ot_multiplier,         (SELECT ot_multiplier         FROM def), 1.5) AS ot_mult,
           COALESCE(es.holiday_ot_multiplier, (SELECT holiday_ot_multiplier FROM def), 2.0) AS hol_mult,
           COALESCE(es.working_days,          (SELECT working_days          FROM def), ARRAY[1,2,3,4,5,6]) AS work_dows,
           e.hire_date, e.termination_date
    FROM emp_with_bio eb
    LEFT JOIN public.employees e ON e.id = eb.employee_id
    LEFT JOIN public.work_shifts es ON es.id = e.shift_id
  ),
  -- Per-employee expected + employed working days, on the employee's own shift pattern.
  exp AS (
    SELECT em.employee_id,
           public.count_working_days_dows(v_tenant, p_period_start, p_period_end, em.work_dows, false) AS expected_days,
           public.count_working_days_dows(v_tenant,
             GREATEST(p_period_start, COALESCE(em.hire_date, p_period_start)),
             LEAST(p_period_end, COALESCE(em.termination_date, p_period_end)),
             em.work_dows, false) AS employed_days
    FROM emp_meta em
  ),
  manual AS (
    SELECT ar.employee_id, ar.attendance_date AS work_date, ar.status,
           COALESCE(ar.overtime_hours, 0) AS ot_hours
    FROM public.attendance_records ar
    WHERE ar.tenant_id = v_tenant
      AND ar.entry_source = 'manual'
      AND ar.attendance_date BETWEEN p_period_start AND p_period_end
      AND ar.employee_id IN (SELECT employee_id FROM emp_with_bio)
      AND (p_employee_ids IS NULL OR ar.employee_id = ANY(p_employee_ids))
  ),
  days AS (
    SELECT employee_id, work_date FROM bio
    UNION
    SELECT employee_id, work_date FROM manual
  ),
  recon AS (
    SELECT d.employee_id, d.work_date,
      CASE WHEN m.work_date IS NOT NULL
        THEN (CASE m.status WHEN 'present' THEN em.std_h WHEN 'half_day' THEN em.std_h / 2 ELSE 0 END)
        ELSE COALESCE(b.worked_hours, 0) END AS worked_hours,
      CASE WHEN m.work_date IS NOT NULL THEN m.ot_hours ELSE COALESCE(b.ot_hours, 0) END AS ot_hours,
      CASE WHEN m.work_date IS NOT NULL THEN 0 ELSE COALESCE(b.holiday_ot_hours, 0) END AS holiday_ot_hours,
      CASE WHEN m.work_date IS NOT NULL THEN m.status ELSE b.status END AS status,
      CASE WHEN m.work_date IS NOT NULL THEN false ELSE COALESCE(b.is_rest_day, false) END AS is_rest_day
    FROM days d
    LEFT JOIN manual   m  ON m.employee_id = d.employee_id AND m.work_date = d.work_date
    LEFT JOIN bio      b  ON b.employee_id = d.employee_id AND b.work_date = d.work_date
    LEFT JOIN emp_meta em ON em.employee_id = d.employee_id
  ),
  agg AS (
    SELECT employee_id,
           SUM(worked_hours)     AS worked_hours,
           SUM(ot_hours)         AS ot_hours,
           SUM(holiday_ot_hours) AS holiday_ot_hours,
           COUNT(*) FILTER (WHERE status = 'present' AND NOT is_rest_day) AS present_days,
           COUNT(*) FILTER (WHERE status = 'half_day')                    AS half_days
    FROM recon
    GROUP BY employee_id
  ),
  -- Reviews + undertime (late + early-leave) from biometric days not manually corrected.
  extra AS (
    SELECT b.employee_id,
           COUNT(*) FILTER (WHERE m.work_date IS NULL AND b.status IN ('present','half_day')
                              AND COALESCE(b.notes,'') ILIKE 'Single punch%')::int AS review_days,
           COALESCE(SUM(CASE WHEN m.work_date IS NULL AND b.status IN ('present','half_day')
                              AND NOT b.is_rest_day THEN COALESCE(b.late_minutes,0) + COALESCE(b.early_leave_minutes,0)
                         ELSE 0 END), 0) AS undertime_minutes
    FROM bio b
    LEFT JOIN manual m ON m.employee_id = b.employee_id AND m.work_date = b.work_date
    GROUP BY b.employee_id
  ),
  lv AS (
    SELECT lr.employee_id,
           SUM(public.count_working_days_dows(
             v_tenant,
             GREATEST(lr.start_date, p_period_start),
             LEAST(lr.end_date, p_period_end),
             COALESCE(em.work_dows, ARRAY[1,2,3,4,5,6]),
             lr.is_half_day)) AS leave_days
    FROM public.leave_requests lr
    JOIN public.leave_types lt ON lt.id = lr.leave_type_id
    LEFT JOIN emp_meta em ON em.employee_id = lr.employee_id
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
    a.holiday_ot_hours,
    a.present_days::int,
    a.half_days::int,
    ex.expected_days,
    COALESCE(l.leave_days, 0),
    GREATEST(0, ex.employed_days - a.present_days - a.half_days - COALESCE(l.leave_days, 0)),
    GREATEST(0, ex.expected_days - ex.employed_days),
    COALESCE(x.review_days, 0),
    COALESCE(x.undertime_minutes, 0),
    em.std_h,
    em.ot_mult,
    em.hol_mult
  FROM agg a
  LEFT JOIN lv l        ON l.employee_id  = a.employee_id
  LEFT JOIN emp_meta em ON em.employee_id = a.employee_id
  LEFT JOIN exp ex      ON ex.employee_id = a.employee_id
  LEFT JOIN extra x     ON x.employee_id  = a.employee_id;
END; $$;

REVOKE ALL ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) TO authenticated;
