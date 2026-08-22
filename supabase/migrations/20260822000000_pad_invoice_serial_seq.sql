-- ─────────────────────────────────────────────────────────────────────────────
-- Zero-pad the sequence portion of the invoice serial to 5 digits
--
-- YYMMM_QQQQ_XXXXX was documented but never actually enforced: the sequence
-- was concatenated raw (…_SHOP_1, …_SHOP_2, … …_SHOP_10), not padded like the
-- spec's XXXXX implies (…_SHOP_00001). This pads it everywhere a serial string
-- is built, so newly issued and previewed numbers match the intended format.
-- Serials already issued keep their existing (unpadded) text — only future
-- generation changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_invoice_serial(
  p_branch_code text,
  p_issue_date  date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_yy     int  := (EXTRACT(YEAR FROM p_issue_date)::int) % 100;
  v_mmm    text;
  v_branch text := NULLIF(btrim(p_branch_code), '');
  v_seq    int;
  v_serial text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context for serial generation';
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch/QQQQ code is required for the invoice serial';
  END IF;
  IF length(v_branch) < 1 OR length(v_branch) > 15 THEN
    RAISE EXCEPTION 'Branch/QQQQ code must be 1-15 characters (got %)', length(v_branch);
  END IF;

  v_mmm := CASE EXTRACT(MONTH FROM p_issue_date)::int
             WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
             WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
             WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
             WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
           END;

  INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
  VALUES (v_tenant, v_branch, v_yy, v_mmm, 1)
  ON CONFLICT (tenant_id, branch_code, yy, mmm)
  DO UPDATE SET last_seq = public.invoice_serial_sequences.last_seq + 1,
                updated_at = now()
  RETURNING last_seq INTO v_seq;

  v_serial := lpad(v_yy::text, 2, '0') || v_mmm || '_' || v_branch || '_' || lpad(v_seq::text, 5, '0');

  IF length(v_serial) > 40 THEN
    RAISE EXCEPTION 'Generated serial exceeds 40 characters: %', v_serial;
  END IF;
  IF v_serial ~ '\s' THEN
    RAISE EXCEPTION 'Generated serial contains whitespace: %', v_serial;
  END IF;

  -- Account for the number the moment it is handed out.
  INSERT INTO public.invoice_serial_register (tenant_id, serial, branch_code, yy, mmm, seq, status)
  VALUES (v_tenant, v_serial, v_branch, v_yy, v_mmm, v_seq, 'reserved')
  ON CONFLICT (tenant_id, serial) DO NOTHING;

  RETURN v_serial;
END;
$$;

-- ── Preview of the next number per branch (used by useInvoiceNextNumbers) ──
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
         lpad(s.yy::text, 2, '0') || s.mmm || '_' || s.branch_code || '_' || lpad((s.last_seq + 1)::text, 5, '0')
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

-- ── set_invoice_next_number: pad the 'skipped' rows it writes to match ────
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

  -- A jump writes one row per number passed over, so the sequence stays fully
  -- accounted for. Capped: a fat-fingered 1,000,000 would otherwise try to
  -- write a million rows.
  IF p_next_seq - v_used > 10000 THEN
    RAISE EXCEPTION 'That skips % numbers at once. Set the next number closer to % instead.',
      p_next_seq - v_used - 1, v_used + 1;
  END IF;

  INSERT INTO public.invoice_serial_register
    (tenant_id, serial, branch_code, yy, mmm, seq, status, reason)
  SELECT v_tenant,
         lpad(v_yy::text, 2, '0') || v_mmm || '_' || v_branch || '_' || lpad(s::text, 5, '0'),
         v_branch, v_yy, v_mmm, s, 'skipped',
         'Skipped when the next invoice number was set to ' || p_next_seq
    FROM generate_series(v_used + 1, p_next_seq - 1) AS s
  ON CONFLICT (tenant_id, serial) DO NOTHING;

  INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
  VALUES (v_tenant, v_branch, v_yy, v_mmm, p_next_seq - 1)
  ON CONFLICT (tenant_id, branch_code, yy, mmm)
  DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now();

  RETURN p_next_seq;
END;
$$;
