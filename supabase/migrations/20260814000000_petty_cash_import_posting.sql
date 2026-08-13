-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — posting, discard, reversal, suspense reclassification
--
-- Three removal paths, deliberately distinct, because the user must always
-- know whether the ledger is involved:
--
--   staged, not posted   → discard  → staging rows hard-deleted + audit row
--   posted               → reverse  → mirror-image entries, nothing deleted
--   reverted             → discard  → staging row only; the ledger keeps both
--                                      the original and the reversal
--
-- Both discard and reversal free the file hash, so a corrected file can be
-- uploaded again without touching the database by hand.
--
-- All arithmetic is numeric, in Postgres, inside one transaction. Both legs of
-- every journal entry are written explicitly — nothing is inferred.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Budget trigger escape hatch ────────────────────────────────────────────
-- enforce_budget_on_journal_line calls recalc_budget_consumption once per
-- journal line, and that recalc aggregates every journal_line for the account
-- and period. On a 2,000-line import that is 2,000 full aggregates and the
-- posting RPC cannot meet its time budget.
--
-- The bank import already solved this with an app.bank_import_bulk guard plus
-- an end-of-batch recalculation. This adds a second, independent flag rather
-- than reusing that one: app.bank_import_bulk ALSO suppresses
-- sync_journal_to_transactions, and the petty cash import wants that sync to
-- run normally (a few hundred entries, not thousands). The existing check is
-- preserved verbatim, so bank import behaviour is unchanged.
CREATE OR REPLACE FUNCTION public.enforce_budget_on_journal_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_je    journal_entries%ROWTYPE;
  v_acct  accounts%ROWTYPE;
  v_amount numeric(18,2);
  v_result jsonb;
  v_ctrl  budget_controls%ROWTYPE;
BEGIN
  -- Bulk bank import: defer to the single end-of-batch recalculation.
  IF current_setting('app.bank_import_bulk', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Bulk petty cash import: same deal, recalc_budget_for_pc_import_batch()
  -- runs once at the end of the posting transaction.
  IF current_setting('app.pc_import_bulk', true) = '1' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_je FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF v_je.status <> 'posted' THEN RETURN NEW; END IF;

  SELECT * INTO v_acct FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_acct.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense','Revenue','Income','Other Income') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ctrl FROM budget_controls WHERE tenant_id = v_je.tenant_id;

  IF FOUND AND v_ctrl.enforcement_mode = 'block' THEN
    IF v_acct.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN
      v_amount := NEW.debit - NEW.credit;
    ELSE
      v_amount := NEW.credit - NEW.debit;
    END IF;

    IF v_amount > 0 THEN
      v_result := public.validate_voucher_budget(
        v_je.tenant_id, NEW.account_id, v_amount, v_je.entry_date, NULL, NULL, NULL);
      IF (v_result->>'status') = 'block' THEN
        RAISE EXCEPTION 'Budget block: account % over budget for period % (allocated %, would total %).',
          v_acct.account_name, v_result->>'period', v_result->>'allocated', v_result->>'new_total';
      END IF;
    END IF;
  END IF;

  PERFORM public.recalc_budget_consumption(
    v_je.tenant_id, NEW.account_id,
    public.derive_period(v_je.entry_date,'monthly'),'monthly', NULL, NULL, NULL);

  RETURN NEW;
END;
$$;

-- Recompute budget consumption once per (account, period) a batch touched.
CREATE OR REPLACE FUNCTION public.recalc_budget_for_pc_import_batch(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_r RECORD; v_n INTEGER := 0;
BEGIN
  -- A batch's entries are found through its lines, not through source_id:
  -- idx_je_unique_source makes (source_type, source_id) unique, so each entry
  -- points at the document that produced it (its voucher, or its receipt
  -- anchor line), never at the batch.
  FOR v_r IN
    WITH batch_entries AS (
      SELECT DISTINCT journal_entry_id AS id
      FROM petty_cash_import_lines
      WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL
    )
    SELECT DISTINCT jl.account_id, je.tenant_id,
           public.derive_period(je.entry_date, 'monthly') AS period
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      JOIN accounts a ON a.id = jl.account_id
     WHERE (je.id IN (SELECT id FROM batch_entries)
            OR je.reversal_of IN (SELECT id FROM batch_entries))
       AND je.status = 'posted'
       AND a.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Income','Other Income')
  LOOP
    PERFORM public.recalc_budget_consumption(
      v_r.tenant_id, v_r.account_id, v_r.period, 'monthly', NULL, NULL, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5a. POST
-- ═══════════════════════════════════════════════════════════════════════════
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
  v_user         UUID;
  v_blocked      INTEGER;
  v_opening      NUMERIC(14,2);
  v_total_out    NUMERIC(14,2);
  v_total_in     NUMERIC(14,2);
  v_excluded     INTEGER;
  v_bad          RECORD;
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
  -- FOR UPDATE serializes two tabs posting the same batch: the loser waits,
  -- then fails the status check below because the winner set it to 'posted'.
  SELECT b.tenant_id, b.petty_cash_account_id, b.status, pca.account_id
    INTO v_tenant, v_fund, v_status, v_gl
  FROM petty_cash_import_batches b
  JOIN petty_cash_accounts pca ON pca.id = b.petty_cash_account_id
  WHERE b.id = p_batch_id
  FOR UPDATE OF b;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % does not exist', p_batch_id;
  END IF;

  -- A SECURITY DEFINER function must never trust its argument.
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

  -- users.id, never auth.uid() — created_by/prepared_by are FKs to users.
  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NO_USER: no application user for the current session';
  END IF;

  PERFORM set_config('app.pc_import_bulk', '1', true);

  v_opening := get_petty_cash_balance(v_fund);

  -- Sufficiency: a running balance in date/row order, not a net total. A net
  -- check would happily let a batch post that overdrew the box mid-month and
  -- was only repaid at the end of it.
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

  IF FOUND THEN
    RAISE EXCEPTION
      'INSUFFICIENT_FUND: row % (%) overdraws the fund by %. Opening balance is %; add a top-up before this date, or exclude the row.',
      v_bad.row_no, v_bad.parsed_date, abs(v_bad.running), v_opening;
  END IF;

  -- ── Outflows → vouchers ────────────────────────────────────────────────
  -- One voucher per (date, voucher no, name): a single paper voucher covering
  -- four expense lines becomes one voucher with four lines, which is what the
  -- paper voucher actually was.
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
    -- One serial block per year, reserved before the first voucher of that
    -- year is written.
    IF g.yr <> v_prev_year THEN
      v_serial := next_pcv_serial_block(v_tenant, g.yr, g.groups_in_year::INTEGER);
      v_prev_year := g.yr;
    ELSE
      v_serial := v_serial + 1;
    END IF;
    v_vnum := 'PCV-' || g.yr::TEXT || '-' || lpad(v_serial::TEXT, 4, '0');

    -- The voucher id is minted up front so the entry can name it as its
    -- source: idx_je_unique_source requires (source_type, source_id) to be
    -- unique, so the source has to be the voucher, not the batch.
    v_voucher := gen_random_uuid();

    INSERT INTO journal_entries
      (tenant_id, entry_date, description, reference, status, posted_at,
       is_system_generated, entry_type, cash_flow_category, source_type, source_id, created_by)
    VALUES
      (v_tenant, g.parsed_date,
       'Petty Cash Voucher ' || v_vnum ||
         CASE WHEN g.vno <> '' THEN ' (' || g.vno || ')' ELSE '' END,
       -- The sheet's own voucher number is the reference; the generated PCV
       -- number is what makes the voucher row unique.
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

    -- Both sides explicit: one credit to the fund GL for the group total.
    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    VALUES (v_je, v_tenant, v_gl, 0, g.total, 'Petty cash paid out');

    INSERT INTO petty_cash_vouchers
      (id, tenant_id, voucher_number, date, paid_to, total_amount, status,
       petty_cash_account_id, prepared_by, journal_entry_id, approved_at)
    VALUES
      (v_voucher, v_tenant, v_vnum, g.parsed_date, nullif(g.nm, ''), g.total, 'approved',
       v_fund, v_user, v_je, now());

    -- trg_pcv_line_account_integrity fires here. Phase C of the resolver
    -- already guarantees it passes, so a raise at this point is a resolver
    -- bug and correctly aborts the whole transaction.
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
  -- Not vouchers, and deliberately not petty_cash_replenishments: that table
  -- requires a bank_account_id and not every inflow is a bank top-up.
  FOR g IN
    SELECT l.parsed_date,
           coalesce(l.raw_voucher_no, '') AS vno,
           coalesce(l.raw_name, '')       AS nm,
           sum(l.amount)                  AS total,
           -- A receipt has no voucher, so the group's earliest line is its
           -- stable, unique source document.
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
    'closing_balance',  v_opening - v_total_out + v_total_in
  );
END;
$$;

COMMENT ON FUNCTION public.post_petty_cash_import_batch(UUID) IS
  'Posts a resolved petty cash import batch in one transaction: outflows grouped into approved vouchers, inflows into receipt journal entries. Refuses while any line is blocked, and refuses if the running balance ever goes negative.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5b. DISCARD — the "remove the uploaded file" path, staging only
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.discard_petty_cash_import_batch(
  p_batch_id UUID,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := get_user_tenant_id();
  v_b      petty_cash_import_batches%ROWTYPE;
  v_user   UUID;
  v_lines  INTEGER;
BEGIN
  SELECT * INTO v_b FROM petty_cash_import_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % does not exist', p_batch_id;
  END IF;
  IF v_b.tenant_id <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: import batch % belongs to another tenant', p_batch_id;
  END IF;

  IF v_b.status = 'posted' THEN
    RAISE EXCEPTION
      'BATCH_POSTED: This import is posted to the ledger. Reverse it instead — reversing writes correcting entries and leaves an audit trail.'
      USING ERRCODE = 'P0007';
  END IF;

  IF v_b.status NOT IN ('draft', 'resolved', 'failed', 'reverted') THEN
    RAISE EXCEPTION 'BATCH_NOT_DISCARDABLE: batch is %', v_b.status;
  END IF;

  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();

  SELECT count(*) INTO v_lines
  FROM petty_cash_import_lines WHERE batch_id = p_batch_id;

  -- The staging rows never touched the ledger, so there is nothing to preserve
  -- there — but the fact that a file was uploaded and withdrawn is worth
  -- keeping.
  INSERT INTO petty_cash_import_discards
    (tenant_id, petty_cash_account_id, file_name, file_hash, row_count,
     batch_status_at_discard, reason, discarded_by)
  VALUES
    (v_b.tenant_id, v_b.petty_cash_account_id, v_b.file_name, v_b.file_hash,
     v_b.row_count, v_b.status, p_reason, v_user);

  -- Lines cascade. For a reverted batch the vouchers and journal entries it
  -- produced are NOT touched; only the staging record goes.
  DELETE FROM petty_cash_import_batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id',      p_batch_id,
    'file_name',     v_b.file_name,
    'lines_deleted', v_lines,
    'hash_released', true
  );
END;
$$;

COMMENT ON FUNCTION public.discard_petty_cash_import_batch(UUID, TEXT) IS
  'Hard-deletes a staged (never-posted) or already-reverted import batch and records the discard. Frees the file hash so the same file can be uploaded again. Refuses on a posted batch.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5c. REVERT — the only removal path once the ledger is involved
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.revert_petty_cash_import_batch(
  p_batch_id UUID,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID := get_user_tenant_id();
  v_b        petty_cash_import_batches%ROWTYPE;
  v_user     UUID;
  v_fund_gl  UUID;
  e          RECORD;
  v_rev_date DATE;
  v_new_je   UUID;
  v_entries  INTEGER := 0;
  v_vouchers INTEGER := 0;
  v_net      NUMERIC(14,2) := 0;
BEGIN
  SELECT * INTO v_b FROM petty_cash_import_batches WHERE id = p_batch_id FOR UPDATE;

  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % does not exist', p_batch_id;
  END IF;
  IF v_b.tenant_id <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: import batch % belongs to another tenant', p_batch_id;
  END IF;
  IF v_b.status <> 'posted' THEN
    RAISE EXCEPTION 'BATCH_NOT_POSTED: only a posted batch can be reversed (batch is %)', v_b.status;
  END IF;

  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();
  SELECT account_id INTO v_fund_gl FROM petty_cash_accounts WHERE id = v_b.petty_cash_account_id;

  PERFORM set_config('app.pc_import_bulk', '1', true);

  -- Reached through the batch's own lines: each entry's source_id names the
  -- voucher or receipt that produced it, not the batch.
  FOR e IN
    SELECT je.id, je.entry_date, je.description, je.reference, je.entry_type
    FROM journal_entries je
    WHERE je.tenant_id = v_b.tenant_id
      AND je.status = 'posted'
      AND je.id IN (
        SELECT DISTINCT journal_entry_id
        FROM petty_cash_import_lines
        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL
      )
    ORDER BY je.entry_date, je.id
  LOOP
    -- Date the reversal into the original period when it is still open;
    -- otherwise into the first open period that starts after it.
    IF EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.tenant_id = v_b.tenant_id AND fp.status = 'closed'
        AND e.entry_date BETWEEN fp.period_start AND fp.period_end
    ) THEN
      SELECT min(fp.period_start) INTO v_rev_date
      FROM fiscal_periods fp
      WHERE fp.tenant_id = v_b.tenant_id
        AND fp.status <> 'closed'
        AND fp.period_start > e.entry_date;

      IF v_rev_date IS NULL THEN
        RAISE EXCEPTION
          'PERIOD_LOCKED: entry % sits in a closed period (%) and there is no open period after it to date the reversal into. Reopen the period first.',
          e.reference, e.entry_date;
      END IF;
    ELSE
      v_rev_date := e.entry_date;
    END IF;

    INSERT INTO journal_entries
      (tenant_id, entry_date, description, reference, status, posted_at,
       is_system_generated, entry_type, cash_flow_category,
       source_type, source_id, reversal_of, created_by)
    VALUES
      (v_b.tenant_id, v_rev_date,
       'Reversal: ' || e.description,
       'REV-' || coalesce(e.reference, e.id::TEXT),
       'posted', now(), true, e.entry_type || '_reversal', 'operating',
       'petty_cash_import_reversal', e.id, e.id, v_user)
    RETURNING id INTO v_new_je;

    -- Mirror image: debit ↔ credit. Nothing is deleted.
    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    SELECT v_new_je, v_b.tenant_id, jl.account_id, jl.credit, jl.debit, jl.memo
    FROM journal_lines jl
    WHERE jl.journal_entry_id = e.id;

    SELECT v_net + coalesce(sum(jl.debit - jl.credit), 0) INTO v_net
    FROM journal_lines jl
    WHERE jl.journal_entry_id = e.id AND jl.account_id = v_fund_gl;

    v_entries := v_entries + 1;
  END LOOP;

  UPDATE petty_cash_vouchers v
  SET status = 'reversed', reversed_at = now()
  FROM petty_cash_import_lines l
  WHERE l.batch_id = p_batch_id
    AND l.voucher_id = v.id
    AND v.tenant_id = v_b.tenant_id
    AND v.status <> 'reversed';
  GET DIAGNOSTICS v_vouchers = ROW_COUNT;

  -- 'reverted' is excluded by ux_pc_import_batch_hash, so this also releases
  -- the file hash for a corrected re-upload.
  UPDATE petty_cash_import_batches
  SET status = 'reverted', reverted_at = now(),
      notes = coalesce(notes || E'\n', '') || 'Reversed: ' || coalesce(p_reason, '')
  WHERE id = p_batch_id;

  PERFORM recalc_budget_for_pc_import_batch(p_batch_id);
  PERFORM set_config('app.pc_import_bulk', '0', true);

  RETURN jsonb_build_object(
    'batch_id',         p_batch_id,
    'entries_reversed', v_entries,
    'vouchers_reversed', v_vouchers,
    'net_reversed',     v_net,
    'closing_balance',  get_petty_cash_balance(v_b.petty_cash_account_id),
    'hash_released',    true
  );
END;
$$;

COMMENT ON FUNCTION public.revert_petty_cash_import_batch(UUID, TEXT) IS
  'Writes mirror-image journal entries for every entry a batch created, marks its vouchers reversed, and sets the batch to reverted — which also frees the file hash. Deletes nothing.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5d. RECLASSIFY — clear posted lines off the suspense account
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reclassify_petty_cash_suspense_lines(
  p_line_ids  UUID[],
  p_account_id UUID,
  p_remember  BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID := get_user_tenant_id();
  v_user     UUID;
  v_suspense UUID;
  v_acct     accounts%ROWTYPE;
  v_out      NUMERIC(14,2);
  v_in       NUMERIC(14,2);
  v_je       UUID;
  v_count    INTEGER;
  v_keys     INTEGER := 0;
BEGIN
  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();
  SELECT suspense_account_id INTO v_suspense FROM account_settings WHERE tenant_id = v_tenant;

  IF v_suspense IS NULL THEN
    RAISE EXCEPTION 'SUSPENSE_NOT_CONFIGURED: no suspense account is configured for this tenant';
  END IF;

  SELECT * INTO v_acct FROM accounts WHERE id = p_account_id AND tenant_id = v_tenant;
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: account % does not belong to this tenant', p_account_id;
  END IF;
  IF p_account_id = v_suspense THEN
    RAISE EXCEPTION 'SAME_ACCOUNT: the target account is the suspense account itself';
  END IF;
  IF NOT v_acct.is_postable OR NOT v_acct.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_POSTABLE: account % cannot be posted to', v_acct.account_code;
  END IF;

  SELECT count(*),
         coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0),
         coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0)
    INTO v_count, v_out, v_in
  FROM petty_cash_import_lines
  WHERE id = ANY(p_line_ids)
    AND tenant_id = v_tenant
    AND status = 'posted'
    AND resolved_account_id = v_suspense;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_OPEN_SUSPENSE_LINES: none of the selected lines are posted suspense items';
  END IF;

  INSERT INTO journal_entries
    (tenant_id, entry_date, description, reference, status, posted_at,
     is_system_generated, entry_type, cash_flow_category, source_type, created_by)
  VALUES
    (v_tenant, CURRENT_DATE,
     'Suspense reclassification → ' || v_acct.account_code || ' ' || v_acct.account_name,
     'PC-RECLASS', 'posted', now(), true,
     'petty_cash_reclass', 'operating', 'petty_cash_import_reclass', v_user)
  RETURNING id INTO v_je;

  -- Outflows moved off suspense: Dr correct account / Cr suspense.
  IF v_out > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    VALUES (v_je, v_tenant, p_account_id, v_out, 0, 'Reclassified from suspense'),
           (v_je, v_tenant, v_suspense, 0, v_out, 'Suspense cleared');
  END IF;

  -- Inflows: the reverse.
  IF v_in > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
    VALUES (v_je, v_tenant, v_suspense, v_in, 0, 'Suspense cleared'),
           (v_je, v_tenant, p_account_id, 0, v_in, 'Reclassified from suspense');
  END IF;

  -- The original voucher lines are left as they were posted: they are the
  -- historical record, and the correcting entry is what moves the money.
  UPDATE petty_cash_import_lines
  SET resolved_account_id = p_account_id,
      resolution_tier     = 'manual'
  WHERE id = ANY(p_line_ids) AND tenant_id = v_tenant
    AND status = 'posted' AND resolved_account_id = v_suspense;

  IF p_remember THEN
    WITH learned AS (
      SELECT DISTINCT fn_normalize_import_key(raw_account_type) AS k
      FROM petty_cash_import_lines
      WHERE id = ANY(p_line_ids) AND tenant_id = v_tenant
        AND fn_normalize_import_key(raw_account_type) IS NOT NULL
    ), upserted AS (
      INSERT INTO petty_cash_account_map (tenant_id, match_type, match_key, account_id, created_by)
      SELECT v_tenant, 'account_type', k, p_account_id, v_user FROM learned
      ON CONFLICT (tenant_id, match_type, match_key)
      DO UPDATE SET account_id = EXCLUDED.account_id, updated_at = now()
      RETURNING 1
    )
    SELECT count(*) INTO v_keys FROM upserted;
  END IF;

  RETURN jsonb_build_object(
    'journal_entry_id',  v_je,
    'lines_reclassified', v_count,
    'total_out',         v_out,
    'total_in',          v_in,
    'mappings_learned',  v_keys
  );
END;
$$;

COMMENT ON FUNCTION public.reclassify_petty_cash_suspense_lines(UUID[], UUID, BOOLEAN) IS
  'Moves posted import lines off the suspense account with a correcting journal entry, optionally teaching petty_cash_account_map so the next import resolves at tier 1. Original voucher lines are left intact as the historical record.';
