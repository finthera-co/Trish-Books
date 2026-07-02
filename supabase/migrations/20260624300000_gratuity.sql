-- ════════════════════════════════════════════════════════════════════════════
-- GRATUITY (Sri Lanka Payment of Gratuity Act) — provision + schedule.
-- Half a month's wage per completed year of service, payable on termination to
-- employees with 5+ years' service. We accrue a monthly PROVISION (Dr Gratuity
-- Expense / Cr Gratuity Provision) so the liability builds up over time, and show
-- a per-employee schedule of accrued liability + eligibility.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gratuity_settings (
  tenant_id         uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  months_per_year   numeric NOT NULL DEFAULT 0.5,   -- ½ month wage per year of service
  eligibility_years int     NOT NULL DEFAULT 5,     -- years of service before gratuity vests
  accrue_from_start boolean NOT NULL DEFAULT true,  -- provide from year 1 vs only once eligible
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gratuity_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "gratuity_settings_rw" ON public.gratuity_settings FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.gratuity_provisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period           text NOT NULL,                  -- YYYY-MM
  total_amount     numeric NOT NULL,
  employee_count   int NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by       uuid REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);
ALTER TABLE public.gratuity_provisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "gratuity_provisions_rw" ON public.gratuity_provisions FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-employee gratuity schedule (current accrued liability + eligibility).
CREATE OR REPLACE FUNCTION public.rpc_gratuity_schedule()
RETURNS TABLE (
  employee_id      uuid,
  employee_name    text,
  employee_number  text,
  hire_date        date,
  termination_date date,
  years_of_service numeric,
  monthly_salary   numeric,
  accrued_amount   numeric,
  eligible         boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT COALESCE(g.months_per_year, 0.5) AS mpy, COALESCE(g.eligibility_years, 5) AS elig
    FROM (SELECT public.get_user_tenant_id() AS tid) t
    LEFT JOIN public.gratuity_settings g ON g.tenant_id = t.tid
  )
  SELECT e.id,
         btrim(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')),
         e.employee_number,
         e.hire_date,
         e.termination_date,
         ROUND(GREATEST(0, (COALESCE(e.termination_date, CURRENT_DATE) - e.hire_date)::numeric / 365.25), 2),
         COALESCE(e.salary, 0),
         ROUND((SELECT mpy FROM s) * COALESCE(e.salary,0)
               * GREATEST(0, (COALESCE(e.termination_date, CURRENT_DATE) - e.hire_date)::numeric / 365.25), 2),
         GREATEST(0, (COALESCE(e.termination_date, CURRENT_DATE) - e.hire_date)::numeric / 365.25) >= (SELECT elig FROM s)
  FROM public.employees e
  WHERE e.tenant_id = public.get_user_tenant_id()
    AND COALESCE(e.status,'active') = 'active'
    AND e.hire_date IS NOT NULL
  ORDER BY e.first_name, e.last_name;
$$;
REVOKE ALL ON FUNCTION public.rpc_gratuity_schedule() FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_gratuity_schedule() TO authenticated;

-- Post a monthly gratuity provision: Dr Gratuity Expense / Cr Gratuity Provision
-- for the increment earned in the period (months_per_year/12 × salary per employee).
CREATE OR REPLACE FUNCTION public.rpc_post_gratuity_provision(p_period text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_user uuid;
  v_mpy numeric; v_elig int; v_from_start boolean;
  v_total numeric; v_count int;
  v_exp uuid; v_liab uuid; v_je uuid;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_period !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Period must be YYYY-MM'; END IF;

  IF EXISTS (SELECT 1 FROM public.gratuity_provisions WHERE tenant_id = v_tenant AND period = p_period) THEN
    RAISE EXCEPTION 'Gratuity provision for % already posted', p_period;
  END IF;

  SELECT COALESCE(months_per_year,0.5), COALESCE(eligibility_years,5), COALESCE(accrue_from_start,true)
    INTO v_mpy, v_elig, v_from_start
  FROM public.gratuity_settings WHERE tenant_id = v_tenant;
  v_mpy := COALESCE(v_mpy, 0.5); v_elig := COALESCE(v_elig, 5); v_from_start := COALESCE(v_from_start, true);

  SELECT COALESCE(SUM(v_mpy / 12.0 * COALESCE(e.salary,0)), 0), COUNT(*)
    INTO v_total, v_count
  FROM public.employees e
  WHERE e.tenant_id = v_tenant
    AND COALESCE(e.status,'active') = 'active'
    AND e.hire_date IS NOT NULL
    AND COALESCE(e.salary,0) > 0
    AND (v_from_start OR (COALESCE(e.termination_date, CURRENT_DATE) - e.hire_date)::numeric / 365.25 >= v_elig);

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No gratuity to accrue for this period');
  END IF;
  v_total := ROUND(v_total, 2);

  v_exp  := public.ensure_tax_account(v_tenant, '5600', 'Gratuity Expense', 'Expense', 'Employee Costs', 'debit');
  v_liab := public.ensure_tax_account(v_tenant, '2360', 'Gratuity Provision', 'Liability', 'Provisions', 'credit');

  INSERT INTO public.journal_entries (tenant_id, description, entry_date, reference, created_by, status, is_system_generated)
  VALUES (v_tenant, 'Gratuity provision ' || p_period, (p_period || '-01')::date, 'GRAT-' || p_period, v_user, 'posted', true)
  RETURNING id INTO v_je;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_exp,  v_total, 0),
    (v_je, v_liab, 0, v_total);

  INSERT INTO public.gratuity_provisions (tenant_id, period, total_amount, employee_count, journal_entry_id, created_by)
  VALUES (v_tenant, p_period, v_total, v_count, v_je, v_user);

  RETURN jsonb_build_object('ok', true, 'total', v_total, 'employees', v_count, 'journal_entry_id', v_je);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_post_gratuity_provision(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_post_gratuity_provision(text) TO authenticated;
