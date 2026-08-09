-- ─────────────────────────────────────────────────────────────────────────────
-- Per-tenant feature flags
--
-- Some capabilities are switched on for one business rather than for a plan or
-- for everyone. subscription_plans.features_json is plan-wide, so it can't do
-- this: enabling a flag there would turn it on for every tenant on that plan.
--
-- Defaults to '{}', so every existing tenant and every future signup is OFF
-- until someone deliberately enables a flag.
--
-- First flag: legacy_invoice_numbering — lets a business migrating from another
-- system type invoice numbers by hand and move the auto-number counter, so they
-- can key in historical invoices under their original numbers and have the
-- sequence carry on afterwards. Everyone else keeps strictly system-generated
-- IRD serials, which is what makes the serial register a complete record.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenants.feature_flags IS
  'Per-tenant capability switches, e.g. {"legacy_invoice_numbering": true}. Empty = every flag off; that is the default for new tenants.';

-- ── Is a flag on for the calling user's tenant? ──────────────────────
-- SECURITY DEFINER so the check never depends on the caller being able to read
-- the tenants row, and so the gate is enforced in the database rather than only
-- being hidden in the UI.
CREATE OR REPLACE FUNCTION public.tenant_has_feature(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (t.feature_flags ->> p_key)::boolean
       FROM public.tenants t
      WHERE t.id = public.get_user_tenant_id()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.tenant_has_feature(text) FROM public;
GRANT EXECUTE ON FUNCTION public.tenant_has_feature(text) TO authenticated;

-- ── Gate the numbering counter on the flag ───────────────────────────
-- Re-declared in full (CREATE OR REPLACE cannot add a guard in place). Only the
-- feature check below is new; the rest matches 20260809000000.
CREATE OR REPLACE FUNCTION public.set_invoice_next_number(
  p_branch_code text,
  p_period      date,
  p_next_seq    int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid := public.get_user_tenant_id();
  v_branch   text := COALESCE(NULLIF(btrim(p_branch_code), ''), 'MAIN');
  v_yy       int  := (EXTRACT(YEAR FROM p_period)::int) % 100;
  v_mmm      text;
  v_used     int;
  v_current  int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;
  IF NOT public.tenant_has_feature('legacy_invoice_numbering') THEN
    RAISE EXCEPTION 'Invoice numbers are system-generated for this account and cannot be changed';
  END IF;
  IF public.get_user_role_name() NOT IN ('Company Admin', 'Primary Admin', 'Super Admin') THEN
    RAISE EXCEPTION 'Only an administrator can change invoice numbering';
  END IF;
  IF p_next_seq IS NULL OR p_next_seq < 1 THEN
    RAISE EXCEPTION 'The next number must be 1 or greater';
  END IF;
  IF length(v_branch) > 15 THEN
    RAISE EXCEPTION 'Branch/QQQQ code must be 1-15 characters (got %)', length(v_branch);
  END IF;

  v_mmm := CASE EXTRACT(MONTH FROM p_period)::int
             WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
             WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
             WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
             WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
           END;

  SELECT COALESCE(MAX(last_seq), 0) INTO v_current
    FROM public.invoice_serial_sequences
   WHERE tenant_id = v_tenant AND branch_code = v_branch AND yy = v_yy AND mmm = v_mmm;

  SELECT COALESCE(MAX(seq), 0) INTO v_used
    FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND branch_code = v_branch AND yy = v_yy AND mmm = v_mmm;

  v_used := GREATEST(v_used, v_current);

  IF p_next_seq <= v_used THEN
    RAISE EXCEPTION
      'Number % has already been used for branch % in % 20%. The next number must be % or higher.',
      p_next_seq, v_branch, v_mmm, lpad(v_yy::text, 2, '0'), v_used + 1;
  END IF;

  INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
  VALUES (v_tenant, v_branch, v_yy, v_mmm, p_next_seq - 1)
  ON CONFLICT (tenant_id, branch_code, yy, mmm)
  DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now();

  RETURN p_next_seq;
END;
$$;

REVOKE ALL ON FUNCTION public.set_invoice_next_number(text, date, int) FROM public;
GRANT EXECUTE ON FUNCTION public.set_invoice_next_number(text, date, int) TO authenticated;

-- ── Enable it for the one account that is migrating ──────────────────
-- Matched by email rather than a pasted UUID so this reads as what it is, and
-- is a no-op on any database where that account doesn't exist.
UPDATE public.tenants t
   SET feature_flags = t.feature_flags || '{"legacy_invoice_numbering": true}'::jsonb
 WHERE t.id IN (
   SELECT u.tenant_id FROM public.users u WHERE lower(u.email) = 'chawinlanka@gmail.com'
 );
