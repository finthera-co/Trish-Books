-- ════════════════════════════════════════════════════════════════════════════
-- Non-cash benefits (BIK) + salary advances / loans.
-- ════════════════════════════════════════════════════════════════════════════

-- BIK: a monthly taxable non-cash benefit (vehicle, housing, etc.). It is added to
-- the APIT (PAYE) base only — NOT to cash gross, net, or EPF — so it raises tax
-- without being paid in cash. Wired in the payroll engine (front-end).
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS bik_monthly_value numeric NOT NULL DEFAULT 0;

-- Persist the BIK applied to each run item so the cumulative APIT YTD includes it.
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS bik_value numeric NOT NULL DEFAULT 0;

-- YTD now includes BIK in the taxable gross (cumulative APIT base).
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
         COALESCE(SUM(pri.gross_pay + COALESCE(pri.bik_value,0)), 0) AS ytd_gross,
         COALESCE(SUM(pri.employee_paye), 0)                         AS ytd_paye
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

-- ── Salary advances / loans ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_loans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  description         text,
  principal           numeric NOT NULL CHECK (principal > 0),
  monthly_installment numeric NOT NULL CHECK (monthly_installment > 0),
  balance             numeric NOT NULL,                 -- remaining to repay
  start_date          date NOT NULL DEFAULT CURRENT_DATE,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled','cancelled')),
  created_by          uuid REFERENCES public.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_loans_emp ON public.employee_loans (tenant_id, employee_id, status);
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "employee_loans_rw" ON public.employee_loans FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP TRIGGER IF EXISTS trg_employee_loans_updated ON public.employee_loans;
CREATE TRIGGER trg_employee_loans_updated BEFORE UPDATE ON public.employee_loans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.loan_repayments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  loan_id         uuid NOT NULL REFERENCES public.employee_loans(id) ON DELETE CASCADE,
  payroll_run_id  uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  amount          numeric NOT NULL,
  balance_after   numeric NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, payroll_run_id)   -- idempotent per run
);
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "loan_repayments_rw" ON public.loan_repayments FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Apply this run's loan installments: record a repayment per active loan (capped at
-- balance), reduce the balance, settle when cleared. Idempotent per run.
CREATE OR REPLACE FUNCTION public.rpc_apply_loan_repayments(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  rec RECORD; v_amt numeric; v_new_bal numeric; v_applied numeric := 0; v_count int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = p_run_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Run not found';
  END IF;
  FOR rec IN
    SELECT l.* FROM public.employee_loans l
    JOIN public.payroll_run_items pri ON pri.employee_id = l.employee_id
    WHERE l.tenant_id = v_tenant AND l.status = 'active' AND l.balance > 0
      AND pri.run_id = p_run_id
      AND NOT EXISTS (SELECT 1 FROM public.loan_repayments r WHERE r.loan_id = l.id AND r.payroll_run_id = p_run_id)
  LOOP
    v_amt := LEAST(rec.monthly_installment, rec.balance);
    v_new_bal := ROUND(rec.balance - v_amt, 2);
    INSERT INTO public.loan_repayments (tenant_id, loan_id, payroll_run_id, amount, balance_after)
      VALUES (v_tenant, rec.id, p_run_id, v_amt, v_new_bal);
    UPDATE public.employee_loans
      SET balance = v_new_bal, status = CASE WHEN v_new_bal <= 0 THEN 'settled' ELSE 'active' END
      WHERE id = rec.id;
    v_applied := v_applied + v_amt; v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'applied', ROUND(v_applied,2), 'loans', v_count);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_apply_loan_repayments(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_apply_loan_repayments(uuid) TO authenticated;
