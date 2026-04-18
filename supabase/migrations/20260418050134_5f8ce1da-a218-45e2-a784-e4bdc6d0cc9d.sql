-- ============ 1. Rule Versions (immutable history) ============
CREATE TABLE IF NOT EXISTS public.payroll_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.payroll_rules(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  -- Frozen rule payload at this version
  name text NOT NULL,
  target_component_code text NOT NULL,
  formula_type text NOT NULL,
  formula_value numeric NOT NULL DEFAULT 0,
  base_component_code text,
  expression text,
  condition_json jsonb,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE(rule_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_prv_tenant ON public.payroll_rule_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prv_rule ON public.payroll_rule_versions(rule_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_prv_effective ON public.payroll_rule_versions(tenant_id, effective_from, effective_to);

ALTER TABLE public.payroll_rule_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read rule versions" ON public.payroll_rule_versions
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Only INSERT allowed (no UPDATE/DELETE) — created by trigger or admins
CREATE POLICY "Admins insert rule versions" ON public.payroll_rule_versions
  FOR INSERT WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role_name() IN ('Primary Admin','Company Admin','Super Admin')
  );

-- Block updates/deletes via trigger
CREATE OR REPLACE FUNCTION public.block_rule_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payroll_rule_versions is immutable: % not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_prv_update ON public.payroll_rule_versions;
CREATE TRIGGER trg_block_prv_update BEFORE UPDATE OR DELETE ON public.payroll_rule_versions
FOR EACH ROW EXECUTE FUNCTION public.block_rule_version_mutation();

-- Auto-version: snapshot rule on INSERT and on UPDATE of payroll_rules
CREATE OR REPLACE FUNCTION public.snapshot_payroll_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next int;
  v_user uuid;
BEGIN
  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next
  FROM public.payroll_rule_versions WHERE rule_id = NEW.id;

  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;

  INSERT INTO public.payroll_rule_versions (
    tenant_id, rule_id, version_no, name, target_component_code,
    formula_type, formula_value, base_component_code, expression,
    condition_json, priority, is_active, effective_from, effective_to,
    description, created_by
  ) VALUES (
    NEW.tenant_id, NEW.id, v_next, NEW.name, NEW.target_component_code,
    NEW.formula_type, NEW.formula_value, NEW.base_component_code, NEW.expression,
    NEW.condition_json, NEW.priority, NEW.is_active, NEW.effective_from, NEW.effective_to,
    NEW.description, v_user
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_payroll_rule ON public.payroll_rules;
CREATE TRIGGER trg_snapshot_payroll_rule
AFTER INSERT OR UPDATE ON public.payroll_rules
FOR EACH ROW EXECUTE FUNCTION public.snapshot_payroll_rule();

-- Backfill v1 for all existing rules
INSERT INTO public.payroll_rule_versions (
  tenant_id, rule_id, version_no, name, target_component_code,
  formula_type, formula_value, base_component_code, expression,
  condition_json, priority, is_active, effective_from, effective_to, description
)
SELECT tenant_id, id, 1, name, target_component_code,
  formula_type, formula_value, base_component_code, expression,
  condition_json, priority, is_active, effective_from, effective_to, description
FROM public.payroll_rules
WHERE NOT EXISTS (SELECT 1 FROM public.payroll_rule_versions v WHERE v.rule_id = payroll_rules.id);

-- ============ 2. Payroll Run extensions ============
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS rule_set_version_hash text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS is_adjustment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adjusts_run_id uuid REFERENCES public.payroll_runs(id);

-- Block edits to finalized/posted runs
CREATE OR REPLACE FUNCTION public.block_finalized_payroll_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('finalized','posted','processed')
     AND NEW.status NOT IN ('voided')  -- voiding still allowed for audit
     AND (
       NEW.total_gross IS DISTINCT FROM OLD.total_gross
       OR NEW.total_net IS DISTINCT FROM OLD.total_net
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
     ) THEN
    RAISE EXCEPTION 'Payroll run % is finalized and immutable. Create an adjustment run instead.', OLD.run_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finalized_run ON public.payroll_runs;
CREATE TRIGGER trg_block_finalized_run
BEFORE UPDATE ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.block_finalized_payroll_run();

-- ============ 3. Payroll Run Snapshots (rule-set + employee snapshot) ============
CREATE TABLE IF NOT EXISTS public.payroll_run_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_set_version_hash text NOT NULL,
  rule_set jsonb NOT NULL,                  -- frozen array of rule-version snapshots used
  employee_snapshots jsonb NOT NULL,        -- frozen employee attributes at execution
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id)
);

CREATE INDEX IF NOT EXISTS idx_prs_tenant ON public.payroll_run_snapshots(tenant_id);
ALTER TABLE public.payroll_run_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read run snapshots" ON public.payroll_run_snapshots
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Tenant insert run snapshots" ON public.payroll_run_snapshots
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Snapshots are immutable
CREATE OR REPLACE FUNCTION public.block_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payroll_run_snapshots is immutable: % not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_snapshot_mutation ON public.payroll_run_snapshots;
CREATE TRIGGER trg_block_snapshot_mutation BEFORE UPDATE OR DELETE ON public.payroll_run_snapshots
FOR EACH ROW EXECUTE FUNCTION public.block_snapshot_mutation();

-- ============ 4. Payroll Results (immutable ledger) ============
CREATE TABLE IF NOT EXISTS public.payroll_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  component_code text NOT NULL,           -- e.g. EPF_EMPLOYEE, GROSS_PAY, NET_PAY
  component_name text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  rule_id uuid REFERENCES public.payroll_rules(id),         -- nullable for inputs (BASIC, etc.)
  rule_version_id uuid REFERENCES public.payroll_rule_versions(id),
  calculation_trace jsonb,                -- {inputs, base_value, formula, condition_passed, evaluation_steps}
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_tenant ON public.payroll_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pr_run_emp ON public.payroll_results(run_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_pr_component ON public.payroll_results(run_id, component_code);

ALTER TABLE public.payroll_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read payroll results" ON public.payroll_results
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Tenant insert payroll results" ON public.payroll_results
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Append-only: block UPDATE and DELETE
CREATE OR REPLACE FUNCTION public.block_payroll_results_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payroll_results is an immutable ledger: % not allowed. Create an adjustment run instead.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_payroll_results_mutation ON public.payroll_results;
CREATE TRIGGER trg_block_payroll_results_mutation
BEFORE UPDATE OR DELETE ON public.payroll_results
FOR EACH ROW EXECUTE FUNCTION public.block_payroll_results_mutation();