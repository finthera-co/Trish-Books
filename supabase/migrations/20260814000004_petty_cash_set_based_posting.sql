-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — grouping_mode, and set-based posting
--
-- Posting used to loop once per voucher group, issuing six statements each.
-- Fine at 200 vouchers (2.4 s for 2,000 rows) and unusable at 2,000 (16.7 s),
-- which is exactly what grouping_mode='row' produces: one voucher per sheet
-- row. Books with no voucher number column need that mode, so the loop had to
-- go.
--
-- The rewrite materialises the groups once — with their journal entry and
-- voucher ids and their allocated serial numbers already assigned — and then
-- issues a fixed number of set-based statements regardless of how many
-- vouchers there are. Only the per-year serial reservation still loops, over
-- distinct years, of which a batch normally has one.
--
-- Both legs of every entry are still written explicitly, and the per-line
-- trigger trg_pcv_line_account_integrity still fires on the voucher lines.
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
  v_allow_neg    BOOLEAN;
  v_grouping     TEXT;
  v_user         UUID;
  v_blocked      INTEGER;
  v_opening      NUMERIC(14,2);
  v_total_out    NUMERIC(14,2);
  v_total_in     NUMERIC(14,2);
  v_excluded     INTEGER;
  v_bad          RECORD;
  v_lowest       NUMERIC(14,2);
  v_yr           RECORD;
  v_start        INTEGER;
  v_vouchers     INTEGER := 0;
  v_receipts     INTEGER := 0;
  v_lines        INTEGER := 0;
BEGIN
  SELECT b.tenant_id, b.petty_cash_account_id, b.status, b.allow_negative_balance,
         b.grouping_mode, pca.account_id
    INTO v_tenant, v_fund, v_status, v_allow_neg, v_grouping, v_gl
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

  SELECT min(s.running) INTO v_lowest
  FROM (
    SELECT v_opening + sum(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END)
             OVER (ORDER BY l.parsed_date, l.row_no ROWS UNBOUNDED PRECEDING) AS running
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
  ) s;

  -- ── Groups, materialised once ──────────────────────────────────────────
  -- grp is the whole grouping rule: the paper voucher, or the row itself.
  CREATE TEMP TABLE _pc_post_groups (
    grp          TEXT,
    direction    TEXT,
    parsed_date  DATE,
    vno          TEXT,
    nm           TEXT,
    total        NUMERIC(14,2),
    yr           INTEGER,
    je_id        UUID,
    voucher_id   UUID,
    anchor       UUID,
    rn_in_year   INTEGER,
    serial       INTEGER,
    voucher_number TEXT
  ) ON COMMIT DROP;

  INSERT INTO _pc_post_groups
    (grp, direction, parsed_date, vno, nm, total, yr, je_id, voucher_id, anchor, rn_in_year)
  SELECT g.grp, g.direction, g.parsed_date, g.vno, g.nm, g.total, g.yr,
         gen_random_uuid(), gen_random_uuid(), g.anchor,
         CASE WHEN g.direction = 'out'
              THEN row_number() OVER (PARTITION BY g.yr, g.direction
                                      ORDER BY g.parsed_date, g.grp)
         END
  FROM (
    SELECT CASE WHEN v_grouping = 'row'
                THEN l.row_no::TEXT
                ELSE coalesce(l.raw_voucher_no, '') || E'' || coalesce(l.raw_name, '')
           END                              AS grp,
           l.direction,
           l.parsed_date,
           max(coalesce(l.raw_voucher_no, '')) AS vno,
           max(coalesce(l.raw_name, ''))       AS nm,
           sum(l.amount)                       AS total,
           extract(year FROM l.parsed_date)::INTEGER AS yr,
           (array_agg(l.id ORDER BY l.row_no))[1] AS anchor
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
    GROUP BY 1, l.direction, l.parsed_date, extract(year FROM l.parsed_date)::INTEGER
  ) g;

  -- One serial block per year the outflows span (normally a single year).
  FOR v_yr IN
    SELECT yr, count(*) AS n FROM _pc_post_groups WHERE direction = 'out' GROUP BY yr ORDER BY yr
  LOOP
    v_start := next_pcv_serial_block(v_tenant, v_yr.yr, v_yr.n::INTEGER);
    UPDATE _pc_post_groups
    SET serial = v_start + rn_in_year - 1,
        voucher_number = 'PCV-' || v_yr.yr::TEXT || '-' ||
                         lpad((v_start + rn_in_year - 1)::TEXT, 4, '0')
    WHERE direction = 'out' AND yr = v_yr.yr;
  END LOOP;

  -- Same grouping expression, applied to the lines, so every insert below can
  -- join a line to its group.
  CREATE TEMP TABLE _pc_post_lines ON COMMIT DROP AS
  SELECT l.id, l.row_no, l.parsed_date, l.direction, l.amount,
         l.resolved_account_id, l.raw_description,
         CASE WHEN v_grouping = 'row'
              THEN l.row_no::TEXT
              ELSE coalesce(l.raw_voucher_no, '') || E'' || coalesce(l.raw_name, '')
         END AS grp
  FROM petty_cash_import_lines l
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status IN ('ok', 'suspense');

  CREATE INDEX ON _pc_post_lines (grp, direction, parsed_date);

  -- ── Journal entries: outflow vouchers and inflow receipts, one pass ────
  INSERT INTO journal_entries
    (id, tenant_id, entry_date, description, reference, status, posted_at,
     is_system_generated, entry_type, cash_flow_category, source_type, source_id, created_by)
  SELECT g.je_id, v_tenant, g.parsed_date,
         CASE WHEN g.direction = 'out'
              THEN 'Petty Cash Voucher ' || g.voucher_number ||
                   CASE WHEN g.vno <> '' THEN ' (' || g.vno || ')' ELSE '' END
              ELSE 'Petty Cash Receipt' || CASE WHEN g.nm <> '' THEN ' — ' || g.nm ELSE '' END
         END,
         CASE WHEN g.direction = 'out'
              THEN CASE WHEN g.vno <> '' THEN g.vno ELSE g.voucher_number END
              ELSE nullif(g.vno, '')
         END,
         'posted', now(), true,
         CASE WHEN g.direction = 'out' THEN 'petty_cash' ELSE 'petty_cash_import_receipt' END,
         'operating', 'petty_cash_import',
         -- Each entry names the document that produced it, never the batch:
         -- idx_je_unique_source requires (source_type, source_id) to be unique.
         CASE WHEN g.direction = 'out' THEN g.voucher_id ELSE g.anchor END,
         v_user
  FROM _pc_post_groups g;

  -- Contra legs, one per import line.
  INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
  SELECT g.je_id, v_tenant, l.resolved_account_id,
         CASE WHEN l.direction = 'out' THEN l.amount ELSE 0 END,
         CASE WHEN l.direction = 'out' THEN 0 ELSE l.amount END,
         l.raw_description
  FROM _pc_post_lines l
  JOIN _pc_post_groups g
    ON g.grp = l.grp AND g.direction = l.direction AND g.parsed_date = l.parsed_date;

  -- Fund legs, one per group. Both sides explicit, never inferred.
  INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
  SELECT g.je_id, v_tenant, v_gl,
         CASE WHEN g.direction = 'in'  THEN g.total ELSE 0 END,
         CASE WHEN g.direction = 'out' THEN g.total ELSE 0 END,
         CASE WHEN g.direction = 'out' THEN 'Petty cash paid out' ELSE 'Petty cash received' END
  FROM _pc_post_groups g;

  INSERT INTO petty_cash_vouchers
    (id, tenant_id, voucher_number, date, paid_to, total_amount, status,
     petty_cash_account_id, prepared_by, journal_entry_id, approved_at)
  SELECT g.voucher_id, v_tenant, g.voucher_number, g.parsed_date, nullif(g.nm, ''),
         g.total, 'approved', v_fund, v_user, g.je_id, now()
  FROM _pc_post_groups g
  WHERE g.direction = 'out';

  -- trg_pcv_line_account_integrity fires per row here. Resolver Phase C
  -- already guarantees it passes, so a raise is a resolver bug and correctly
  -- aborts the whole transaction.
  INSERT INTO petty_cash_voucher_lines (voucher_id, line_no, date, description, account_id, amount)
  SELECT g.voucher_id,
         row_number() OVER (PARTITION BY g.voucher_id ORDER BY l.row_no),
         l.parsed_date, l.raw_description, l.resolved_account_id, l.amount
  FROM _pc_post_lines l
  JOIN _pc_post_groups g
    ON g.grp = l.grp AND g.direction = l.direction AND g.parsed_date = l.parsed_date
  WHERE l.direction = 'out';

  UPDATE petty_cash_import_lines t
  SET voucher_id = CASE WHEN g.direction = 'out' THEN g.voucher_id END,
      journal_entry_id = g.je_id,
      status = 'posted'
  FROM _pc_post_lines l
  JOIN _pc_post_groups g
    ON g.grp = l.grp AND g.direction = l.direction AND g.parsed_date = l.parsed_date
  WHERE t.id = l.id AND t.tenant_id = v_tenant;

  SELECT count(*) FILTER (WHERE direction = 'out'),
         count(*) FILTER (WHERE direction = 'in')
    INTO v_vouchers, v_receipts
  FROM _pc_post_groups;

  SELECT count(*),
         coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0),
         coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0)
    INTO v_lines, v_total_out, v_total_in
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'posted';

  UPDATE petty_cash_import_batches
  SET status = 'posted', posted_at = now()
  WHERE id = p_batch_id AND tenant_id = v_tenant;

  PERFORM recalc_budget_for_pc_import_batch(p_batch_id);
  PERFORM sync_pc_import_batch_transactions(p_batch_id);
  PERFORM set_config('app.pc_import_bulk', '0', true);

  DROP TABLE IF EXISTS _pc_post_groups;
  DROP TABLE IF EXISTS _pc_post_lines;

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
    'lowest_balance',   coalesce(v_lowest, v_opening),
    'opening_float_needed',
      CASE WHEN coalesce(v_lowest, 0) < 0 THEN abs(v_lowest) ELSE 0 END
  );
END;
$$;

COMMENT ON FUNCTION public.post_petty_cash_import_batch(UUID) IS
  'Posts a resolved petty cash import batch in one transaction, set-based: a fixed number of statements regardless of voucher count. Honours grouping_mode (paper voucher vs one per row) and allow_negative_balance.';
