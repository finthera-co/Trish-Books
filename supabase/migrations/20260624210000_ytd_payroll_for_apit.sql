-- Gap 2 — year-to-date payroll for the cumulative APIT (PAYE) method.
-- Returns, per employee, the gross paid and PAYE deducted in COMMITTED runs earlier
-- in the same tax year (Sri Lanka tax year starts 1 April) than p_before. The
-- payroll engine feeds these into the cumulative tax calc so monthly withholding
-- self-corrects for variable pay / bonuses.
CREATE OR REPLACE FUNCTION public.rpc_ytd_payroll(
  p_before       date,
  p_employee_ids uuid[]
)
RETURNS TABLE (
  employee_id uuid,
  ytd_gross   numeric,
  ytd_paye    numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ty AS (
    SELECT CASE WHEN EXTRACT(MONTH FROM p_before) >= 4
                THEN make_date(EXTRACT(YEAR FROM p_before)::int,     4, 1)
                ELSE make_date(EXTRACT(YEAR FROM p_before)::int - 1, 4, 1)
           END AS start
  )
  SELECT pri.employee_id,
         COALESCE(SUM(pri.gross_pay), 0)     AS ytd_gross,
         COALESCE(SUM(pri.employee_paye), 0) AS ytd_paye
  FROM public.payroll_run_items pri
  JOIN public.payroll_runs pr ON pr.id = pri.run_id
  WHERE pr.tenant_id = public.get_user_tenant_id()
    AND pr.status IN ('processed', 'finalized')
    AND pr.period_end < p_before
    AND pr.period_start >= (SELECT start FROM ty)
    AND pri.employee_id = ANY(p_employee_ids)
  GROUP BY pri.employee_id;
$$;

REVOKE ALL ON FUNCTION public.rpc_ytd_payroll(date, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_ytd_payroll(date, uuid[]) TO authenticated;
