-- Gaps 5 & 6 — surface single-punch "needs review" days, and total undertime
-- (late) minutes, in the period summary so payroll can warn / deduct.
--   • review_days       : biometric days flagged "Single punch — needs review"
--                         that haven't been manually corrected.
--   • undertime_minutes : late minutes on present/half worked days (used by the
--                         optional shift.deduct_undertime policy).
-- (Gap 7 needs no change here — count_working_days is now shift-aware.)

DROP FUNCTION IF EXISTS public.rpc_period_attendance_summary(date, date, uuid[]);

CREATE FUNCTION public.rpc_period_attendance_summary(
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
  v_expected numeric := public.count_working_days(v_tenant, p_period_start, p_period_end, false);
BEGIN
  RETURN QUERY
  WITH def AS (
    SELECT standard_hours, ot_multiplier, holiday_ot_multiplier
    FROM public.work_shifts WHERE tenant_id = v_tenant AND is_default LIMIT 1
  ),
  bio AS (
    SELECT ad.employee_id, ad.work_date, ad.worked_hours, ad.ot_hours,
           ad.holiday_ot_hours, ad.status, ad.is_rest_day, ad.late_minutes, ad.notes
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
           e.hire_date, e.termination_date
    FROM emp_with_bio eb
    LEFT JOIN public.employees e ON e.id = eb.employee_id
    LEFT JOIN public.work_shifts es ON es.id = e.shift_id
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
  -- Single-punch reviews + undertime, from biometric days not manually corrected.
  extra AS (
    SELECT b.employee_id,
           COUNT(*) FILTER (WHERE m.work_date IS NULL AND b.status IN ('present','half_day')
                              AND COALESCE(b.notes,'') ILIKE 'Single punch%')::int AS review_days,
           COALESCE(SUM(CASE WHEN m.work_date IS NULL AND b.status IN ('present','half_day')
                              AND NOT b.is_rest_day THEN b.late_minutes ELSE 0 END), 0) AS undertime_minutes
    FROM bio b
    LEFT JOIN manual m ON m.employee_id = b.employee_id AND m.work_date = b.work_date
    GROUP BY b.employee_id
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
  empd AS (
    SELECT em.employee_id,
           public.count_working_days(
             v_tenant,
             GREATEST(p_period_start, COALESCE(em.hire_date, p_period_start)),
             LEAST(p_period_end, COALESCE(em.termination_date, p_period_end)),
             false) AS employed_days
    FROM emp_meta em
  )
  SELECT
    a.employee_id,
    a.worked_hours,
    a.ot_hours,
    a.holiday_ot_hours,
    a.present_days::int,
    a.half_days::int,
    v_expected,
    COALESCE(l.leave_days, 0),
    GREATEST(0, COALESCE(ed.employed_days, v_expected) - a.present_days - a.half_days - COALESCE(l.leave_days, 0)),
    GREATEST(0, v_expected - COALESCE(ed.employed_days, v_expected)),
    COALESCE(x.review_days, 0),
    COALESCE(x.undertime_minutes, 0),
    em.std_h,
    em.ot_mult,
    em.hol_mult
  FROM agg a
  LEFT JOIN lv l        ON l.employee_id  = a.employee_id
  LEFT JOIN emp_meta em ON em.employee_id = a.employee_id
  LEFT JOIN empd ed     ON ed.employee_id = a.employee_id
  LEFT JOIN extra x     ON x.employee_id  = a.employee_id;
END; $$;

REVOKE ALL ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_period_attendance_summary(date, date, uuid[]) TO authenticated;
