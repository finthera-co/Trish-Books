-- Regression: the two defects a real 271-row book exposed.
BEGIN;
CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON probe TO authenticated;
DO $t$
DECLARE
  v_tenant UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund   UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user   UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_jwt    TEXT := '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}';
  v_gl UUID; v_obe UUID; v_susp UUID; v_batch UUID; v_err TEXT; v_res JSONB;
BEGIN
  SELECT account_id INTO v_gl FROM petty_cash_accounts WHERE id=v_fund;
  SELECT id INTO v_obe FROM accounts WHERE tenant_id=v_tenant AND account_code='3900';
  INSERT INTO accounts (tenant_id,account_code,account_name,account_type,is_postable,is_active)
  VALUES (v_tenant,'1290','Suspense Account','Asset',true,true) RETURNING id INTO v_susp;
  INSERT INTO account_settings (tenant_id,suspense_account_id) VALUES (v_tenant,v_susp)
  ON CONFLICT (tenant_id) DO UPDATE SET suspense_account_id=EXCLUDED.suspense_account_id;
  INSERT INTO journal_entries (id,tenant_id,entry_date,description,status,entry_type,is_system_generated,posted_at)
  VALUES ('55555555-5555-5555-5555-555555555555',v_tenant,'2024-01-01','float','posted','manual',true,now());
  INSERT INTO journal_lines (journal_entry_id,tenant_id,account_id,debit,credit)
  VALUES ('55555555-5555-5555-5555-555555555555',v_tenant,v_gl,1000000,0),
         ('55555555-5555-5555-5555-555555555555',v_tenant,v_obe,0,1000000);

  INSERT INTO petty_cash_import_batches
    (tenant_id,petty_cash_account_id,file_name,file_hash,date_format,row_count,imported_by,
     amount_mode,grouping_mode)
  VALUES (v_tenant,v_fund,'guard.xlsx','guard-hash','EXCEL_SERIAL',3,v_user,'single_out','row')
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id,tenant_id,row_no,raw_date,raw_description,raw_account_type,raw_amount,parsed_date)
  VALUES
    (v_batch,v_tenant,1,'2024-05-02','diesel','Electricity','430','2024-05-02'),
    -- the "31/05/204" row, as it was actually staged
    (v_batch,v_tenant,2,'31/05/204','diesel','Electricity','920','0204-05-31'),
    -- the grand-total row: unreadable date, already staged
    (v_batch,v_tenant,3,'GRAND TOTAL (April - Dec)','total','Electricity','472771',NULL);

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  v_res := resolve_petty_cash_import_lines(v_batch);
  RESET ROLE;

  INSERT INTO probe
  SELECT 'year 204 now blocks', 'DATE_OUT_OF_RANGE', error_code
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=2;
  INSERT INTO probe
  SELECT 'null date blocks', 'DATE_UNPARSEABLE', error_code
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND row_no=3;
  INSERT INTO probe VALUES ('good row still ok','1', v_res->>'ok');

  -- Reproduce exactly what the UI used to do: force the blocked total row to
  -- 'ok' with an account, leaving its date null.
  UPDATE petty_cash_import_lines
  SET status='ok', resolution_tier='manual', error_code=NULL, error_message=NULL,
      resolved_account_id=(SELECT id FROM accounts WHERE tenant_id=v_tenant AND account_code='6020')
  WHERE batch_id=v_batch AND row_no=3;
  UPDATE petty_cash_import_lines SET status='excluded' WHERE batch_id=v_batch AND row_no=2;

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  BEGIN
    PERFORM post_petty_cash_import_batch(v_batch);
    INSERT INTO probe VALUES ('incomplete line refused','INCOMPLETE_LINES','POSTED ANYWAY');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO probe VALUES ('incomplete line refused','INCOMPLETE_LINES', split_part(v_err,':',1));
  END;
  RESET ROLE;

  INSERT INTO probe
  SELECT 'nothing written', '0', count(*)::text
  FROM petty_cash_import_lines WHERE batch_id=v_batch AND journal_entry_id IS NOT NULL;
END $t$;
SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS r, k, expected, actual
FROM probe ORDER BY 1, k;
ROLLBACK;
