
-- 1. Extend budget_items
ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS period text,
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'yearly'
    CHECK (period_type IN ('monthly','quarterly','yearly')),
  ADD COLUMN IF NOT EXISTS class_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.budget_items bi
SET tenant_id = b.tenant_id
FROM public.budgets b
WHERE bi.budget_id = b.id AND bi.tenant_id IS NULL;

ALTER TABLE public.budget_items ALTER COLUMN tenant_id SET NOT NULL;

UPDATE public.budget_items bi
SET period = to_char(b.period_start, 'YYYY')
FROM public.budgets b
WHERE bi.budget_id = b.id AND bi.period IS NULL;

-- Dedupe: collapse duplicates within (budget_id, account_id, period, dims).
-- Keep oldest row, sum allocated_amount into it, delete others.
WITH grouped AS (
  SELECT
    budget_id, account_id, period,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k_class,
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k_dept,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k_proj,
    MIN(id::text) AS keeper_id,
    SUM(allocated_amount) AS total_alloc
  FROM public.budget_items
  GROUP BY 1,2,3,4,5,6
  HAVING COUNT(*) > 1
)
UPDATE public.budget_items bi
SET allocated_amount = g.total_alloc
FROM grouped g
WHERE bi.id::text = g.keeper_id;

WITH grouped AS (
  SELECT
    budget_id, account_id, period,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k_class,
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k_dept,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k_proj,
    MIN(id::text) AS keeper_id
  FROM public.budget_items
  GROUP BY 1,2,3,4,5,6
)
DELETE FROM public.budget_items bi
USING grouped g
WHERE bi.budget_id = g.budget_id
  AND bi.account_id = g.account_id
  AND COALESCE(bi.period,'') = COALESCE(g.period,'')
  AND COALESCE(bi.class_id, '00000000-0000-0000-0000-000000000000'::uuid) = g.k_class
  AND COALESCE(bi.department_id, '00000000-0000-0000-0000-000000000000'::uuid) = g.k_dept
  AND COALESCE(bi.project_id, '00000000-0000-0000-0000-000000000000'::uuid) = g.k_proj
  AND bi.id::text <> g.keeper_id;

ALTER TABLE public.budget_items
  DROP CONSTRAINT IF EXISTS budget_items_allocated_nonneg_chk;
ALTER TABLE public.budget_items
  ADD CONSTRAINT budget_items_allocated_nonneg_chk CHECK (allocated_amount >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_items_dims
  ON public.budget_items (
    budget_id, account_id, period,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_budget_items_tenant_account_period
  ON public.budget_items (tenant_id, account_id, period);

CREATE OR REPLACE FUNCTION public.validate_budget_item_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_acct accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_acct FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget line: account % not found', NEW.account_id; END IF;
  IF v_acct.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Budget line: account does not belong to tenant'; END IF;
  IF v_acct.account_type NOT IN ('Revenue','Income','Expense','Cost of Goods Sold','Other Expense','Other Income') THEN
    RAISE EXCEPTION 'Budget line: account type "%" not budgetable (Revenue/Expense/COGS only)', v_acct.account_type;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_budget_item_account ON public.budget_items;
CREATE TRIGGER trg_validate_budget_item_account
BEFORE INSERT OR UPDATE OF account_id, tenant_id ON public.budget_items
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_item_account();

-- 2. budget_controls
CREATE TABLE IF NOT EXISTS public.budget_controls (
  tenant_id uuid PRIMARY KEY,
  enforcement_mode text NOT NULL DEFAULT 'warn'
    CHECK (enforcement_mode IN ('none','warn','block','approval')),
  tolerance_percentage numeric NOT NULL DEFAULT 0
    CHECK (tolerance_percentage >= 0 AND tolerance_percentage <= 100),
  apply_to_accounts text NOT NULL DEFAULT 'expense_only'
    CHECK (apply_to_accounts IN ('expense_only','revenue_only','both')),
  dimension_strict_mode boolean NOT NULL DEFAULT false,
  missing_budget_behavior text NOT NULL DEFAULT 'allow'
    CHECK (missing_budget_behavior IN ('allow','warn','block')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant can read own budget controls" ON public.budget_controls;
CREATE POLICY "Tenant can read own budget controls"
ON public.budget_controls FOR SELECT
USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Tenant admins manage budget controls" ON public.budget_controls;
CREATE POLICY "Tenant admins manage budget controls"
ON public.budget_controls FOR ALL
USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP TRIGGER IF EXISTS trg_budget_controls_updated_at ON public.budget_controls;
CREATE TRIGGER trg_budget_controls_updated_at
BEFORE UPDATE ON public.budget_controls
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. budget_consumptions cache
CREATE TABLE IF NOT EXISTS public.budget_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  period text NOT NULL,
  class_id uuid,
  department_id uuid,
  project_id uuid,
  consumed_amount numeric(18,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_consumptions_dims
  ON public.budget_consumptions (
    tenant_id, account_id, period,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_budget_consumptions_lookup
  ON public.budget_consumptions (tenant_id, account_id, period);

ALTER TABLE public.budget_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant reads own consumptions" ON public.budget_consumptions;
CREATE POLICY "Tenant reads own consumptions"
ON public.budget_consumptions FOR SELECT
USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Block direct writes to consumptions" ON public.budget_consumptions;
CREATE POLICY "Block direct writes to consumptions"
ON public.budget_consumptions FOR ALL
USING (false) WITH CHECK (false);

-- 4. Period derivation
CREATE OR REPLACE FUNCTION public.derive_period(p_date date, p_period_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(p_period_type)
    WHEN 'monthly'   THEN to_char(p_date, 'YYYY-MM')
    WHEN 'quarterly' THEN to_char(p_date, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM p_date)::text
    ELSE to_char(p_date, 'YYYY')
  END;
$$;

-- 5. Recalc consumption from journal_lines
CREATE OR REPLACE FUNCTION public.recalc_budget_consumption(
  p_tenant_id uuid, p_account_id uuid, p_period text, p_period_type text,
  p_class_id uuid, p_department_id uuid, p_project_id uuid
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_acct accounts%ROWTYPE;
  v_start date; v_end date; v_consumed numeric(18,2) := 0;
  v_year int; v_q int; v_mo int;
BEGIN
  SELECT * INTO v_acct FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF p_period_type = 'monthly' THEN
    v_year := split_part(p_period, '-', 1)::int;
    v_mo   := split_part(p_period, '-', 2)::int;
    v_start := make_date(v_year, v_mo, 1);
    v_end   := (v_start + interval '1 month - 1 day')::date;
  ELSIF p_period_type = 'quarterly' THEN
    v_year := split_part(p_period, '-', 1)::int;
    v_q    := substring(split_part(p_period, '-', 2) from 2)::int;
    v_start := make_date(v_year, (v_q - 1) * 3 + 1, 1);
    v_end   := (v_start + interval '3 months - 1 day')::date;
  ELSE
    v_year := p_period::int;
    v_start := make_date(v_year, 1, 1);
    v_end   := make_date(v_year, 12, 31);
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN v_acct.account_type IN ('Expense','Cost of Goods Sold','Other Expense')
        THEN jl.debit - jl.credit
      WHEN v_acct.account_type IN ('Revenue','Income','Other Income')
        THEN jl.credit - jl.debit
      ELSE 0
    END
  ), 0) INTO v_consumed
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND je.entry_date BETWEEN v_start AND v_end;

  INSERT INTO budget_consumptions (
    tenant_id, account_id, period, class_id, department_id, project_id,
    consumed_amount, updated_at
  ) VALUES (
    p_tenant_id, p_account_id, p_period, p_class_id, p_department_id, p_project_id,
    v_consumed, now()
  )
  ON CONFLICT (
    tenant_id, account_id, period,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  DO UPDATE SET consumed_amount = EXCLUDED.consumed_amount, updated_at = now();

  RETURN v_consumed;
END; $$;

-- 6. Validator
CREATE OR REPLACE FUNCTION public.validate_voucher_budget(
  p_tenant_id uuid, p_account_id uuid, p_amount numeric, p_date date,
  p_class_id uuid DEFAULT NULL, p_department_id uuid DEFAULT NULL, p_project_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ctrl budget_controls%ROWTYPE;
  v_acct accounts%ROWTYPE;
  v_line budget_items%ROWTYPE;
  v_period text;
  v_consumed numeric(18,2) := 0;
  v_new_total numeric(18,2);
  v_threshold numeric(18,2);
  v_pct numeric;
  v_apply boolean := true;
BEGIN
  SELECT * INTO v_ctrl FROM budget_controls WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    v_ctrl.enforcement_mode := 'warn';
    v_ctrl.tolerance_percentage := 0;
    v_ctrl.apply_to_accounts := 'expense_only';
    v_ctrl.dimension_strict_mode := false;
    v_ctrl.missing_budget_behavior := 'allow';
  END IF;

  IF v_ctrl.enforcement_mode = 'none' THEN
    RETURN jsonb_build_object('status','ok','reason','enforcement_disabled');
  END IF;

  SELECT * INTO v_acct FROM accounts WHERE id = p_account_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','ok','reason','account_not_in_tenant'); END IF;

  IF v_ctrl.apply_to_accounts = 'expense_only'
     AND v_acct.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense') THEN
    v_apply := false;
  ELSIF v_ctrl.apply_to_accounts = 'revenue_only'
     AND v_acct.account_type NOT IN ('Revenue','Income','Other Income') THEN
    v_apply := false;
  ELSIF v_ctrl.apply_to_accounts = 'both'
     AND v_acct.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense','Revenue','Income','Other Income') THEN
    v_apply := false;
  END IF;

  IF NOT v_apply THEN RETURN jsonb_build_object('status','ok','reason','account_out_of_scope'); END IF;

  SELECT bi.* INTO v_line
  FROM budget_items bi JOIN budgets b ON b.id = bi.budget_id
  WHERE bi.tenant_id = p_tenant_id AND bi.account_id = p_account_id
    AND b.status = 'active'
    AND bi.period = public.derive_period(p_date, bi.period_type)
    AND (bi.class_id IS NOT DISTINCT FROM p_class_id)
    AND (bi.department_id IS NOT DISTINCT FROM p_department_id)
    AND (bi.project_id IS NOT DISTINCT FROM p_project_id)
  LIMIT 1;

  IF NOT FOUND AND NOT v_ctrl.dimension_strict_mode THEN
    SELECT bi.* INTO v_line
    FROM budget_items bi JOIN budgets b ON b.id = bi.budget_id
    WHERE bi.tenant_id = p_tenant_id AND bi.account_id = p_account_id
      AND b.status = 'active'
      AND bi.period = public.derive_period(p_date, bi.period_type)
    ORDER BY bi.allocated_amount DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', CASE v_ctrl.missing_budget_behavior
                  WHEN 'block' THEN 'block' WHEN 'warn' THEN 'warn' ELSE 'ok' END,
      'reason','missing_budget'
    );
  END IF;

  v_period := v_line.period;

  SELECT consumed_amount INTO v_consumed
  FROM budget_consumptions
  WHERE tenant_id = p_tenant_id AND account_id = p_account_id AND period = v_period
    AND COALESCE(class_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_line.class_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_line.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_line.project_id,'00000000-0000-0000-0000-000000000000'::uuid);

  IF v_consumed IS NULL THEN
    v_consumed := public.recalc_budget_consumption(
      p_tenant_id, p_account_id, v_period, v_line.period_type,
      v_line.class_id, v_line.department_id, v_line.project_id);
  END IF;

  v_new_total := v_consumed + COALESCE(p_amount, 0);
  v_threshold := v_line.allocated_amount * (1 + v_ctrl.tolerance_percentage / 100.0);
  v_pct := CASE WHEN v_line.allocated_amount > 0
                THEN (v_new_total / v_line.allocated_amount) * 100.0 ELSE 0 END;

  IF v_new_total > v_threshold THEN
    RETURN jsonb_build_object(
      'status', CASE v_ctrl.enforcement_mode
                  WHEN 'block' THEN 'block'
                  WHEN 'approval' THEN 'approval_required'
                  ELSE 'warn' END,
      'reason','over_budget',
      'allocated', v_line.allocated_amount, 'consumed', v_consumed,
      'new_total', v_new_total, 'utilization_pct', round(v_pct, 2),
      'period', v_period
    );
  ELSIF v_new_total >= v_line.allocated_amount * COALESCE(v_line.warning_threshold, 0.8) THEN
    RETURN jsonb_build_object(
      'status','warn','reason','threshold_reached',
      'allocated', v_line.allocated_amount, 'consumed', v_consumed,
      'new_total', v_new_total, 'utilization_pct', round(v_pct, 2),
      'period', v_period
    );
  END IF;

  RETURN jsonb_build_object(
    'status','ok','reason','within_budget',
    'allocated', v_line.allocated_amount, 'consumed', v_consumed,
    'new_total', v_new_total, 'utilization_pct', round(v_pct, 2),
    'period', v_period
  );
END; $$;

-- 7. Trigger safety net on journal_lines
CREATE OR REPLACE FUNCTION public.enforce_budget_on_journal_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_je journal_entries%ROWTYPE;
  v_acct accounts%ROWTYPE;
  v_amount numeric(18,2);
  v_result jsonb;
  v_ctrl budget_controls%ROWTYPE;
BEGIN
  SELECT * INTO v_je FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF v_je.status <> 'posted' THEN RETURN NEW; END IF;

  SELECT * INTO v_acct FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_acct.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense','Revenue','Income','Other Income') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ctrl FROM budget_controls WHERE tenant_id = v_je.tenant_id;

  IF FOUND AND v_ctrl.enforcement_mode = 'block' THEN
    IF v_acct.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN
      v_amount := NEW.debit - NEW.credit;
    ELSE
      v_amount := NEW.credit - NEW.debit;
    END IF;

    IF v_amount > 0 THEN
      v_result := public.validate_voucher_budget(
        v_je.tenant_id, NEW.account_id, v_amount, v_je.entry_date, NULL, NULL, NULL);
      IF (v_result->>'status') = 'block' THEN
        RAISE EXCEPTION 'Budget block: account % over budget for period % (allocated %, would total %).',
          v_acct.account_name, v_result->>'period', v_result->>'allocated', v_result->>'new_total';
      END IF;
    END IF;
  END IF;

  -- Always refresh cache (monthly slice; quarterly/yearly derived on-demand by report)
  PERFORM public.recalc_budget_consumption(
    v_je.tenant_id, NEW.account_id,
    public.derive_period(v_je.entry_date,'monthly'),'monthly', NULL, NULL, NULL);

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_budget_on_journal_line ON public.journal_lines;
CREATE TRIGGER trg_enforce_budget_on_journal_line
AFTER INSERT ON public.journal_lines
FOR EACH ROW EXECUTE FUNCTION public.enforce_budget_on_journal_line();

-- 8. Reversal recalculation
CREATE OR REPLACE FUNCTION public.recalc_budget_on_je_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'voided' AND OLD.status <> 'voided' THEN
    FOR r IN
      SELECT DISTINCT jl.account_id, a.account_type
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = NEW.id
    LOOP
      IF r.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Revenue','Income','Other Income') THEN
        PERFORM public.recalc_budget_consumption(
          NEW.tenant_id, r.account_id,
          public.derive_period(NEW.entry_date,'monthly'),'monthly',NULL,NULL,NULL);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_recalc_budget_on_je_void ON public.journal_entries;
CREATE TRIGGER trg_recalc_budget_on_je_void
AFTER UPDATE OF status ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.recalc_budget_on_je_change();

-- 9. Active-budget lock
CREATE OR REPLACE FUNCTION public.lock_active_budget_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM budgets WHERE id = COALESCE(NEW.budget_id, OLD.budget_id);
  IF v_status = 'active' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Active budget is locked. Create a new version to make changes.';
  END IF;
  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'Closed budget cannot be modified.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_lock_active_budget_lines ON public.budget_items;
CREATE TRIGGER trg_lock_active_budget_lines
BEFORE UPDATE OR DELETE ON public.budget_items
FOR EACH ROW EXECUTE FUNCTION public.lock_active_budget_lines();

-- 10. Budget vs Actual report
CREATE OR REPLACE FUNCTION public.budget_vs_actual(
  p_tenant_id uuid,
  p_fiscal_year int DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_account_type text DEFAULT NULL
) RETURNS TABLE (
  budget_id uuid, budget_name text, account_id uuid, account_code text,
  account_name text, account_type text, period text, period_type text,
  department_id uuid, allocated numeric, actual numeric,
  variance numeric, variance_pct numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lines AS (
    SELECT bi.*, b.name AS budget_name, b.status AS budget_status,
           a.account_code, a.account_name, a.account_type
    FROM budget_items bi
    JOIN budgets b ON b.id = bi.budget_id
    JOIN accounts a ON a.id = bi.account_id
    WHERE bi.tenant_id = p_tenant_id
      AND b.status IN ('active','closed')
      AND (p_fiscal_year IS NULL OR EXTRACT(YEAR FROM b.period_start) = p_fiscal_year)
      AND (p_department_id IS NULL OR bi.department_id = p_department_id)
      AND (p_account_type IS NULL OR a.account_type = p_account_type)
  )
  SELECT
    l.budget_id, l.budget_name, l.account_id, l.account_code, l.account_name, l.account_type,
    l.period, l.period_type, l.department_id,
    l.allocated_amount AS allocated,
    COALESCE(bc.consumed_amount, public.recalc_budget_consumption(
      p_tenant_id, l.account_id, l.period, l.period_type,
      l.class_id, l.department_id, l.project_id
    )) AS actual,
    l.allocated_amount - COALESCE(bc.consumed_amount, 0) AS variance,
    CASE WHEN l.allocated_amount > 0
         THEN round((COALESCE(bc.consumed_amount, 0) / l.allocated_amount) * 100, 2)
         ELSE 0 END AS variance_pct
  FROM lines l
  LEFT JOIN budget_consumptions bc
    ON bc.tenant_id = p_tenant_id
   AND bc.account_id = l.account_id
   AND bc.period = l.period
   AND COALESCE(bc.class_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(l.class_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND COALESCE(bc.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(l.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND COALESCE(bc.project_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(l.project_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY l.account_code, l.period;
$$;
