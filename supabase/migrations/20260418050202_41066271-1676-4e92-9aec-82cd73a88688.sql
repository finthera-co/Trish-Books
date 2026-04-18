CREATE OR REPLACE FUNCTION public.block_rule_version_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'payroll_rule_versions is immutable: % not allowed', TG_OP; END;
$$;

CREATE OR REPLACE FUNCTION public.block_finalized_payroll_run()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('finalized','posted','processed')
     AND NEW.status NOT IN ('voided')
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

CREATE OR REPLACE FUNCTION public.block_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'payroll_run_snapshots is immutable: % not allowed', TG_OP; END;
$$;

CREATE OR REPLACE FUNCTION public.block_payroll_results_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'payroll_results is an immutable ledger: % not allowed. Create an adjustment run instead.', TG_OP; END;
$$;