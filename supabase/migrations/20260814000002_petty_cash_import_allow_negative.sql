-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — allow a batch to post before the opening float exists
--
-- The sufficiency check refuses any batch whose running balance goes negative,
-- which is right for day-to-day work: you cannot pay out cash the box never
-- held.
--
-- It is wrong for the first import of a historical book. The opening float was
-- put in the box months ago and was never recorded in this system, so the very
-- first outflow overdraws a fund that reads zero — even though the paper book
-- balanced perfectly all along.
--
-- Rather than weaken the guard for everyone, this makes it a per-batch,
-- opt-in decision, and reports exactly how much opening float is missing so it
-- can be posted afterwards with a date before the first row.
--
-- Honest about the consequence: until that opening entry exists, the petty cash
-- GL carries a credit balance, which is wrong on a balance sheet for an asset.
-- It is a transitional state during migration, not a resting state.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.petty_cash_import_batches
  ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.petty_cash_import_batches.allow_negative_balance IS
  'Opt-in: post this batch even though the running fund balance goes negative, because the opening float predates the system. The posting result reports the shortfall so the opening entry can be backdated.';

CREATE OR REPLACE FUNCTION public.post_petty_cash_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID := get_user_tenant_id();
  v_tenant       UUID;
  v_fund         UUID;
  v_gl           UUID;
  v_status       TEXT;
  v_allow_neg    BOOLEAN;
  v_user         UUID;
  v_blocked      INTEGER;
  v_opening      NUMERIC(14,2);
  v_total_out    NUMERIC(14,2);
  v_total_in     NUMERIC(14,2);
  v_excluded     INTEGER;
  v_bad          RECORD;
  v_lowest       NUMERIC(14,2);
  g              RECORD;
  v_je           UUID;
  v_voucher      UUID;
  v_prev_year    INTEGER := -1;
  v_serial       INTEGER;
  v_vnum         TEXT;
  v_vouchers     INTEGER := 0;
  v_receipts     INTEGER := 0;
  v_lines        INTEGER := 0;
BEGIN
  SELECT b.tenant_id, b.petty_cash_account_id, b.status, b.allow_negative_balance, pca.account_id
    INTO v_tenant, v_fund, v_status, v_allow_neg, v_gl
  FROM petty_cash_import_batches b
  JOIN petty_cash_accounts pca ON pca.id = b.petty_cash_account_id
  WHERE b.id = p_batch_id
  FOR UPDATE OF b;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % does not exist', p_batch_id;
  END IF;

  IF v_tenant <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: import batch % belongs to another tenant', p_batch_id;
  END IF;

  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'BATCH_NOT_RESOLVED: batch is % — resolve it first, and post only once', v_status;
  END IF;

  SELECT count(*) INTO v_blocked
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'blocked';

  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'BLOCKED_LINES: % line(s) must be corrected, excluded, or the batch discarded before posting', v_blocked;
  END IF;

  SELECT count(*) INTO v_excluded
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'excluded';

  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NO_USER: no application user for the current session';
  END IF;

  PERFORM set_config('app.pc_import_bulk', '1', true);

  v_opening := get_petty_cash_balance(v_fund);

  -- Running balance in date/row order, not a net total: a net check would let
  -- a batch post that overdrew the box mid-month and was repaid at the end.
  SELECT s.row_no, s.parsed_date, s.running INTO v_bad
  FROM (
    SELECT l.row_no, l.parsed_date,
           v_opening + sum(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END)
             OVER (ORDER BY l.parsed_date, l.row_no ROWS UNBOUNDED PRECEDING) AS running
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
  ) s
  WHERE s.running < 0
  ORDER BY s.parsed_date, s.row_no
  LIMIT 1;

  IF FOUND AND NOT v_allow_neg THEN
    RAISE EXCEPTION
      'INSUFFICIENT_FUND: row % (%) overdraws the fund by %. Opening balance is %. Post the opening float first, or allow this batch to go negative if the float predates the system.',
      v_bad.row_no, v_bad.parsed_date, abs(v_bad.running), v_opening;
  END IF;

  -- How deep it goes, so the UI can name the exact opening float to backdate.
  SELECT min(s.running) INTO v_lowest
  FROM (
    SELECT v_opening + sum(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END)
             OVER (ORDER BY l.parsed_date, l.row_no ROWS UNBOUNDED PRECEDING) AS running
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
  ) s;

  -- ── Outflows → vouchers ────────────────────────────────────────────────
  FOR g IN
    SELECT l.parsed_date,
           coalesce(l.raw_voucher_no, '') AS vno,
           coalesce(l.raw_name, '')       AS nm,
           sum(l.amount)                  AS total,
           extract(year FROM l.parsed_date)::INTEGER AS yr,
           count(*) OVER (PARTITION BY extract(year FROM l.parsed_date)::INTEGER) AS groups_in_year
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'out'
    GROUP BY l.parsed_date, coalesce(l.raw_voucher_no, ''), coalesce(l.raw_name, ''),
             extract(year FROM l.parsed_date)::INTEGER
    ORDER BY yr, l.parsed_date, vno, nm
  LOOP
    IF g.yr <> v_prev_year THEN
      v_serial := next_pcv_serial_block(v_tenant, g.yr, g.groups_in_year::INTEGER);
      v_prev_year := g.yr;
    ELSE
      v_serial := v_serial + 1;
    END IF;
    v_vnum := 'PCV-' || g.yr::TEXT || '-' || lpad(v_serial::TEXT, 4, '0');

    v_voucher := gen_random_uuid();

    INSERT INTO journal_entries
      (tenant_id, entry_date, description, reference, status, posted_at,
       is_system_generated, entry_type, cash_flow_category, source_type, source_id, created_by)
    VALUES
      (v_tenant, g.parsed_date,
       'Petty Cash Voucher ' || v_vnum ||
         CASE WHEN g.vno <> '' THEN ' (' || g.vno || ')' ELSE '' END,
       CASE WHEN g.vno <> '' THEN g.vno ELSE v_vnum END,
       'posted', now(), true, 'petty_cash', 'operating',
       'petty_cash_import', v_voucher, v_user)
    RETURNING id INTO v_je;

    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    SELECT v_je, v_tenant, l.resolved_account_id, l.amount, 0, l.raw_description
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'out'
      AND l.parsed_date = g.parsed_date
      AND coalesce(l.raw_voucher_no, '') = g.vno
      AND coalesce(l.raw_name, '') = g.nm;

    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    VALUES (v_je, v_tenant, v_gl, 0, g.total, 'Petty cash paid out');

    INSERT INTO petty_cash_vouchers
      (id, tenant_id, voucher_number, date, paid_to, total_amount, status,
       petty_cash_account_id, prepared_by, journal_entry_id, approved_at)
    VALUES
      (v_voucher, v_tenant, v_vnum, g.parsed_date, nullif(g.nm, ''), g.total, 'approved',
       v_fund, v_user, v_je, now());

    INSERT INTO petty_cash_voucher_lines (voucher_id, line_no, date, description, account_id, amount)
    SELECT v_voucher, row_number() OVER (ORDER BY l.row_no), l.parsed_date,
           l.raw_description, l.resolved_account_id, l.amount
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'out'
      AND l.parsed_date = g.parsed_date
      AND coalesce(l.raw_voucher_no, '') = g.vno
      AND coalesce(l.raw_name, '') = g.nm;

    UPDATE petty_cash_import_lines l
    SET voucher_id = v_voucher, journal_entry_id = v_je, status = 'posted'
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'out'
      AND l.parsed_date = g.parsed_date
      AND coalesce(l.raw_voucher_no, '') = g.vno
      AND coalesce(l.raw_name, '') = g.nm;

    v_vouchers := v_vouchers + 1;
  END LOOP;

  -- ── Inflows → receipt journal entries ──────────────────────────────────
  FOR g IN
    SELECT l.parsed_date,
           coalesce(l.raw_voucher_no, '') AS vno,
           coalesce(l.raw_name, '')       AS nm,
           sum(l.amount)                  AS total,
           (array_agg(l.id ORDER BY l.row_no))[1] AS anchor
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'in'
    GROUP BY l.parsed_date, coalesce(l.raw_voucher_no, ''), coalesce(l.raw_name, '')
    ORDER BY l.parsed_date, vno, nm
  LOOP
    INSERT INTO journal_entries
      (tenant_id, entry_date, description, reference, status, posted_at,
       is_system_generated, entry_type, cash_flow_category, source_type, source_id, created_by)
    VALUES
      (v_tenant, g.parsed_date,
       'Petty Cash Receipt' || CASE WHEN g.nm <> '' THEN ' — ' || g.nm ELSE '' END,
       nullif(g.vno, ''), 'posted', now(), true,
       'petty_cash_import_receipt', 'operating',
       'petty_cash_import', g.anchor, v_user)
    RETURNING id INTO v_je;

    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    VALUES (v_je, v_tenant, v_gl, g.total, 0, 'Petty cash received');

    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    SELECT v_je, v_tenant, l.resolved_account_id, 0, l.amount, l.raw_description
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'in'
      AND l.parsed_date = g.parsed_date
      AND coalesce(l.raw_voucher_no, '') = g.vno
      AND coalesce(l.raw_name, '') = g.nm;

    UPDATE petty_cash_import_lines l
    SET journal_entry_id = v_je, status = 'posted'
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense') AND l.direction = 'in'
      AND l.parsed_date = g.parsed_date
      AND coalesce(l.raw_voucher_no, '') = g.vno
      AND coalesce(l.raw_name, '') = g.nm;

    v_receipts := v_receipts + 1;
  END LOOP;

  SELECT
    count(*),
    coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0),
    coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0)
  INTO v_lines, v_total_out, v_total_in
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'posted';

  UPDATE petty_cash_import_batches
  SET status = 'posted', posted_at = now()
  WHERE id = p_batch_id AND tenant_id = v_tenant;

  PERFORM recalc_budget_for_pc_import_batch(p_batch_id);
  PERFORM set_config('app.pc_import_bulk', '0', true);

  RETURN jsonb_build_object(
    'batch_id',        p_batch_id,
    'vouchers_created', v_vouchers,
    'receipts_created', v_receipts,
    'journal_entries',  v_vouchers + v_receipts,
    'lines_posted',     v_lines,
    'lines_excluded',   v_excluded,
    'total_out',        v_total_out,
    'total_in',         v_total_in,
    'net_movement',     v_total_in - v_total_out,
    'opening_balance',  v_opening,
    'closing_balance',  v_opening - v_total_out + v_total_in,
    -- Lowest point the fund reached during the batch. When negative, this is
    -- exactly the opening float that is missing: post it dated before the
    -- first row and the fund never goes below zero.
    'lowest_balance',   coalesce(v_lowest, v_opening),
    'opening_float_needed',
      CASE WHEN coalesce(v_lowest, 0) < 0 THEN abs(v_lowest) ELSE 0 END
  );
END;
$$;

COMMENT ON FUNCTION public.post_petty_cash_import_batch(UUID) IS
  'Posts a resolved petty cash import batch in one transaction. Refuses while any line is blocked, and refuses if the running balance goes negative unless the batch opted into allow_negative_balance — in which case the result reports the opening float still needed.';
