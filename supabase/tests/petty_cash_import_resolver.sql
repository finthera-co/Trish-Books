BEGIN;

CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;

DO $verify$
DECLARE
  v_tenant   UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund     UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user     UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_fund_gl  UUID;
  v_gl_code  TEXT;
  v_susp     UUID;
  v_inactive UUID;
  v_dupname  UUID;
  v_pc2_acct UUID;
  v_pc2      UUID;
  v_batch    UUID;
  v_batch2   UUID;
  v_r1       JSONB;
  v_r2       JSONB;
BEGIN
  SELECT account_id INTO v_fund_gl FROM petty_cash_accounts WHERE id = v_fund;
  SELECT account_code INTO v_gl_code FROM accounts WHERE id = v_fund_gl;

  -- ── fixture accounts ────────────────────────────────────────────────────
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant, '1290', 'Suspense Account', 'Asset', true, true) RETURNING id INTO v_susp;
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant, '6999', 'Retired Expense', 'Expense', true, false) RETURNING id INTO v_inactive;
  -- normalizes to the same key as the existing 6080 "Building Rent"
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant, '6081', 'building-rent', 'Expense', true, true) RETURNING id INTO v_dupname;
  -- a second petty cash fund, so PETTY_CASH_GL_TARGET is distinguishable
  -- from SAME_ACCOUNT_VIOLATION
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant, '1150', 'Branch Petty Cash', 'Asset', true, true) RETURNING id INTO v_pc2_acct;
  INSERT INTO petty_cash_accounts (tenant_id, account_id, account_name, float_amount, is_active)
  VALUES (v_tenant, v_pc2_acct, 'Branch Petty Cash', 10000, true) RETURNING id INTO v_pc2;

  INSERT INTO account_settings (tenant_id, suspense_account_id)
  VALUES (v_tenant, v_susp)
  ON CONFLICT (tenant_id) DO UPDATE SET suspense_account_id = EXCLUDED.suspense_account_id;

  INSERT INTO fiscal_periods (tenant_id, name, period_start, period_end, status)
  VALUES (v_tenant, 'FIXTURE Jan 2026', '2026-01-01', '2026-01-31', 'closed');

  -- learned mappings for tiers 1 and 4
  INSERT INTO petty_cash_account_map (tenant_id, match_type, match_key, account_id)
  VALUES (v_tenant, 'account_type', fn_normalize_import_key('Fuel Allowance'),
          (SELECT id FROM accounts WHERE tenant_id=v_tenant AND account_code='6030')),
         (v_tenant, 'description',  fn_normalize_import_key('Monthly water bill'),
          (SELECT id FROM accounts WHERE tenant_id=v_tenant AND account_code='6070'));

  -- ── batch ───────────────────────────────────────────────────────────────
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, amount_orientation, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'fixture.xlsx', 'fixture-hash-001', 'DD/MM/YYYY', 'contra', 19, v_user)
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_voucher_no, raw_name, raw_description,
     raw_account_type, raw_debit, raw_credit, parsed_date)
  VALUES
    -- Phase A blocking cases
    (v_batch, v_tenant,  1, '32/13/2026', 'PV-001', 'A', 'bad date',        'Electricity', '100',   '',    NULL),
    (v_batch, v_tenant,  2, '05/02/2026', 'PV-002', 'B', 'both sides',      'Electricity', '100',   '50',  '2026-02-05'),
    (v_batch, v_tenant,  3, '05/02/2026', 'PV-003', 'C', 'no amount',       'Electricity', '',      '',    '2026-02-05'),
    (v_batch, v_tenant,  4, '05/02/2026', 'PV-004', 'D', 'negative',        'Electricity', '(500.00)','',  '2026-02-05'),
    (v_batch, v_tenant,  5, '05/02/2026', 'PV-005', 'E', 'not numeric',     'Electricity', 'abc',   '',    '2026-02-05'),
    (v_batch, v_tenant,  6, '15/01/2026', 'PV-006', 'F', 'closed period',   'Electricity', '100',   '',    '2026-01-15'),
    -- Phase B ladder, one hit per tier
    (v_batch, v_tenant,  7, '06/02/2026', 'PV-007', 'G', 'fuel top up',     'Fuel Allowance', 'Rs. 1,250.00','', '2026-02-06'),
    (v_batch, v_tenant,  8, '06/02/2026', 'PV-008', 'H', 'ceb bill',        'Electricity', '2,000', '',    '2026-02-06'),
    (v_batch, v_tenant,  9, '06/02/2026', 'PV-009', 'I', 'audit fee',       '6020',        '3000',  '',    '2026-02-06'),
    (v_batch, v_tenant, 10, '06/02/2026', 'PV-010', 'J', 'Monthly water bill', '',         '750',   '',    '2026-02-06'),
    (v_batch, v_tenant, 11, '06/02/2026', 'PV-011', 'K', 'misc',            'Sundry',      '400',   '',    '2026-02-06'),
    -- Phase B ambiguity + Phase C account-level cases
    (v_batch, v_tenant, 12, '07/02/2026', 'PV-012', 'L', 'rent',            'Building Rent','5000', '',    '2026-02-07'),
    (v_batch, v_tenant, 13, '07/02/2026', 'PV-013', 'M', 'same account',    v_gl_code,     '100',   '',    '2026-02-07'),
    (v_batch, v_tenant, 14, '07/02/2026', 'PV-014', 'N', 'header account',  '1600',        '100',   '',    '2026-02-07'),
    (v_batch, v_tenant, 15, '07/02/2026', 'PV-015', 'O', 'inactive',        '6999',        '100',   '',    '2026-02-07'),
    (v_batch, v_tenant, 16, '07/02/2026', 'PV-016', 'P', 'income on out',   '4060',        '100',   '',    '2026-02-07'),
    (v_batch, v_tenant, 17, '07/02/2026', 'PV-017', 'Q', 'expense on in',   '6020',        '',      '100', '2026-02-07'),
    (v_batch, v_tenant, 18, '07/02/2026', 'PV-018', 'R', 'other pc fund',   '1150',        '100',   '',    '2026-02-07'),
    -- duplicate of row 8
    (v_batch, v_tenant, 19, '06/02/2026', 'PV-008', 'H', 'ceb bill',        'Electricity', '2,000', '',    '2026-02-06');

  -- ── resolve, as an authenticated member of the tenant ───────────────────
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}', true);

  v_r1 := resolve_petty_cash_import_lines(v_batch);
  v_r2 := resolve_petty_cash_import_lines(v_batch);   -- idempotence

  RESET ROLE;

  INSERT INTO probe VALUES
    ('counts.total',      '19', v_r1->>'total'),
    ('counts.ok',          '5', v_r1->>'ok'),
    ('counts.suspense',    '1', v_r1->>'suspense'),
    ('counts.blocked',    '13', v_r1->>'blocked'),
    ('counts.duplicates',  '1', v_r1->>'duplicates'),
    ('idempotent',    v_r1::text, v_r2::text),
    ('unmapped_account_types', '["sundry"]', v_r1->>'unmapped_account_types'),
    ('batch.status',   'resolved', (SELECT status FROM petty_cash_import_batches WHERE id=v_batch));

  -- per-row expectations: row_no → code|tier
  INSERT INTO probe
  SELECT 'row ' || lpad(l.row_no::text,2,'0'),
         e.expected,
         coalesce(l.error_code, l.resolution_tier, '?') || ' / ' || l.status ||
           CASE WHEN l.is_duplicate THEN ' / dup' ELSE '' END
  FROM petty_cash_import_lines l
  JOIN (VALUES
    ( 1,'DATE_UNPARSEABLE / blocked'),        ( 2,'AMOUNT_BOTH_SIDES / blocked'),
    ( 3,'AMOUNT_MISSING / blocked'),          ( 4,'AMOUNT_NEGATIVE / blocked'),
    ( 5,'AMOUNT_NOT_NUMERIC / blocked'),      ( 6,'PERIOD_LOCKED / blocked'),
    ( 7,'account_type_map / ok'),             ( 8,'account_name / ok'),
    ( 9,'account_code / ok'),                 (10,'description_map / ok'),
    (11,'suspense / suspense'),               (12,'AMBIGUOUS_ACCOUNT_NAME / blocked'),
    (13,'SAME_ACCOUNT_VIOLATION / blocked'),  (14,'ACCOUNT_NOT_POSTABLE / blocked'),
    (15,'ACCOUNT_INACTIVE / blocked'),        (16,'INVALID_ACCOUNT_TYPE_OUT / blocked'),
    (17,'INVALID_ACCOUNT_TYPE_IN / blocked'), (18,'PETTY_CASH_GL_TARGET / blocked'),
    (19,'account_name / ok / dup')
  ) AS e(rn, expected) ON e.rn = l.row_no
  WHERE l.batch_id = v_batch;

  -- amount/direction derivation
  INSERT INTO probe
  SELECT 'amt/dir row ' || l.row_no, e.expected,
         coalesce(l.amount::text,'null') || ' ' || coalesce(l.direction,'null')
  FROM petty_cash_import_lines l
  JOIN (VALUES (7,'1250.00 out'), (8,'2000.00 out'), (17,'100.00 in')) AS e(rn, expected)
    ON e.rn = l.row_no
  WHERE l.batch_id = v_batch;

  -- ── SUSPENSE_NOT_CONFIGURED: same unmapped row, no suspense account ─────
  UPDATE account_settings SET suspense_account_id = NULL WHERE tenant_id = v_tenant;
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'fixture2.xlsx', 'fixture-hash-002', 'DD/MM/YYYY', 1, v_user)
  RETURNING id INTO v_batch2;
  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_account_type, raw_debit, parsed_date)
  VALUES (v_batch2, v_tenant, 1, '06/02/2026', 'Nothing Maps Here', '100', '2026-02-06');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}', true);
  PERFORM resolve_petty_cash_import_lines(v_batch2);
  RESET ROLE;

  INSERT INTO probe
  SELECT 'no-suspense', 'SUSPENSE_NOT_CONFIGURED / blocked',
         error_code || ' / ' || status
  FROM petty_cash_import_lines WHERE batch_id = v_batch2;

  -- ── FUND_INACTIVE ───────────────────────────────────────────────────────
  UPDATE petty_cash_accounts SET is_active = false WHERE id = v_fund;
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}', true);
  PERFORM resolve_petty_cash_import_lines(v_batch2);
  RESET ROLE;

  INSERT INTO probe
  SELECT 'fund-inactive', 'FUND_INACTIVE / blocked', error_code || ' / ' || status
  FROM petty_cash_import_lines WHERE batch_id = v_batch2;
END
$verify$;

SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS r,
       k, expected, actual
FROM probe
WHERE k <> 'idempotent' OR expected IS DISTINCT FROM actual
ORDER BY CASE WHEN expected IS NOT DISTINCT FROM actual THEN 1 ELSE 0 END, k;

ROLLBACK;
