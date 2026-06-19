-- ============================================================
-- Guard: block a payroll run if PAYE-applicable employees are present but
-- no in-force APIT schedule (with brackets) resolves for the run's period.
-- Catches the silent-zero-PAYE failure at the DB level (fires for the
-- create-run path, draft-recalc, and any future writer).
--
-- Resolution mirrors the engine's loadApitSchedule exactly:
--   tenant-specific schedule in window WINS; else the global (tenant_id NULL)
--   schedule in window; and the CHOSEN schedule must have >= 1 bracket
--   (a chosen schedule with no brackets makes the engine return null → PAYE 0).
-- Period key = payroll_runs.period_end (matches the create path).
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_payroll_run_has_apit_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_run_date   date;
  v_run_number text;
  v_paye_emp   boolean;
  v_sched_id   uuid;
  v_has_sched  boolean;
BEGIN
  SELECT pr.tenant_id, pr.period_end, pr.run_number
    INTO v_tenant_id, v_run_date, v_run_number
  FROM public.payroll_runs pr
  WHERE pr.id = NEW.run_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW; -- run row not found (FK handles); nothing to guard
  END IF;

  -- Only enforce for PAYE-applicable employees.
  SELECT e.is_paye_applicable INTO v_paye_emp
  FROM public.employees e WHERE e.id = NEW.employee_id;
  IF NOT COALESCE(v_paye_emp, false) THEN
    RETURN NEW;
  END IF;

  -- Resolve the schedule the engine would choose: tenant-specific first.
  SELECT s.id INTO v_sched_id
  FROM public.apit_schedules s
  WHERE s.tenant_id = v_tenant_id
    AND s.effective_from <= v_run_date
    AND (s.effective_to IS NULL OR s.effective_to >= v_run_date)
  ORDER BY s.effective_from DESC
  LIMIT 1;

  IF v_sched_id IS NULL THEN
    -- Fall back to the global default (tenant_id NULL).
    SELECT s.id INTO v_sched_id
    FROM public.apit_schedules s
    WHERE s.tenant_id IS NULL
      AND s.effective_from <= v_run_date
      AND (s.effective_to IS NULL OR s.effective_to >= v_run_date)
    ORDER BY s.effective_from DESC
    LIMIT 1;
  END IF;

  -- The CHOSEN schedule must exist AND carry at least one bracket.
  v_has_sched := v_sched_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.apit_brackets b WHERE b.schedule_id = v_sched_id);

  IF NOT v_has_sched THEN
    RAISE EXCEPTION
      'Payroll run % includes PAYE-applicable employees but no in-force APIT schedule (with brackets) resolves for tenant % on %. Refusing to create the run — PAYE would silently compute as 0. Add an effective-dated APIT schedule before running payroll.',
      COALESCE(v_run_number, NEW.run_id::text), v_tenant_id, v_run_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll_apit_schedule ON public.payroll_run_items;
CREATE TRIGGER trg_guard_payroll_apit_schedule
  AFTER INSERT ON public.payroll_run_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payroll_run_has_apit_schedule();
