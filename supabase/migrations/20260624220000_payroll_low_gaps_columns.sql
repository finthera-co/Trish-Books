-- LOW gaps — supporting columns / seeds.

-- Gap 8: concurrency-safe payroll run numbers. Seed each tenant's 'payroll_run'
-- counter to its current run count so next_tenant_number() continues the sequence
-- (run_number has no unique constraint, but keep the display numbers contiguous).
INSERT INTO public.tenant_number_counters (tenant_id, counter_key, current_value)
SELECT tenant_id, 'payroll_run', COUNT(*)
FROM public.payroll_runs
GROUP BY tenant_id
ON CONFLICT (tenant_id, counter_key) DO NOTHING;

-- Gap 10: persist the engine's actual EPF base so the statutory return reports the
-- real figure (honouring any customised EPF_BASE rule) instead of recomputing it.
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS epf_base numeric;

-- Gap 6: optional undertime policy — when on, late + early-leave minutes reduce a
-- salaried employee's paid days. Default off → no change.
ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS deduct_undertime boolean NOT NULL DEFAULT false;
