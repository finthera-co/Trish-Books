-- Guarantee every tenant always has a fiscal period covering "today", so the
-- Chart of Accounts (and any period-gated balance/rollup view) never silently
-- zeroes out current-year activity.
--
-- Root cause this fixes: the COA shows balances *as of the selected period end*
-- and auto-selects a period. If a tenant's only period predates its current
-- transactions (or no period exists at all), every balance-sheet account reads
-- 0 and parent rollups sum to 0.
--
-- Convention: Sri Lankan fiscal year (1 April -> 31 March), matching existing
-- tenant data. "Today" is evaluated in Asia/Colombo.
--
-- Strategy mirrors ensure_obe_all_tenants:
--   1. a SECURITY DEFINER helper that idempotently ensures the current FY,
--   2. a backfill over every existing tenant,
--   3. an AFTER INSERT trigger on tenants for all future tenants,
--   4. a zero-arg RPC so the app can lazily ensure on load (handles year
--      rollover forever, for every tenant),
--   5. a duplicate-period guard.

-- ── 1a. SL fiscal-year bounds for a given date ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sl_fiscal_year_bounds(p_on date)
RETURNS TABLE (fy_start date, fy_end date, fy_name text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    make_date(y, 4, 1)                              AS fy_start,
    make_date(y + 1, 3, 31)                         AS fy_end,
    'FY ' || y::text || '-' || (y + 1)::text        AS fy_name
  FROM (
    SELECT CASE
             WHEN EXTRACT(MONTH FROM p_on) >= 4 THEN EXTRACT(YEAR FROM p_on)::int
             ELSE EXTRACT(YEAR FROM p_on)::int - 1
           END AS y
  ) s;
$$;

-- ── 1b. Idempotently ensure the current FY period for one tenant ────────────
CREATE OR REPLACE FUNCTION public.ensure_current_fiscal_period(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Colombo')::date;
  v_start  date;
  v_end    date;
  v_name   text;
  v_id     uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT fy_start, fy_end, fy_name
    INTO v_start, v_end, v_name
    FROM public.sl_fiscal_year_bounds(v_today);

  -- Already have a period covering today? Return it (any covering period, not
  -- just the canonical FY, so a tenant's custom periods are respected).
  SELECT id INTO v_id
    FROM public.fiscal_periods
   WHERE tenant_id = p_tenant_id
     AND v_today BETWEEN period_start AND period_end
   ORDER BY (period_end - period_start) ASC   -- prefer the tightest covering period
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.fiscal_periods (tenant_id, name, period_start, period_end, status)
  VALUES (p_tenant_id, v_name, v_start, v_end, 'open')
  ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.fiscal_periods
     WHERE tenant_id = p_tenant_id
       AND period_start = v_start AND period_end = v_end
     LIMIT 1;
  END IF;

  RETURN v_id;
END $$;

-- ── Duplicate-period guard (needed by the ON CONFLICT above) ────────────────
-- Blocks identical (tenant, start, end) rows — the literal duplicate scenario —
-- while still allowing distinct or nested custom periods.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_period_per_tenant_range
  ON public.fiscal_periods (tenant_id, period_start, period_end);

-- ── 2. Backfill: ensure the current FY for every existing tenant ────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.ensure_current_fiscal_period(r.id);
  END LOOP;
END $$;

-- ── 3. Auto-provision for NEW tenants at the DB level ───────────────────────
CREATE OR REPLACE FUNCTION public.create_current_fiscal_period_for_new_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_current_fiscal_period(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_fiscal_period_for_new_tenant ON public.tenants;
CREATE TRIGGER trg_create_fiscal_period_for_new_tenant
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_current_fiscal_period_for_new_tenant();

-- ── 4. Zero-arg RPC: lazily ensure the caller's current FY from the client ──
-- Resolves the tenant from the authenticated user (never trusts a client arg),
-- so the COA can call it on load and self-heal for every tenant, every year.
CREATE OR REPLACE FUNCTION public.ensure_current_fiscal_period()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant
    FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.ensure_current_fiscal_period(v_tenant);
END $$;

GRANT EXECUTE ON FUNCTION public.ensure_current_fiscal_period() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sl_fiscal_year_bounds(date) TO authenticated;
