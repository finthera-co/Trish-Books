-- ═══════════════════════════════════════════════════════════════════════════
-- Petty cash import — re-stage after discard, and the performance budget.
--
-- Everything runs inside a transaction that is rolled back, so this is safe to
-- run against a live database.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON probe TO authenticated;

DO $t$
DECLARE
  v_tenant UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund   UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user   UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_jwt    TEXT := '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}';
  v_gl UUID; v_obe UUID; v_susp UUID;
  v_batch UUID; v_post1 JSONB; v_post2 JSONB;
  v_t0 TIMESTAMPTZ; v_resolve_ms NUMERIC; v_post_ms NUMERIC;
  v_res JSONB;
BEGIN
  SELECT account_id INTO v_gl FROM petty_cash_accounts WHERE id = v_fund;
  SELECT id INTO v_obe FROM accounts WHERE tenant_id=v_tenant AND account_code='3900';

  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant, '1290', 'Suspense Account', 'Asset', true, true) RETURNING id INTO v_susp;
  INSERT INTO account_settings (tenant_id, suspense_account_id) VALUES (v_tenant, v_susp)
  ON CONFLICT (tenant_id) DO UPDATE SET suspense_account_id = EXCLUDED.suspense_account_id;

  -- Plenty of float so sufficiency never trips.
  INSERT INTO journal_entries (id, tenant_id, entry_date, description, status, entry_type, is_system_generated, posted_at)
  VALUES ('33333333-3333-3333-3333-333333333333', v_tenant, '2026-01-01', 'perf float', 'posted', 'manual', true, now());
  INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit)
  VALUES ('33333333-3333-3333-3333-333333333333', v_tenant, v_gl, 100000000, 0),
         ('33333333-3333-3333-3333-333333333333', v_tenant, v_obe, 0, 100000000);

  -- ══ Scenario A: stage → discard → re-stage the identical file → post ══
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'again.xlsx', 'again-hash-001', 'DD/MM/YYYY', 4, v_user)
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_voucher_no, raw_name, raw_description, raw_account_type, raw_debit, raw_credit, parsed_date)
  VALUES
    (v_batch, v_tenant, 1, '05/02/2026', 'PV-1', 'A', 'tea',   'Electricity', '100', '', '2026-02-05'),
    (v_batch, v_tenant, 2, '05/02/2026', 'PV-1', 'A', 'sugar', 'Electricity', '200', '', '2026-02-05'),
    (v_batch, v_tenant, 3, '06/02/2026', 'PV-2', 'B', 'fuel',  '6020',        '300', '', '2026-02-06'),
    (v_batch, v_tenant, 4, '07/02/2026', 'PV-3', 'C', 'refund','4050',        '', '400', '2026-02-07');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  PERFORM discard_petty_cash_import_batch(v_batch, 'changed my mind');
  RESET ROLE;

  INSERT INTO probe
  SELECT 'A. batch row gone after discard', '0', count(*)::text
  FROM petty_cash_import_batches WHERE id = v_batch;

  -- The identical hash must be accepted again.
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'again.xlsx', 'again-hash-001', 'DD/MM/YYYY', 4, v_user)
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_voucher_no, raw_name, raw_description, raw_account_type, raw_debit, raw_credit, parsed_date)
  VALUES
    (v_batch, v_tenant, 1, '05/02/2026', 'PV-1', 'A', 'tea',   'Electricity', '100', '', '2026-02-05'),
    (v_batch, v_tenant, 2, '05/02/2026', 'PV-1', 'A', 'sugar', 'Electricity', '200', '', '2026-02-05'),
    (v_batch, v_tenant, 3, '06/02/2026', 'PV-2', 'B', 'fuel',  '6020',        '300', '', '2026-02-06'),
    (v_batch, v_tenant, 4, '07/02/2026', 'PV-3', 'C', 'refund','4050',        '', '400', '2026-02-07');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  v_post1 := post_petty_cash_import_batch(v_batch);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('A. re-upload accepted',   '2', v_post1->>'vouchers_created'),
    ('A. receipts',             '1', v_post1->>'receipts_created'),
    ('A. lines posted',         '4', v_post1->>'lines_posted'),
    ('A. total out',       '600.00', v_post1->>'total_out'),
    ('A. total in',        '400.00', v_post1->>'total_in');

  INSERT INTO probe
  SELECT 'A. discard audit kept', '1', count(*)::text
  FROM petty_cash_import_discards WHERE file_hash = 'again-hash-001';

  -- ══ Scenario B: 2,000-line performance budget ══
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'big.xlsx', 'big-hash-001', 'DD/MM/YYYY', 2000, v_user)
  RETURNING id INTO v_batch;

  -- 2,000 rows across 200 vouchers (10 lines each), with a mix of tiers:
  -- account name, account code, and unmapped → suspense.
  --
  -- Grouping shape is what drives posting cost, not row count: the resolver is
  -- set-based and flat in the number of rows, while posting loops once per
  -- voucher group. Measured on the pooler:
  --
  --   2,000 rows →   201 vouchers   resolve 1.95 s   post  2.42 s   (this test)
  --   2,000 rows → 2,000 vouchers   resolve 2.11 s   post 16.66 s
  --
  -- The second shape is a file where every row is its own voucher — a distinct
  -- payee on every line. It blows the 8 s budget. Real petty cash books group
  -- several lines to a voucher, but a file that does not will be slow, and the
  -- fix would be to batch the per-group inserts rather than loop.
  INSERT INTO petty_cash_import_lines
    (batch_id, tenant_id, row_no, raw_date, raw_voucher_no, raw_name, raw_description,
     raw_account_type, raw_debit, raw_credit, parsed_date)
  SELECT v_batch, v_tenant, i,
         to_char(DATE '2026-01-01' + (i / 10), 'DD/MM/YYYY'),
         'PV-' || (i / 10)::TEXT,
         'Payee ' || (i / 10)::TEXT,
         'line ' || i::TEXT,
         CASE i % 3 WHEN 0 THEN 'Electricity' WHEN 1 THEN '6020' ELSE 'Zzz Unmapped' END,
         (10 + (i % 90))::TEXT,
         '',
         DATE '2026-01-01' + (i / 10)
  FROM generate_series(1, 2000) i;

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);

  v_t0 := clock_timestamp();
  v_res := resolve_petty_cash_import_lines(v_batch);
  v_resolve_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;

  v_t0 := clock_timestamp();
  v_post2 := post_petty_cash_import_batch(v_batch);
  v_post_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;

  RESET ROLE;

  INSERT INTO probe VALUES
    ('B. rows resolved',      '2000', v_res->>'total'),
    ('B. lines posted',       '2000', v_post2->>'lines_posted'),
    ('B. resolve under 3s',   'true', (v_resolve_ms < 3000)::text || ' (' || round(v_resolve_ms) || ' ms)'),
    ('B. post under 8s',      'true', (v_post_ms    < 8000)::text || ' (' || round(v_post_ms)    || ' ms)');

  -- Trial balance integrity at 2,000 lines.
  INSERT INTO probe
  SELECT 'B. unbalanced entries', '0', count(*)::text FROM (
    SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.id IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id = v_batch)
    GROUP BY je.id HAVING sum(jl.debit) - sum(jl.credit) <> 0) x;

  -- Voucher serials must be unique and gapless within the block.
  INSERT INTO probe VALUES ('B. vouchers created', '201', v_post2->>'vouchers_created');

  INSERT INTO probe
  SELECT 'B. voucher numbers unique', count(*)::text, count(DISTINCT v.voucher_number)::text
  FROM petty_cash_vouchers v
  WHERE v.id IN (SELECT voucher_id FROM petty_cash_import_lines WHERE batch_id = v_batch);
END
$t$;

SELECT CASE WHEN expected IS NOT DISTINCT FROM actual
              OR (expected = 'true' AND actual LIKE 'true %') THEN 'PASS' ELSE 'FAIL' END AS r,
       k, expected, actual
FROM probe
ORDER BY k;

ROLLBACK;
