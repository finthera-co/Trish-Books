-- #4 Gratuity / terminal-benefit APIT (configurable — verify against the current
-- IRD terminal-benefits table). Default relief high + rate 0 = no tax until set.
ALTER TABLE public.gratuity_settings
  ADD COLUMN IF NOT EXISTS terminal_tax_relief numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_tax_rate   numeric NOT NULL DEFAULT 0;  -- e.g. 0.06 for 6%

-- #5 Salary arrears / back-pay — a one-off EPF-able taxable earning on a run.
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS arrears numeric NOT NULL DEFAULT 0;

-- #7 Cash rounding — round cash-payee net to this denomination (0 = off).
ALTER TABLE public.payroll_settings
  ADD COLUMN IF NOT EXISTS cash_round_to numeric NOT NULL DEFAULT 0;

-- #6 Statutory maternity / paternity leave types (Sri Lanka): paid, with the
-- statutory entitlement. Seeded per tenant if absent — beyond entitlement the
-- generic paid/unpaid handling applies.
INSERT INTO public.leave_types (tenant_id, name, code, is_paid, annual_entitlement, payroll_treatment, requires_approval, is_active, max_consecutive_days)
SELECT t.id, v.name, v.code, true, v.days, 'paid', true, true, v.days
FROM public.tenants t
CROSS JOIN (VALUES ('Maternity Leave','MAT',84), ('Paternity Leave','PAT',3)) AS v(name, code, days)
WHERE NOT EXISTS (
  SELECT 1 FROM public.leave_types lt WHERE lt.tenant_id = t.id AND lt.code = v.code
);

-- #5 Suggested arrears from compensation history: (current basic − prior basic) ×
-- whole months elapsed since the current rate became effective. A starting point
-- for the admin; the run field stays editable.
CREATE OR REPLACE FUNCTION public.rpc_suggest_arrears(p_employee_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cur AS (
    SELECT basic_salary, effective_from
    FROM public.employee_compensation
    WHERE employee_id = p_employee_id AND tenant_id = public.get_user_tenant_id() AND is_current
    ORDER BY effective_from DESC LIMIT 1
  ),
  prev AS (
    SELECT basic_salary
    FROM public.employee_compensation
    WHERE employee_id = p_employee_id AND tenant_id = public.get_user_tenant_id()
      AND effective_from < (SELECT effective_from FROM cur)
    ORDER BY effective_from DESC LIMIT 1
  )
  SELECT GREATEST(0, ROUND(
    (COALESCE((SELECT basic_salary FROM cur),0) - COALESCE((SELECT basic_salary FROM prev),0))
    * GREATEST(0, (EXTRACT(YEAR FROM age(CURRENT_DATE, (SELECT effective_from FROM cur))) * 12
                 + EXTRACT(MONTH FROM age(CURRENT_DATE, (SELECT effective_from FROM cur)))))
  , 2));
$$;
REVOKE ALL ON FUNCTION public.rpc_suggest_arrears(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_suggest_arrears(uuid) TO authenticated;
