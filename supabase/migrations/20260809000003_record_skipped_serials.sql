-- ─────────────────────────────────────────────────────────────────────────────
-- Account for numbers skipped when the counter is set forward
--
-- The register's whole premise is that every number in the sequence has a row
-- explaining it, so a gap means something went wrong and needs investigating.
-- set_invoice_next_number broke that: jumping the counter from 2 to 64 left
-- 3-63 with no rows at all, and the register correctly — but uselessly —
-- reported "61 numbers are missing".
--
-- A deliberately skipped number is not a mystery, so it gets a row saying so.
-- New status 'skipped': never handed out, and never will be, because the
-- counter was moved past it (the numbers belong to invoices raised before the
-- move to this system).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoice_serial_register
  DROP CONSTRAINT IF EXISTS invoice_serial_register_status_check;
ALTER TABLE public.invoice_serial_register
  ADD CONSTRAINT invoice_serial_register_status_check
  CHECK (status IN ('reserved', 'issued', 'cancelled', 'skipped'));

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
         lpad(v_yy::text, 2, '0') || v_mmm || '_' || v_branch || '_' || s::text,
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

REVOKE ALL ON FUNCTION public.set_invoice_next_number(text, date, int) FROM public;
GRANT EXECUTE ON FUNCTION public.set_invoice_next_number(text, date, int) TO authenticated;

-- ── Backfill the gaps the earlier version of the function left behind ────
-- Only numbers below a counter that has already moved past them, that have no
-- register row AND no invoice using that serial. A number belonging to a real
-- invoice is never relabelled, so a genuine unexplained gap still shows up.
INSERT INTO public.invoice_serial_register
  (tenant_id, serial, branch_code, yy, mmm, seq, status, reason)
SELECT s.tenant_id,
       lpad(s.yy::text, 2, '0') || s.mmm || '_' || s.branch_code || '_' || g::text,
       s.branch_code, s.yy, s.mmm, g, 'skipped',
       'Skipped when the next invoice number was set forward'
  FROM public.invoice_serial_sequences s
  CROSS JOIN LATERAL generate_series(1, s.last_seq) AS g
 WHERE s.last_seq BETWEEN 1 AND 10000
   AND NOT EXISTS (
     SELECT 1 FROM public.invoice_serial_register r
      WHERE r.tenant_id = s.tenant_id AND r.branch_code = s.branch_code
        AND r.yy = s.yy AND r.mmm = s.mmm AND r.seq = g
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.invoices i
      WHERE i.tenant_id = s.tenant_id
        AND i.invoice_number =
            lpad(s.yy::text, 2, '0') || s.mmm || '_' || s.branch_code || '_' || g::text
   )
ON CONFLICT (tenant_id, serial) DO NOTHING;
