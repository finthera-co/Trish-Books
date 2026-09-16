-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice numbers run on instead of restarting every month
--
-- The counter was keyed on (tenant, branch, yy, mmm), so the 1st of October
-- handed out …_00001 again however far September had got. The sequence now
-- belongs to the branch alone and never resets:
--   26SEP_CHAW_00079  →  26OCT_CHAW_00080
--
-- The printed format is untouched. YYMMM still stamps the month the invoice was
-- issued in, it just no longer gates the counter. Numbers already issued keep
-- their exact text — they are the statutory record — and the collapsed counter
-- is seeded past the highest number any month of that branch ever reached, so
-- nothing already handed out can come round a second time.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Collapse the counter to one row per branch ────────────────────────────
-- The seed reads the counters and the register together: a number the register
-- has recorded is spent, whichever month's bucket it happened to sit in.
CREATE TEMP TABLE _branch_seed AS
SELECT tenant_id, branch_code, MAX(seq) AS seed
  FROM (
    SELECT tenant_id, branch_code, last_seq AS seq FROM public.invoice_serial_sequences
    UNION ALL
    SELECT tenant_id, branch_code, seq           FROM public.invoice_serial_register
  ) x
 GROUP BY tenant_id, branch_code;

-- yy/mmm stop being part of the key. They stay on the row as a note of the
-- month that branch last issued in, which is all they now mean.
CREATE TEMP TABLE _branch_last AS
SELECT DISTINCT ON (tenant_id, branch_code) tenant_id, branch_code, yy, mmm
  FROM (
    SELECT tenant_id, branch_code, yy, mmm, updated_at AS at FROM public.invoice_serial_sequences
    UNION ALL
    SELECT tenant_id, branch_code, yy, mmm, created_at      FROM public.invoice_serial_register
  ) x
 ORDER BY tenant_id, branch_code, at DESC;

DELETE FROM public.invoice_serial_sequences;

ALTER TABLE public.invoice_serial_sequences
  DROP CONSTRAINT IF EXISTS invoice_serial_sequences_tenant_id_branch_code_yy_mmm_key;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_serial_sequences_tenant_branch_key
  ON public.invoice_serial_sequences (tenant_id, branch_code);

INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
SELECT s.tenant_id, s.branch_code, l.yy, l.mmm, s.seed
  FROM _branch_seed s
  JOIN _branch_last l USING (tenant_id, branch_code);

DROP TABLE _branch_seed;
DROP TABLE _branch_last;

COMMENT ON TABLE public.invoice_serial_sequences IS
  'Per-tenant, per-branch invoice serial counter. Continuous: it does not reset at a month or year boundary. yy/mmm record the month the branch last issued in and are not part of the key.';

-- ── 2. The generator: same serial text, branch-wide counter ──────────────────
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

  -- One counter row per branch: the month of issue is written onto it rather
  -- than keying it, so crossing into a new month just carries on counting.
  INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
  VALUES (v_tenant, v_branch, v_yy, v_mmm, 1)
  ON CONFLICT (tenant_id, branch_code)
  DO UPDATE SET last_seq   = public.invoice_serial_sequences.last_seq + 1,
                yy         = EXCLUDED.yy,
                mmm        = EXCLUDED.mmm,
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

COMMENT ON FUNCTION public.next_invoice_serial(text, date) IS
  'Next YYMMM_QQQQ_XXXXX serial for a branch. The counter is continuous per branch; the issue date only supplies the YYMMM stamp.';

-- ── 3. Preview of the next number per branch ─────────────────────────────────
-- p_period no longer selects a counter — there is one per branch — it only says
-- which month's prefix an invoice dated then would carry.
CREATE OR REPLACE FUNCTION public.invoice_next_numbers(p_period date)
RETURNS TABLE (branch_code text, yy int, mmm text, next_seq int, next_serial text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.branch_code,
         (EXTRACT(YEAR FROM p_period)::int) % 100,
         CASE EXTRACT(MONTH FROM p_period)::int
           WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
           WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
           WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
           WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
         END,
         s.last_seq + 1,
         lpad(((EXTRACT(YEAR FROM p_period)::int) % 100)::text, 2, '0')
           || CASE EXTRACT(MONTH FROM p_period)::int
                WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
                WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
                WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
                WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
              END
           || '_' || s.branch_code || '_' || lpad((s.last_seq + 1)::text, 5, '0')
    FROM public.invoice_serial_sequences s
   WHERE s.tenant_id = public.get_user_tenant_id()
   ORDER BY s.branch_code;
$$;

-- ── 4. Setting the counter forward ───────────────────────────────────────────
-- "Already used" is now judged across the branch's whole history rather than
-- one month of it. p_period survives only to stamp the skipped rows.
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
   WHERE tenant_id = v_tenant AND branch_code = v_branch;

  SELECT COALESCE(MAX(seq), 0) INTO v_used
    FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND branch_code = v_branch;

  v_used := GREATEST(v_used, v_current);

  IF p_next_seq <= v_used THEN
    RAISE EXCEPTION
      'Number % has already been used for branch %. The next number must be % or higher.',
      p_next_seq, v_branch, v_used + 1;
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
  ON CONFLICT (tenant_id, branch_code)
  DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now();

  RETURN p_next_seq;
END;
$$;

COMMENT ON FUNCTION public.set_invoice_next_number(text, date, int) IS
  'Move a branch''s continuous invoice counter forward, writing a skipped row for every number passed over. Refuses to move it back. p_period only stamps the month on those skipped rows.';

-- ── 5. Handing one number back ───────────────────────────────────────────────
-- The counter follows the highest number left anywhere in the branch, not the
-- highest left in the deleted row's month.
CREATE OR REPLACE FUNCTION public.delete_invoice_number_row(p_serial text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_row    public.invoice_serial_register%ROWTYPE;
  v_top    int;
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

  SELECT * INTO v_row
    FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND serial = p_serial;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Number % is not in the register', p_serial;
  END IF;
  IF v_row.status = 'issued' OR v_row.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Number % was issued and cannot be removed from the register', p_serial;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.tenant_id = v_tenant AND i.invoice_number = p_serial
  ) THEN
    RAISE EXCEPTION 'An invoice still uses number % — delete or renumber it first', p_serial;
  END IF;

  DELETE FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND serial = p_serial;

  -- Hand the number back: the counter follows whatever is left for the branch,
  -- so clearing the top of the range makes those numbers issuable again.
  SELECT COALESCE(MAX(seq), 0) INTO v_top
    FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND branch_code = v_row.branch_code;

  UPDATE public.invoice_serial_sequences
     SET last_seq = v_top, updated_at = now()
   WHERE tenant_id = v_tenant AND branch_code = v_row.branch_code;

  RETURN v_top + 1;  -- the number that will now be handed out next
END;
$$;

COMMENT ON FUNCTION public.delete_invoice_number_row(text) IS
  'Remove one unissued number from the register and pull the branch counter back to the highest number left. Refuses for issued numbers.';

-- ── 6. Removing a branch's series ────────────────────────────────────────────
-- A series used to be a branch within one month. It is now the branch itself,
-- so the period argument has no meaning left and the function loses it.
DROP FUNCTION IF EXISTS public.delete_invoice_number_series(text, date);

CREATE OR REPLACE FUNCTION public.delete_invoice_number_series(p_branch_code text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid := public.get_user_tenant_id();
  v_branch  text := COALESCE(NULLIF(btrim(p_branch_code), ''), 'MAIN');
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

  -- Any invoice carrying one of this branch's serials stops the deletion. The
  -- branch is read out of the serial rather than matched with LIKE, whose
  -- wildcards would trip over the underscores the format is built from.
  SELECT i.invoice_number INTO v_inv
    FROM public.invoices i
   WHERE i.tenant_id = v_tenant
     AND i.invoice_number ~ '^[0-9]{2}[A-Z]{3}_.+_[0-9]+$'
     AND split_part(i.invoice_number, '_', 2) = v_branch
   LIMIT 1;

  IF v_inv IS NOT NULL THEN
    RAISE EXCEPTION
      'Invoice % still uses this series. Delete or renumber it first.', v_inv;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_serial_register r
     WHERE r.tenant_id = v_tenant AND r.branch_code = v_branch
       AND (r.status = 'issued' OR r.invoice_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This series has issued numbers and cannot be removed.';
  END IF;

  DELETE FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND branch_code = v_branch;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.invoice_serial_sequences
   WHERE tenant_id = v_tenant AND branch_code = v_branch;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_number_series(text) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_invoice_number_series(text) TO authenticated;

COMMENT ON FUNCTION public.delete_invoice_number_series(text) IS
  'Remove one branch''s invoice number series (counter + register rows). Refuses if any invoice uses a number from it.';
