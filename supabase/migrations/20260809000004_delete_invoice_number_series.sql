-- ─────────────────────────────────────────────────────────────────────────────
-- Delete a branch's invoice number series
--
-- A branch code typed once by mistake — or the MAIN fallback picked up when the
-- field was left blank — leaves a counter and a register group that will never
-- be used again, cluttering the number register for good. This removes one
-- branch + month series outright.
--
-- It refuses whenever a number in that series is attached to a real invoice.
-- The register is the evidence that every issued number is accounted for, so a
-- number that was actually used can never be quietly erased; only a series that
-- issued nothing can go.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_invoice_number_series(
  p_branch_code text,
  p_period      date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid := public.get_user_tenant_id();
  v_branch  text := COALESCE(NULLIF(btrim(p_branch_code), ''), 'MAIN');
  v_yy      int  := (EXTRACT(YEAR FROM p_period)::int) % 100;
  v_mmm     text;
  v_prefix  text;
  v_inv     text;
  v_deleted int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;
  IF NOT public.tenant_has_feature('legacy_invoice_numbering') THEN
    RAISE EXCEPTION 'Invoice numbering cannot be changed for this account';
  END IF;
  IF public.get_user_role_name() NOT IN ('Company Admin', 'Primary Admin', 'Super Admin') THEN
    RAISE EXCEPTION 'Only an administrator can change invoice numbering';
  END IF;

  v_mmm := CASE EXTRACT(MONTH FROM p_period)::int
             WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
             WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
             WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
             WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
           END;
  v_prefix := lpad(v_yy::text, 2, '0') || v_mmm || '_' || v_branch || '_';

  -- Any invoice on this series stops the deletion. Compared with left() rather
  -- than LIKE because the serial format is full of underscores, which LIKE
  -- would treat as wildcards.
  SELECT i.invoice_number INTO v_inv
    FROM public.invoices i
   WHERE i.tenant_id = v_tenant
     AND left(i.invoice_number, length(v_prefix)) = v_prefix
   LIMIT 1;

  IF v_inv IS NOT NULL THEN
    RAISE EXCEPTION
      'Invoice % still uses this series. Delete or renumber it first.', v_inv;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_serial_register r
     WHERE r.tenant_id = v_tenant AND r.branch_code = v_branch
       AND r.yy = v_yy AND r.mmm = v_mmm
       AND (r.status = 'issued' OR r.invoice_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This series has issued numbers and cannot be removed.';
  END IF;

  DELETE FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND branch_code = v_branch AND yy = v_yy AND mmm = v_mmm;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.invoice_serial_sequences
   WHERE tenant_id = v_tenant AND branch_code = v_branch AND yy = v_yy AND mmm = v_mmm;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_number_series(text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_invoice_number_series(text, date) TO authenticated;

COMMENT ON FUNCTION public.delete_invoice_number_series(text, date) IS
  'Remove one branch/month invoice number series (counter + register rows). Refuses if any invoice uses a number from it.';

-- The blank branch field fell back to MAIN and kept re-creating a MAIN series
-- for a business that only uses CHAW. Set their default so it stops recurring.
UPDATE public.company_profiles p
   SET default_branch_code = 'CHAW'
 WHERE p.default_branch_code IS NULL
   AND p.tenant_id IN (
     SELECT u.tenant_id FROM public.users u WHERE lower(u.email) = 'chawinlanka@gmail.com'
   );
