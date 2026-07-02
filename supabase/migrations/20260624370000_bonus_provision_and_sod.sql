-- Annual bonus provision (monthly accrual) + payroll segregation-of-duties setting.

-- ── Bonus provision ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bonus_settings (
  tenant_id     uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  bonus_months  numeric NOT NULL DEFAULT 1,   -- annual bonus = this many months' salary
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bonus_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bonus_settings_rw" ON public.bonus_settings FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bonus_provisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period           text NOT NULL,
  total_amount     numeric NOT NULL,
  employee_count   int NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by       uuid REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);
ALTER TABLE public.bonus_provisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bonus_provisions_rw" ON public.bonus_provisions FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Post the month's bonus accrual: Dr Bonus Expense / Cr Bonus Provision
-- = bonus_months/12 × salary per active employee.
CREATE OR REPLACE FUNCTION public.rpc_post_bonus_provision(p_period text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_user uuid; v_months numeric; v_total numeric; v_count int;
  v_exp uuid; v_liab uuid; v_je uuid;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_period !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Period must be YYYY-MM'; END IF;
  IF EXISTS (SELECT 1 FROM public.bonus_provisions WHERE tenant_id = v_tenant AND period = p_period) THEN
    RAISE EXCEPTION 'Bonus provision for % already posted', p_period;
  END IF;

  SELECT COALESCE(bonus_months, 1) INTO v_months FROM public.bonus_settings WHERE tenant_id = v_tenant;
  v_months := COALESCE(v_months, 1);

  SELECT COALESCE(SUM(v_months / 12.0 * COALESCE(salary,0)), 0), COUNT(*) INTO v_total, v_count
  FROM public.employees
  WHERE tenant_id = v_tenant AND COALESCE(status,'active') = 'active' AND COALESCE(salary,0) > 0;

  IF v_total <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'Nothing to accrue'); END IF;
  v_total := ROUND(v_total, 2);

  v_exp  := public.ensure_tax_account(v_tenant, '5610', 'Bonus Expense', 'Expense', 'Employee Costs', 'debit');
  v_liab := public.ensure_tax_account(v_tenant, '2370', 'Bonus Provision', 'Liability', 'Provisions', 'credit');

  INSERT INTO public.journal_entries (tenant_id, description, entry_date, reference, created_by, status, is_system_generated)
  VALUES (v_tenant, 'Bonus provision ' || p_period, (p_period || '-01')::date, 'BONUS-' || p_period, v_user, 'posted', true)
  RETURNING id INTO v_je;
  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_exp, v_total, 0), (v_je, v_liab, 0, v_total);

  INSERT INTO public.bonus_provisions (tenant_id, period, total_amount, employee_count, journal_entry_id, created_by)
  VALUES (v_tenant, p_period, v_total, v_count, v_je, v_user);

  RETURN jsonb_build_object('ok', true, 'total', v_total, 'employees', v_count, 'journal_entry_id', v_je);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_post_bonus_provision(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_post_bonus_provision(text) TO authenticated;

-- ── Segregation of duties ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_settings (
  tenant_id    uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enforce_sod  boolean NOT NULL DEFAULT false,  -- creator can't approve/process own run
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "payroll_settings_rw" ON public.payroll_settings FOR ALL TO authenticated
    USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
