-- ============================================================
-- Leave-by-type at payroll time, part 1: payroll treatment + period summary RPC.
-- leave_types already has `code` and `is_paid`; this adds the richer 3-way
-- payroll_treatment (paid | unpaid | encashable), derived from is_paid.
-- ============================================================

ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS payroll_treatment text NOT NULL DEFAULT 'paid'
    CHECK (payroll_treatment IN ('paid','unpaid','encashable'));

-- Backfill treatment from the existing is_paid flag (authoritative source so far):
--   is_paid = false  -> 'unpaid' (reduces basic);  is_paid = true -> 'paid'.
UPDATE public.leave_types SET payroll_treatment = 'unpaid'
  WHERE is_paid = false AND payroll_treatment = 'paid';
-- Name-based refinements (idempotent).
UPDATE public.leave_types SET payroll_treatment = 'unpaid'
  WHERE payroll_treatment = 'paid' AND (name ILIKE '%no%pay%' OR name ILIKE '%unpaid%' OR code = 'NOPAY');
UPDATE public.leave_types SET payroll_treatment = 'encashable'
  WHERE name ILIKE '%encash%';

-- ============================================================
-- Per-employee leave in a pay period, grouped by leave type code.
-- days_taken = IN-PERIOD working days only (clips straddling requests to the
-- period and reuses count_working_days so Sundays + holidays are excluded and
-- half-days count as 0.5). This is the single source for both the grid display
-- and the no-pay proration.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_period_leave_summary(
  p_period_start date,
  p_period_end   date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  employee_id uuid,
  leave_code  text,
  leave_name  text,
  treatment   text,
  days_taken  numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lr.employee_id,
    lt.code,
    lt.name,
    lt.payroll_treatment,
    SUM(public.count_working_days(
      lt.tenant_id,
      GREATEST(lr.start_date, p_period_start),
      LEAST(lr.end_date, p_period_end),
      lr.is_half_day
    )) AS days_taken
  FROM public.leave_requests lr
  JOIN public.leave_types lt ON lt.id = lr.leave_type_id
  WHERE lr.status IN ('approved','settled')
    AND lr.start_date <= p_period_end
    AND lr.end_date   >= p_period_start
    AND (p_employee_ids IS NULL OR lr.employee_id = ANY(p_employee_ids))
    AND lt.tenant_id = public.get_user_tenant_id()
  GROUP BY lr.employee_id, lt.code, lt.name, lt.payroll_treatment
  HAVING SUM(public.count_working_days(
      lt.tenant_id,
      GREATEST(lr.start_date, p_period_start),
      LEAST(lr.end_date, p_period_end),
      lr.is_half_day)) > 0;
$$;

REVOKE ALL ON FUNCTION public.rpc_period_leave_summary(date, date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_period_leave_summary(date, date, uuid[]) TO authenticated;
