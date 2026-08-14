BEGIN;
CREATE TEMP TABLE probe (k TEXT, expected TEXT, actual TEXT) ON COMMIT DROP;
GRANT INSERT, SELECT ON probe TO authenticated;
DO $t$
DECLARE
  v_tenant UUID := '375600ca-b860-461d-b423-9a1f6e05c950';
  v_fund   UUID;
  v_user   UUID;
  v_jwt    TEXT;
  v_batch  UUID; v_post JSONB; v_bal NUMERIC; v_bal0 NUMERIC;
BEGIN
  SELECT id INTO v_fund FROM petty_cash_accounts WHERE tenant_id=v_tenant LIMIT 1;
  -- This fund carries real posted activity, so assert MOVEMENT, not absolutes.
  SELECT coalesce(sum(jl.debit - jl.credit), 0) INTO v_bal0
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
  WHERE jl.account_id=(SELECT account_id FROM petty_cash_accounts WHERE id=v_fund)
    AND je.status='posted' AND je.tenant_id=v_tenant;
  SELECT id, auth_user_id INTO v_user, v_jwt FROM users WHERE tenant_id=v_tenant AND auth_user_id IS NOT NULL LIMIT 1;
  v_jwt := '{"sub":"' || v_jwt || '","role":"authenticated"}';

  -- A historical book: outflows first, a top-up only later. The fund holds
  -- nothing in this system, so the first row overdraws it.
  INSERT INTO petty_cash_import_batches
    (tenant_id, petty_cash_account_id, file_name, file_hash, date_format, row_count,
     imported_by, allow_negative_balance)
  VALUES (v_tenant, v_fund, 'historical.xlsx','hist-hash','DD/MM/YYYY',3, v_user, true)
  RETURNING id INTO v_batch;

  INSERT INTO petty_cash_import_lines
    (batch_id,tenant_id,row_no,raw_date,raw_voucher_no,raw_name,raw_description,raw_account_type,raw_debit,raw_credit,parsed_date)
  VALUES
    (v_batch,v_tenant,1,'02/01/2026','PV-1','Sunil','fuel',   'Fuel Charges','12,000','','2026-01-02'),
    (v_batch,v_tenant,2,'03/01/2026','PV-2','Nimal','postage','Postage & Courier','3,000','','2026-01-03'),
    (v_batch,v_tenant,3,'10/01/2026','PV-3','Bank','top up',  '1100','','20,000','2026-01-10');

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims', v_jwt, true);
  PERFORM resolve_petty_cash_import_lines(v_batch);
  v_post := post_petty_cash_import_batch(v_batch);
  v_bal := get_petty_cash_balance(v_fund);
  RESET ROLE;

  INSERT INTO probe VALUES
    ('posts despite no float',   '2',        v_post->>'vouchers_created'),
    ('receipt from the sheet',   '1',        v_post->>'receipts_created'),
    ('lowest balance is 15000 below start', '-15000.00',
       ((v_post->>'lowest_balance')::numeric - v_bal0)::text),
    ('opening float still needed', 'true',
       ((v_post->>'opening_float_needed')::numeric > 0)::text),
    ('closing moves by net 5000', '5000.00',
       ((v_post->>'closing_balance')::numeric - v_bal0)::text),
    ('ledger agrees',            '5000.00',  (v_bal - v_bal0)::text);

  INSERT INTO probe
  SELECT 'trial balance flat', '0', count(*)::text FROM (
    SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.id IN (SELECT journal_entry_id FROM petty_cash_import_lines WHERE batch_id=v_batch)
    GROUP BY je.id HAVING sum(jl.debit)-sum(jl.credit) <> 0) x;
END $t$;
SELECT CASE WHEN expected IS NOT DISTINCT FROM actual THEN 'PASS' ELSE 'FAIL' END AS r, k, expected, actual
FROM probe ORDER BY 1, k;
ROLLBACK;
