-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 6: APIT (PAYE) bracket schedules.
-- tenant_id NULL = system default schedule (readable by all tenants,
-- writable only by super admins). Tenants may override with their own.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.apit_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,  -- NULL = system default
  effective_from date NOT NULL,
  effective_to date,
  annual_relief numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS public.apit_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.apit_schedules(id) ON DELETE CASCADE,
  bracket_order int NOT NULL,
  annual_amount_up_to numeric(18,2),   -- NULL = top bracket
  rate numeric(7,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, bracket_order)
);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.apit_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apit_brackets ENABLE ROW LEVEL SECURITY;

-- System schedules (tenant_id NULL) readable by everyone; tenant
-- schedules tenant-scoped.
DROP POLICY IF EXISTS "apit_sched_select" ON public.apit_schedules;
CREATE POLICY "apit_sched_select" ON public.apit_schedules FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "apit_sched_tenant_all" ON public.apit_schedules;
CREATE POLICY "apit_sched_tenant_all" ON public.apit_schedules FOR ALL
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "apit_sched_super_all" ON public.apit_schedules;
CREATE POLICY "apit_sched_super_all" ON public.apit_schedules FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "apit_br_select" ON public.apit_brackets;
CREATE POLICY "apit_br_select" ON public.apit_brackets FOR SELECT
  USING (
    schedule_id IN (
      SELECT id FROM public.apit_schedules
      WHERE tenant_id IS NULL OR tenant_id = public.get_user_tenant_id()
    ) OR public.is_super_admin()
  );
DROP POLICY IF EXISTS "apit_br_tenant_all" ON public.apit_brackets;
CREATE POLICY "apit_br_tenant_all" ON public.apit_brackets FOR ALL
  USING (
    schedule_id IN (
      SELECT id FROM public.apit_schedules
      WHERE tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id()
    )
  )
  WITH CHECK (
    schedule_id IN (
      SELECT id FROM public.apit_schedules
      WHERE tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id()
    )
  );
DROP POLICY IF EXISTS "apit_br_super_all" ON public.apit_brackets;
CREATE POLICY "apit_br_super_all" ON public.apit_brackets FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ── System default schedule: APIT 2025/26 (INDICATIVE — verify against
--    current IRD gazettes before filing). Relief Rs 1,800,000/yr;
--    6% / 18% / 24% / 30% on successive Rs 500k–1M slices, 36% balance.
DO $$
DECLARE
  v_sched uuid;
BEGIN
  SELECT id INTO v_sched FROM public.apit_schedules
  WHERE tenant_id IS NULL AND effective_from = DATE '2025-04-01';
  IF v_sched IS NULL THEN
    INSERT INTO public.apit_schedules (tenant_id, effective_from, effective_to, annual_relief)
    VALUES (NULL, DATE '2025-04-01', NULL, 1800000)
    RETURNING id INTO v_sched;
    INSERT INTO public.apit_brackets (schedule_id, bracket_order, annual_amount_up_to, rate) VALUES
      (v_sched, 1, 1000000, 6),
      (v_sched, 2, 1500000, 18),
      (v_sched, 3, 2000000, 24),
      (v_sched, 4, 2500000, 30),
      (v_sched, 5, NULL, 36)
    ON CONFLICT (schedule_id, bracket_order) DO NOTHING;
  END IF;
END $$;
