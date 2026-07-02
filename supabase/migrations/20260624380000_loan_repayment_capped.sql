-- #3 — recover exactly what was deducted. The run item's loan_deduction is now
-- capped at the employee's available net, so the repayment must reduce balances by
-- that captured amount (allocated across the employee's active loans in order),
-- not by the full installment. Prevents "loan shows repaid but no cash recovered".
CREATE OR REPLACE FUNCTION public.rpc_apply_loan_repayments(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  emp RECORD; loan RECORD; v_remaining numeric; v_amt numeric; v_new_bal numeric;
  v_applied numeric := 0; v_count int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = p_run_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Run not found';
  END IF;

  FOR emp IN
    SELECT pri.employee_id, COALESCE(pri.loan_deduction, 0) AS recovered
    FROM public.payroll_run_items pri
    WHERE pri.run_id = p_run_id AND COALESCE(pri.loan_deduction, 0) > 0
  LOOP
    v_remaining := emp.recovered;
    FOR loan IN
      SELECT * FROM public.employee_loans l
      WHERE l.tenant_id = v_tenant AND l.employee_id = emp.employee_id
        AND l.status = 'active' AND l.balance > 0
        AND NOT EXISTS (SELECT 1 FROM public.loan_repayments r WHERE r.loan_id = l.id AND r.payroll_run_id = p_run_id)
      ORDER BY l.created_at
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_amt := LEAST(loan.monthly_installment, loan.balance, v_remaining);
      v_new_bal := ROUND(loan.balance - v_amt, 2);
      INSERT INTO public.loan_repayments (tenant_id, loan_id, payroll_run_id, amount, balance_after)
        VALUES (v_tenant, loan.id, p_run_id, v_amt, v_new_bal);
      UPDATE public.employee_loans
        SET balance = v_new_bal, status = CASE WHEN v_new_bal <= 0 THEN 'settled' ELSE 'active' END
        WHERE id = loan.id;
      v_remaining := v_remaining - v_amt; v_applied := v_applied + v_amt; v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'applied', ROUND(v_applied, 2), 'loans', v_count);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_apply_loan_repayments(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_apply_loan_repayments(uuid) TO authenticated;
