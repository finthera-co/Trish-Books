-- #5 — final settlement (end of service) computation. Given an employee, returns
-- the settlement components: accrued gratuity (if eligible), leave encashment
-- (encashable leave balance × day rate), and any outstanding loan to recover. The
-- net is gratuity + encashment − loan balance. (Computation/visibility; posting the
-- settlement JE remains a manual GL action for now.)
CREATE OR REPLACE FUNCTION public.rpc_final_settlement(p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_emp RECORD;
  v_mpy numeric; v_elig int;
  v_years numeric; v_gratuity numeric := 0; v_eligible boolean;
  v_encash_days numeric := 0; v_day_rate numeric; v_encash numeric := 0;
  v_loan numeric := 0;
BEGIN
  SELECT id, first_name, last_name, salary, hire_date, termination_date
    INTO v_emp FROM public.employees WHERE id = p_employee_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  SELECT COALESCE(months_per_year,0.5), COALESCE(eligibility_years,5) INTO v_mpy, v_elig
    FROM public.gratuity_settings WHERE tenant_id = v_tenant;
  v_mpy := COALESCE(v_mpy,0.5); v_elig := COALESCE(v_elig,5);

  v_years := GREATEST(0, (COALESCE(v_emp.termination_date, CURRENT_DATE) - v_emp.hire_date)::numeric / 365.25);
  v_eligible := v_years >= v_elig;
  IF v_eligible THEN
    v_gratuity := ROUND(v_mpy * COALESCE(v_emp.salary,0) * v_years, 2);
  END IF;

  -- Encashable leave balance × daily rate (salary / 30).
  SELECT COALESCE(SUM(lb.available), 0) INTO v_encash_days
  FROM public.leave_balances lb
  JOIN public.leave_types lt ON lt.id = lb.leave_type_id
  WHERE lb.tenant_id = v_tenant AND lb.employee_id = p_employee_id
    AND lt.payroll_treatment = 'encashable';
  v_day_rate := COALESCE(v_emp.salary,0) / 30.0;
  v_encash := ROUND(GREATEST(0, v_encash_days) * v_day_rate, 2);

  SELECT COALESCE(SUM(balance), 0) INTO v_loan
  FROM public.employee_loans
  WHERE tenant_id = v_tenant AND employee_id = p_employee_id AND status = 'active';
  v_loan := ROUND(v_loan, 2);

  RETURN jsonb_build_object(
    'employee_id', v_emp.id,
    'employee_name', btrim(COALESCE(v_emp.first_name,'') || ' ' || COALESCE(v_emp.last_name,'')),
    'hire_date', v_emp.hire_date,
    'termination_date', v_emp.termination_date,
    'years_of_service', ROUND(v_years, 2),
    'monthly_salary', COALESCE(v_emp.salary,0),
    'gratuity_eligible', v_eligible,
    'gratuity_amount', v_gratuity,
    'encashable_leave_days', ROUND(GREATEST(0, v_encash_days), 2),
    'leave_encashment', v_encash,
    'outstanding_loan', v_loan,
    'net_settlement', ROUND(v_gratuity + v_encash - v_loan, 2)
  );
END; $$;
REVOKE ALL ON FUNCTION public.rpc_final_settlement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_final_settlement(uuid) TO authenticated;
