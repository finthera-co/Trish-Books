-- ─────────────────────────────────────────────────────────────────────────────
-- Set the next auto-generated invoice number
--
-- The migration case: a business arrives with 60 invoices already raised in
-- another system. They set the next number to 61, key the 60 historical
-- invoices in with their original numbers typed by hand, and the system carries
-- on from 61 without ever re-using a number.
--
-- next_invoice_serial() counts per tenant + branch + year + month (the IRD
-- YYMMM_QQQQ_XXXXX format restarts each month), so the counter is set for one
-- of those buckets. last_seq is "the last number handed out", hence
-- last_seq = next - 1.
--
-- The counter may only move FORWARD. Winding it back would hand out a number
-- that has already been issued: the (tenant_id, invoice_number) unique index
-- would eventually reject it, but only after the user had typed a whole
-- invoice, and a duplicate serial in a statutory sequence is exactly what the
-- register exists to prevent.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- The highest number this bucket has actually handed out: the counter itself,
  -- and any register row (a cancelled draft still consumed its number).
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

-- ── What the next number currently is, per branch, for a given period ────
-- Reads the counter rather than the register, so a bucket that has been set but
-- not yet used still reports correctly.
CREATE OR REPLACE FUNCTION public.invoice_next_numbers(p_period date)
RETURNS TABLE (branch_code text, yy int, mmm text, next_seq int, next_serial text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.branch_code,
         s.yy,
         s.mmm,
         s.last_seq + 1,
         lpad(s.yy::text, 2, '0') || s.mmm || '_' || s.branch_code || '_' || (s.last_seq + 1)::text
    FROM public.invoice_serial_sequences s
   WHERE s.tenant_id = public.get_user_tenant_id()
     AND s.yy  = (EXTRACT(YEAR FROM p_period)::int) % 100
     AND s.mmm = CASE EXTRACT(MONTH FROM p_period)::int
                   WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
                   WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
                   WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
                   WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
                 END
   ORDER BY s.branch_code;
$$;

REVOKE ALL ON FUNCTION public.invoice_next_numbers(date) FROM public;
GRANT EXECUTE ON FUNCTION public.invoice_next_numbers(date) TO authenticated;

COMMENT ON FUNCTION public.set_invoice_next_number(text, date, int) IS
  'Set the next auto-generated invoice sequence number for one branch/month. Forward-only: it refuses to re-use a number already handed out.';
