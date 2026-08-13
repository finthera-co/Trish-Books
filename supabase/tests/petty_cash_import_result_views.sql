BEGIN;
CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON probe TO authenticated;
DO $t$
DECLARE
  v_tenant UUID := 'e5e960b0-1072-408f-bc53-8981830ce596';
  v_fund   UUID := '0b63e91f-0490-4805-9733-17b06b1301f1';
  v_user   UUID := '44188d64-f979-4e85-939d-85743096cd74';
  v_jwt    TEXT := '{"sub":"17aaf884-a9c6-45b7-b6a3-de9d5268c329","role":"authenticated"}';
  v_susp UUID; v_batch UUID;
BEGIN
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, is_postable, is_active)
  VALUES (v_tenant,'1290','Suspense Account','Asset',true,true) RETURNING id INTO v_susp;
  INSERT INTO account_settings (tenant_id, suspense_account_id) VALUES (v_tenant, v_susp)
  ON CONFLICT (tenant_id) DO UPDATE SET suspense_account_id = EXCLUDED.suspense_account_id;

  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count, imported_by)
  VALUES (v_tenant, v_fund, 'views.xlsx','views-hash','DD/MM/YYYY',6,v_user) RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id,tenant_id,row_no,raw_date,raw_voucher_no,raw_description,raw_account_type,raw_debit,raw_credit,parsed_date)
  VALUES
    (v_batch,v_tenant,1,'05/02/2026','PV-1','ok by name','Electricity','100','','2026-02-05'),
    (v_batch,v_tenant,2,'05/02/2026','PV-2','ok by code','6020','100','','2026-02-05'),
    (v_batch,v_tenant,3,'05/02/2026','PV-3','to suspense','Zzz Nothing','100','','2026-02-05'),
    (v_batch,v_tenant,4,'05/02/2026','PV-4','blocked both sides','Electricity','100','50','2026-02-05'),
    (v_batch,v_tenant,5,'05/02/2026','PV-5','blocked bad date','Electricity','100','',NULL),
    (v_batch,v_tenant,6,'05/02/2026','PV-6','excluded later','Electricity','100','','2026-02-05');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  RESET ROLE;
  UPDATE petty_cash_import_lines SET status='excluded' WHERE batch_id=v_batch AND row_no=6;

  -- The exact predicates the grid's PostgREST filters compile to.
  INSERT INTO probe
  SELECT 'recognized', '2', count(*)::text FROM petty_cash_import_lines
  WHERE batch_id=v_batch AND status IN ('ok','posted') AND resolution_tier <> 'suspense';

  INSERT INTO probe
  SELECT 'unrecognized', '3', count(*)::text FROM petty_cash_import_lines
  WHERE batch_id=v_batch AND (status='blocked' OR resolution_tier='suspense');

  INSERT INTO probe
  SELECT 'excluded', '1', count(*)::text FROM petty_cash_import_lines
  WHERE batch_id=v_batch AND status='excluded';

  -- Nothing may fall in both buckets, and the three must cover every row.
  INSERT INTO probe
  SELECT 'no row in both buckets', '0', count(*)::text FROM petty_cash_import_lines
  WHERE batch_id=v_batch
    AND (status IN ('ok','posted') AND resolution_tier <> 'suspense')
    AND (status='blocked' OR resolution_tier='suspense');

  INSERT INTO probe
  SELECT 'buckets cover every row', '6', (
    (SELECT count(*) FROM petty_cash_import_lines WHERE batch_id=v_batch AND status IN ('ok','posted') AND resolution_tier <> 'suspense')
  + (SELECT count(*) FROM petty_cash_import_lines WHERE batch_id=v_batch AND (status='blocked' OR resolution_tier='suspense'))
  + (SELECT count(*) FROM petty_cash_import_lines WHERE batch_id=v_batch AND status='excluded'))::text;
END $t$;
SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS r, k, expected, actual
FROM probe ORDER BY 1, k;
ROLLBACK;
