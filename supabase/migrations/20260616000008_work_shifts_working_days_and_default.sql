-- Phase D delta (anchored spec): per-shift working-day mask + a seeded default shift per tenant.

ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS working_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]; -- 0=Sun..6=Sat

-- A starter default shift per existing tenant (Mon–Sat, 9–5, 8h) where none is marked default.
INSERT INTO public.work_shifts (tenant_id, name, is_default)
SELECT t.id, 'Standard (Mon–Sat)', true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.work_shifts w WHERE w.tenant_id = t.id AND w.is_default
);
