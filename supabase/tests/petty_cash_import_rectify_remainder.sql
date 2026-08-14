-- Exclude a row to get a batch posted, then correct it and post the remainder.
BEGIN;
CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON probe TO authenticated;
DO $t$
DECLARE
  v_tenant UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund   UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user   UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_jwt    TEXT := '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}';
  v_gl UUID; v_obe UUID; v_susp UUID; v_batch UUID;
  v_bad UUID; v_total UUID; v_p1 JSONB; v_p2 JSONB; v_err TEXT; v_bal NUMERIC; v_bal0 NUMERIC;
BEGIN
  SELECT account_id INTO v_gl FROM petty_cash_accounts WHERE id=v_fund;
  -- The fund carries real tenant activity, so every balance assertion below is
  -- a DELTA against wherever it happens to stand.
  SELECT coalesce(sum(jl.debit - jl.credit), 0) INTO v_bal0
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
  WHERE jl.account_id=v_gl AND je.status='posted' AND je.tenant_id=v_tenant;
  SELECT id INTO v_obe FROM accounts WHERE tenant_id=v_tenant AND account_code='3900';
  INSERT INTO accounts (tenant_id,account_code,account_name,account_type,is_postable,is_active)
  VALUES (v_tenant,'1290','Suspense Account','Asset',true,true) RETURNING id INTO v_susp;
  INSERT INTO account_settings (tenant_id,suspense_account_id) VALUES (v_tenant,v_susp)
  ON CONFLICT (tenant_id) DO UPDATE SET suspense_account_id=EXCLUDED.suspense_account_id;
  INSERT INTO journal_entries (id,tenant_id,entry_date,description,status,entry_type,is_system_generated,posted_at)
  VALUES ('66666666-6666-6666-6666-666666666666',v_tenant,'2024-01-01','float','posted','manual',true,now());
  INSERT INTO journal_lines (journal_entry_id,tenant_id,account_id,debit,credit)
  VALUES ('66666666-6666-6666-6666-666666666666',v_tenant,v_gl,100000,0),
         ('66666666-6666-6666-6666-666666666666',v_tenant,v_obe,0,100000);

  INSERT INTO petty_cash_import_batches
    (tenant_id,petty_cash_account_id,file_name,file_hash,date_format,row_count,imported_by,amount_mode,grouping_mode)
  VALUES (v_tenant,v_fund,'rect.xlsx','rect-hash','EXCEL_SERIAL',4,v_user,'single_out','row')
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id,tenant_id,row_no,raw_date,raw_description,raw_account_type,raw_amount,parsed_date)
  VALUES
    (v_batch,v_tenant,1,'2024-05-02','diesel','Electricity','430','2024-05-02'),
    (v_batch,v_tenant,2,'2024-05-03','paper','6020','200','2024-05-03'),
    (v_batch,v_tenant,3,'31/05/204','fuel','Electricity','920','0204-05-31'),          -- typo
    (v_batch,v_tenant,4,'GRAND TOTAL','total','Electricity','1550',NULL);              -- not a txn

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  RESET ROLE;

  SELECT id INTO v_bad   FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=3;
  SELECT id INTO v_total FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=4;

  -- Hold both blocked rows back so the good ones can post.
  UPDATE petty_cash_import_lines SET status='excluded' WHERE id IN (v_bad, v_total);

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_p1 := post_petty_cash_import_batch(v_batch);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('1st post: vouchers', '2', v_p1->>'vouchers_created'),
    ('1st post: out',      '630.00', v_p1->>'total_out'),
    ('1st post: excluded', '2', v_p1->>'lines_excluded');

  -- Posting again with nothing ready must refuse, not silently succeed.
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  BEGIN
    PERFORM post_petty_cash_import_batch(v_batch);
    INSERT INTO probe VALUES ('re-post with nothing ready','NOTHING_TO_POST','POSTED AGAIN');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO probe VALUES ('re-post with nothing ready','NOTHING_TO_POST', split_part(v_err,':',1));
  END;

  -- Rectify the typo: correct the derived date, keep the raw cell verbatim.
  PERFORM rectify_petty_cash_import_line(v_bad, DATE '2024-05-31', NULL);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  RESET ROLE;

  INSERT INTO probe
  SELECT 'rectified row now ok', 'ok', status FROM petty_cash_import_lines WHERE id=v_bad;
  INSERT INTO probe
  SELECT 'raw date preserved', '31/05/204', raw_date FROM petty_cash_import_lines WHERE id=v_bad;
  INSERT INTO probe
  SELECT 'batch still posted', 'posted', status FROM petty_cash_import_batches WHERE id=v_batch;
  INSERT INTO probe
  SELECT 'already-posted rows untouched', '2', count(*)::text
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND status='posted';

  -- Post the remainder.
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_p2 := post_petty_cash_import_batch(v_batch);
  v_bal := get_petty_cash_balance(v_fund);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('2nd post: only the fixed row', '1', v_p2->>'vouchers_created'),
    ('2nd post: out is this run only', '920.00', v_p2->>'total_out'),
    ('2nd post: lines', '1', v_p2->>'lines_posted');

  INSERT INTO probe
  SELECT 'no double posting', '3', count(*)::text
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND status='posted';
  INSERT INTO probe
  SELECT 'total vouchers for batch', '3', count(DISTINCT voucher_id)::text
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND voucher_id IS NOT NULL;
  INSERT INTO probe VALUES ('fund moved by float less spend',
    '98450.00', (v_bal - v_bal0)::text);
  INSERT INTO probe
  SELECT 'grand total row still excluded', 'excluded', status FROM petty_cash_import_lines WHERE id=v_total;
  INSERT INTO probe
  SELECT 'trial balance flat', '0', count(*)::text FROM (
    SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.id IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch)
    GROUP BY je.id HAVING sum(jl.debit)-sum(jl.credit) <> 0) x;

  -- A posted line can no longer be rectified.
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  BEGIN
    PERFORM rectify_petty_cash_import_line(v_bad, DATE '2024-06-01', NULL);
    INSERT INTO probe VALUES ('rectify a posted line','LINE_POSTED','ALLOWED');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO probe VALUES ('rectify a posted line','LINE_POSTED', split_part(v_err,':',1));
  END;
  RESET ROLE;
END $t$;
SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS r, k, expected, actual
FROM probe ORDER BY 1, k;
ROLLBACK;
