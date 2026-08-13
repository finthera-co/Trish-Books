BEGIN;

CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON probe TO authenticated;

DO $verify2$
DECLARE
  v_tenant  UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund    UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user    UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_jwt     TEXT := '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}';
  v_gl UUID; v_susp UUID; v_obe UUID; v_batch UUID; v_batch2 UUID;
  v_open NUMERIC; v_post JSONB; v_rev JSONB; v_disc JSONB; v_recl JSONB;
  v_after NUMERIC; v_back NUMERIC; v_err TEXT; v_lineids UUID[]; v_entryids UUID[]; v_imbalance INT;
BEGIN
  SELECT account_id INTO v_gl FROM petty_cash_accounts WHERE id = v_fund;
  SELECT id INTO v_obe  FROM accounts WHERE tenant_id=v_tenant AND account_code='3900';

  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant, '1290', 'Suspense Account', 'Asset', true, true) RETURNING id INTO v_susp;
  INSERT INTO account_settings (tenant_id, suspense_account_id) VALUES (v_tenant, v_susp)
  ON CONFLICT (tenant_id) DO UPDATE SET suspense_account_id = EXCLUDED.suspense_account_id;

  INSERT INTO journal_entries (id, tenant_id, entry_date, description, status, entry_type, is_system_generated, posted_at)
  VALUES ('22222222-2222-2222-2222-222222222222', v_tenant, '2026-02-01', 'fixture float', 'posted', 'manual', true, now());
  INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit)
  VALUES ('22222222-2222-2222-2222-222222222222', v_tenant, v_gl, 20000, 0),
         ('22222222-2222-2222-2222-222222222222', v_tenant, v_obe, 0, 20000);

  INSERT INTO petty_cash_account_map (tenant_id, match_type, match_key, account_id)
  VALUES (v_tenant, 'account_type', fn_normalize_import_key('Fuel Allowance'),
          (SELECT id FROM accounts WHERE tenant_id=v_tenant AND account_code='6030'));

  -- ── batch: 3 outflow lines sharing one voucher no, 1 separate, 1 inflow,
  --           1 suspense, 1 excluded ────────────────────────────────────────
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, amount_orientation, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'post.xlsx', 'post-hash-001', 'DD/MM/YYYY', 'contra', 7, v_user)
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_voucher_no, raw_name, raw_description, raw_account_type, raw_debit, raw_credit, parsed_date)
  VALUES
    (v_batch, v_tenant, 1, '05/02/2026', 'PV-100', 'Nimal', 'tea',        'Electricity', '300',  '', '2026-02-05'),
    (v_batch, v_tenant, 2, '05/02/2026', 'PV-100', 'Nimal', 'sugar',      'Electricity', '200',  '', '2026-02-05'),
    (v_batch, v_tenant, 3, '05/02/2026', 'PV-100', 'Nimal', 'milk',       '6020',        '500',  '', '2026-02-05'),
    (v_batch, v_tenant, 4, '06/02/2026', 'PV-101', 'Sunil', 'fuel',       'Fuel Allowance', '1,000', '', '2026-02-06'),
    (v_batch, v_tenant, 5, '07/02/2026', 'PV-102', 'Kamal', 'unknown thing', 'Zzz Unknown', '250', '', '2026-02-07'),
    (v_batch, v_tenant, 6, '08/02/2026', 'PV-103', 'Bank',  'top up',     '4050',        '',  '5,000', '2026-02-08'),
    (v_batch, v_tenant, 7, '08/02/2026', 'PV-104', 'Junk',  'junk row',   'Electricity', '99', '', '2026-02-08');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  RESET ROLE;

  -- exclude row 7
  UPDATE petty_cash_import_lines SET status='excluded' WHERE batch_id=v_batch AND row_no=7;

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_open := get_petty_cash_balance(v_fund);
  v_post := post_petty_cash_import_batch(v_batch);
  v_after := get_petty_cash_balance(v_fund);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('post.vouchers_created', '3',    v_post->>'vouchers_created'),
    ('post.receipts_created', '1',    v_post->>'receipts_created'),
    ('post.lines_posted',     '6',    v_post->>'lines_posted'),
    ('post.lines_excluded',   '1',    v_post->>'lines_excluded'),
    ('post.total_out',        '2250.00', v_post->>'total_out'),
    ('post.total_in',         '5000.00', v_post->>'total_in'),
    ('post.closing_balance',  (v_open - 2250 + 5000)::text, v_post->>'closing_balance'),
    ('balance after post',    (v_open - 2250 + 5000)::text, v_after::text),
    ('batch status',          'posted', (SELECT status FROM petty_cash_import_batches WHERE id=v_batch));

  -- grouping: PV-100 must be ONE voucher with THREE lines and one credit leg
  INSERT INTO probe
  SELECT 'PV-100 voucher lines', '3', count(*)::text
  FROM petty_cash_voucher_lines vl
  JOIN petty_cash_vouchers v ON v.id = vl.voucher_id
  WHERE v.journal_entry_id IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=1);

  INSERT INTO probe
  SELECT 'PV-100 credit legs to fund GL', '1', count(*)::text
  FROM journal_lines jl
  WHERE jl.journal_entry_id = (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=1)
    AND jl.account_id = v_gl AND jl.credit > 0;

  INSERT INTO probe
  SELECT 'voucher number format', 'PCV-2026-', left(v.voucher_number, 9)
  FROM petty_cash_vouchers v
  WHERE v.id = (SELECT voucher_id FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=1);

  INSERT INTO probe
  SELECT 'journal reference = sheet voucher no', 'PV-100', je.reference
  FROM journal_entries je
  WHERE je.id = (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=1);

  INSERT INTO probe
  SELECT 'suspense line posted to suspense', v_susp::text, jl.account_id::text
  FROM journal_lines jl
  WHERE jl.journal_entry_id = (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=5)
    AND jl.debit > 0;

  -- every batch-created entry internally balanced
  SELECT count(*) INTO v_imbalance FROM (
    SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.id IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch)
    GROUP BY je.id HAVING sum(jl.debit) - sum(jl.credit) <> 0) x;
  INSERT INTO probe VALUES ('unbalanced entries after post', '0', v_imbalance::text);

  -- ── discard a POSTED batch must fail ───────────────────────────────────
  BEGIN
    SET LOCAL role authenticated;
    PERFORM set_config('request.jwt.claims', v_jwt, true);
    PERFORM discard_petty_cash_import_batch(v_batch, 'nope');
    RESET ROLE;
    INSERT INTO probe VALUES ('discard posted', 'P0007', 'NO_ERROR_RAISED');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO probe VALUES ('discard posted', 'P0007', v_err);
  END;

  -- ── reclassify the suspense line ───────────────────────────────────────
  SELECT array_agg(id) INTO v_lineids FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=5;
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_recl := reclassify_petty_cash_suspense_lines(
    v_lineids, (SELECT id FROM accounts WHERE tenant_id=v_tenant AND account_code='6050'), true);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('reclass.lines', '1', v_recl->>'lines_reclassified'),
    ('reclass.learned', '1', v_recl->>'mappings_learned');
  INSERT INTO probe
  SELECT 'suspense balance after reclass', '0.00',
         coalesce(sum(jl.debit - jl.credit), 0)::text
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
  WHERE jl.account_id = v_susp AND je.status='posted' AND je.tenant_id=v_tenant;

  -- ── revert ─────────────────────────────────────────────────────────────
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_rev := revert_petty_cash_import_batch(v_batch, 'wrong file');
  v_back := get_petty_cash_balance(v_fund);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('revert.entries',   '4', v_rev->>'entries_reversed'),
    ('revert.vouchers',  '3', v_rev->>'vouchers_reversed'),
    ('revert.hash_released', 'true', v_rev->>'hash_released'),
    ('balance back to opening', v_open::text, v_back::text),
    ('batch status after revert', 'reverted', (SELECT status FROM petty_cash_import_batches WHERE id=v_batch));

  INSERT INTO probe
  SELECT 'vouchers marked reversed', '3', count(DISTINCT v.id)::text
  FROM petty_cash_vouchers v JOIN petty_cash_import_lines l ON l.voucher_id=v.id
  WHERE l.batch_id=v_batch AND v.status='reversed';

  SELECT count(*) INTO v_imbalance FROM (
    SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.id IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch)
       OR je.reversal_of IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch)
    GROUP BY je.id HAVING sum(jl.debit) - sum(jl.credit) <> 0) x;
  INSERT INTO probe VALUES ('unbalanced entries after revert', '0', v_imbalance::text);

  -- nothing was deleted
  INSERT INTO probe
  SELECT 'vouchers still exist', '3', count(DISTINCT v.id)::text
  FROM petty_cash_vouchers v JOIN petty_cash_import_lines l ON l.voucher_id=v.id
  WHERE l.batch_id=v_batch;

  -- ── re-upload the identical file after revert ──────────────────────────
  BEGIN
    INSERT INTO petty_cash_import_batches
      (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
    VALUES (v_tenant, v_fund, 'post.xlsx', 'post-hash-001', 'DD/MM/YYYY', 7, v_user)
    RETURNING id INTO v_batch2;
    INSERT INTO probe VALUES ('re-upload after revert', 'accepted', 'accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO probe VALUES ('re-upload after revert', 'accepted', 'BLOCKED by hash index');
  END;

  -- ── discard the reverted batch: staging goes, ledger stays ─────────────
  SELECT array_agg(DISTINCT journal_entry_id) INTO v_entryids
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND journal_entry_id IS NOT NULL;

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_disc := discard_petty_cash_import_batch(v_batch, 'cleanup');
  RESET ROLE;

  INSERT INTO probe VALUES
    ('discard reverted.lines_deleted', '7', v_disc->>'lines_deleted'),
    ('discard reverted.hash_released', 'true', v_disc->>'hash_released');
  INSERT INTO probe
  SELECT 'staging rows gone', '0', count(*)::text FROM petty_cash_import_lines WHERE batch_id=v_batch;
  INSERT INTO probe
  SELECT 'ledger entries untouched', '8', count(*)::text
  FROM journal_entries
  WHERE id = ANY(v_entryids) OR reversal_of = ANY(v_entryids);
  INSERT INTO probe
  SELECT 'discard audit row written', '1', count(*)::text
  FROM petty_cash_import_discards WHERE file_hash='post-hash-001';
END
$verify2$;

-- ── INSUFFICIENT_FUND, on its own batch ──────────────────────────────────
DO $verify3$
DECLARE
  v_tenant UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund   UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user   UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_jwt    TEXT := '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}';
  v_batch  UUID; v_msg TEXT;
BEGIN
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'over.xlsx', 'over-hash-001', 'DD/MM/YYYY', 3, v_user)
  RETURNING id INTO v_batch;

  -- Net is positive, but row 2 overdraws mid-file: a net-only check would pass.
  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_voucher_no, raw_name, raw_description, raw_account_type, raw_debit, raw_credit, parsed_date)
  VALUES
    (v_batch, v_tenant, 1, '05/03/2026', 'PV-200', 'A', 'small', 'Electricity', '100',    '', '2026-03-05'),
    (v_batch, v_tenant, 2, '06/03/2026', 'PV-201', 'B', 'huge',  'Electricity', '999999', '', '2026-03-06'),
    (v_batch, v_tenant, 3, '07/03/2026', 'PV-202', 'C', 'refund','4050',        '', '999999', '2026-03-07');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  BEGIN
    PERFORM post_petty_cash_import_batch(v_batch);
    INSERT INTO probe VALUES ('insufficient fund', 'INSUFFICIENT_FUND row 2', 'NO_ERROR_RAISED');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO probe VALUES ('insufficient fund', 'INSUFFICIENT_FUND row 2',
      CASE WHEN v_msg LIKE 'INSUFFICIENT_FUND: row 2 %' THEN 'INSUFFICIENT_FUND row 2'
           ELSE left(v_msg, 70) END);
  END;
  RESET ROLE;

  INSERT INTO probe
  SELECT 'nothing posted after refusal', '0', count(*)::text
  FROM petty_cash_import_lines WHERE batch_id = v_batch AND journal_entry_id IS NOT NULL;
END
$verify3$;

SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS r,
       k, expected, actual
FROM probe
ORDER BY CASE WHEN expected IS NOT DISTINCT FROM actual THEN 1 ELSE 0 END, k;

ROLLBACK;
