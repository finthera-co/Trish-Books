-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — end-to-end database test suite.
--
-- Exercises the real RPCs and triggers against a live schema and asserts the
-- behaviour that unit tests (which only see the SQL text) cannot: posting,
-- tenant isolation, immutability, concurrency, the undo/reverse guards, and the
-- transactions cash-flow sync. Every check RAISEs on failure, so psql / the CI
-- runner exits non-zero. The whole run is wrapped in a transaction and rolled
-- back, so it is non-destructive against any database it points at.
--
-- Run locally:   supabase db query --linked --file supabase/tests/bank_import_e2e.sql
--        or:     psql "$DATABASE_URL" -f supabase/tests/bank_import_e2e.sql
-- CI runs it against a throwaway `supabase db start` instance.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Helper: assert that running `p_sql` raises an error whose message starts with
-- `p_expect` (the error code prefix before the first colon).
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_label text, p_expect text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text;
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'FAIL[%]: expected error % but statement succeeded', p_label, p_expect;
EXCEPTION
  WHEN raise_exception OR foreign_key_violation OR unique_violation OR check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF split_part(v_msg, ':', 1) <> p_expect THEN
      RAISE EXCEPTION 'FAIL[%]: expected % but got "%"', p_label, p_expect, v_msg;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.eq(p_label text, p_got anyelement, p_want anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'FAIL[%]: got % expected %', p_label, p_got, p_want;
  END IF;
END $$;

-- Helper: provision a tenant with a Company-Admin auth session + bank chart.
CREATE OR REPLACE FUNCTION pg_temp.new_tenant(p_name text, OUT tenant_id uuid, OUT user_id uuid, OUT auth_id uuid, OUT bank_id uuid)
LANGUAGE plpgsql AS $$
DECLARE v_role uuid;
BEGIN
  SELECT id INTO v_role FROM public.roles WHERE role_name = 'Primary Admin' LIMIT 1;
  auth_id := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (auth_id);
  INSERT INTO public.tenants(company_name) VALUES (p_name) RETURNING id INTO tenant_id;
  -- Bootstrap the tenant's first admin. The user-insert privilege guard is
  -- designed to reject exactly this (no authenticated caller), so disable it for
  -- the single seed insert — the same approach used to provision the first admin
  -- of any tenant. Transaction-scoped; the whole suite rolls back anyway.
  ALTER TABLE public.users DISABLE TRIGGER enforce_user_insert;
  INSERT INTO public.users(tenant_id, email, first_name, last_name, role_id, auth_user_id)
    VALUES (tenant_id, lower(replace(p_name,' ','')) || '@x.com', p_name, 'Admin', v_role, auth_id)
    RETURNING id INTO user_id;
  ALTER TABLE public.users ENABLE TRIGGER enforce_user_insert;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', auth_id)::text, true);
  PERFORM public.setup_bank_import_chart();
  INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type, account_subtype,
                              account_path, account_level, normal_balance, is_active, is_postable)
    VALUES (tenant_id, '1100', 'Bank', 'Asset', 'Bank', '1100 Bank', 1, 'Debit', true, true)
    RETURNING id INTO bank_id;
END $$;

-- Helper: create + claim + populate + post a one-line batch, return batch id.
CREATE OR REPLACE FUNCTION pg_temp.post_line(
  p_tenant uuid, p_user uuid, p_bank uuid, p_acct uuid, p_date date,
  p_debit numeric, p_credit numeric, p_tier smallint, p_suspense text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_b uuid; v_m int := extract(month from p_date); v_y int := extract(year from p_date);
BEGIN
  INSERT INTO public.bank_statement_batches(tenant_id, bank_account_id, storage_path, sheet_periods,
      total_debit, total_credit, row_count, created_by)
    VALUES (p_tenant, p_bank, p_tenant||'/f', format('[{"sheet_name":"S","month":%s,"year":%s}]', v_m, v_y)::jsonb,
            p_debit, p_credit, 1, p_user)
    RETURNING id INTO v_b;
  PERFORM public.claim_bank_statement_periods(v_b, format('[{"month":%s,"year":%s}]', v_m, v_y)::jsonb);
  INSERT INTO public.bank_statement_lines(tenant_id, batch_id, sheet_name, period_month, period_year,
      row_index, txn_date, description, debit, credit, resolution_tier, resolved_account_id, suspense_reason)
    VALUES (p_tenant, v_b, 'S', v_m, v_y, 3, p_date, 'row', p_debit, p_credit, p_tier,
            CASE WHEN p_tier IN (1,2) THEN p_acct END, p_suspense);
  PERFORM public.import_bank_statement_post(v_b, p_user);
  RETURN v_b;
END $$;

DO $main$
DECLARE
  t record; t2 record;
  v_b uuid; v_b2 uuid; v_salary uuid; v_guava uuid; v_upay uuid; v_udep uuid;
  v_line uuid; v_n int; v_dr numeric; v_cr numeric; v_jl uuid; v_other uuid;
BEGIN
  -- ══ 1. Setup + name resolution ══════════════════════════════════════════
  SELECT * INTO t FROM pg_temp.new_tenant('Acme One');
  SELECT id INTO v_salary FROM public.accounts WHERE tenant_id=t.tenant_id AND account_code='6260';
  SELECT id INTO v_guava  FROM public.accounts WHERE tenant_id=t.tenant_id AND account_code='4040';
  SELECT id INTO v_upay   FROM public.accounts WHERE tenant_id=t.tenant_id AND account_code='6010';
  SELECT id INTO v_udep   FROM public.accounts WHERE tenant_id=t.tenant_id AND account_code='4010';
  PERFORM pg_temp.eq('setup.salary_exists', (v_salary IS NOT NULL), true);

  -- account NAME resolves via the global name-variant seed
  PERFORM pg_temp.eq('resolve.salaries',
    (SELECT am.account_id FROM public.bank_category_canonical_map cm
       JOIN public.bank_category_account_map am ON am.canonical_category=cm.canonical_category AND am.tenant_id=t.tenant_id
      WHERE cm.raw_variant=public.bank_normalize_text('Salaries')
        AND (cm.tenant_id IS NULL OR cm.tenant_id=t.tenant_id) LIMIT 1), v_salary);
  PERFORM pg_temp.eq('resolve.unknown_stays_null',
    (SELECT count(*) FROM public.bank_category_canonical_map
      WHERE raw_variant=public.bank_normalize_text('Miscellaneous Stuff')
        AND (tenant_id IS NULL OR tenant_id=t.tenant_id))::int, 0);

  -- ══ 2. Posting: resolved → ledger, suspense → directional ════════════════
  v_b := pg_temp.post_line(t.tenant_id, t.user_id, t.bank_id, v_salary, '2025-06-05', 5000, 0, 1::smallint);
  PERFORM pg_temp.eq('post.salary_debit',
    (SELECT sum(debit) FROM public.journal_lines WHERE account_id=v_salary), 5000::numeric);
  PERFORM pg_temp.eq('post.bank_credit',
    (SELECT sum(credit) FROM public.journal_lines WHERE account_id=t.bank_id), 5000::numeric);

  v_b2 := pg_temp.post_line(t.tenant_id, t.user_id, t.bank_id, NULL, '2025-07-06', 150, 0, 3::smallint, 'no_category_no_rule');
  PERFORM pg_temp.eq('post.suspense_to_unrec_payments',
    (SELECT sum(debit) FROM public.journal_lines WHERE account_id=v_upay), 150::numeric);

  -- balanced: every generated JE has Σdebit = Σcredit
  SELECT count(*) INTO v_n FROM (
    SELECT jl.journal_entry_id FROM public.journal_lines jl
      JOIN public.bank_statement_lines l ON l.journal_entry_id=jl.journal_entry_id
     WHERE l.tenant_id=t.tenant_id GROUP BY jl.journal_entry_id
    HAVING abs(sum(jl.debit)-sum(jl.credit))>0.005) bad;
  PERFORM pg_temp.eq('post.all_balanced', v_n, 0);

  -- ══ 3. Transactions cash-flow sync ═══════════════════════════════════════
  PERFORM pg_temp.eq('txsync.expense_amount',
    (SELECT COALESCE(sum(amount),0) FROM public.transactions WHERE tenant_id=t.tenant_id AND type='expense'), 5150::numeric);
  PERFORM pg_temp.eq('txsync.monthly_financials_expense',
    (SELECT COALESCE(sum(total_expense),0) FROM public.monthly_financials WHERE tenant_id=t.tenant_id), 5150::numeric);

  -- ══ 4. Immutability of posted records ════════════════════════════════════
  SELECT id INTO v_line FROM public.bank_statement_lines WHERE batch_id=v_b LIMIT 1;
  PERFORM pg_temp.expect_error('immutable.edit_posted_line', 'IMMUTABLE_POSTED_LINE',
    format('UPDATE public.bank_statement_lines SET debit=999 WHERE id=%L', v_line));
  PERFORM pg_temp.expect_error('immutable.delete_posted_batch', 'IMMUTABLE_POSTED_BATCH',
    format('DELETE FROM public.bank_statement_batches WHERE id=%L', v_b));

  -- ══ 5. Concurrency: one active batch per account+period ═══════════════════
  PERFORM pg_temp.expect_error('concurrency.duplicate_period', 'PERIOD_ALREADY_IMPORTED',
    format($q$SELECT public.claim_bank_statement_periods(
      (SELECT id FROM public.bank_statement_batches WHERE tenant_id=%L LIMIT 1),
      '[{"month":6,"year":2025}]'::jsonb)$q$, t.tenant_id));

  -- ══ 6. Tenant isolation: cannot post into another tenant's account ═══════
  SELECT * INTO t2 FROM pg_temp.new_tenant('Acme Two');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', t.auth_id)::text, true);
  DECLARE v_bad uuid; v_other_salary uuid;
  BEGIN
    SELECT id INTO v_other_salary FROM public.accounts WHERE tenant_id=t2.tenant_id AND account_code='6260';
    INSERT INTO public.bank_statement_batches(tenant_id,bank_account_id,storage_path,sheet_periods,total_debit,total_credit,row_count,created_by)
      VALUES(t.tenant_id,t.bank_id,t.tenant_id||'/x','[{"sheet_name":"S","month":9,"year":2025}]'::jsonb,100,0,1,t.user_id) RETURNING id INTO v_bad;
    PERFORM public.claim_bank_statement_periods(v_bad,'[{"month":9,"year":2025}]'::jsonb);
    INSERT INTO public.bank_statement_lines(tenant_id,batch_id,sheet_name,period_month,period_year,row_index,txn_date,description,debit,credit,resolution_tier,resolved_account_id)
      VALUES(t.tenant_id,v_bad,'S',9,2025,3,'2025-09-02','steal',100,0,1,v_other_salary);
    PERFORM pg_temp.expect_error('isolation.cross_tenant_account','CROSS_TENANT_ACCOUNT',
      format('SELECT public.import_bank_statement_post(%L,%L)', v_bad, t.user_id));
  END;

  -- ══ 7. Undo guards ═══════════════════════════════════════════════════════
  -- 7a. clean batch undoes (deletes JEs + transactions)
  DECLARE v_clean uuid;
  BEGIN
    v_clean := pg_temp.post_line(t.tenant_id, t.user_id, t.bank_id, v_salary, '2025-10-05', 3000, 0, 1::smallint);
    PERFORM public.undo_bank_statement_batch(v_clean, 'test');
    PERFORM pg_temp.eq('undo.jes_deleted',
      (SELECT count(*) FROM public.journal_entries je JOIN public.bank_statement_lines l ON l.journal_entry_id=je.id WHERE l.batch_id=v_clean)::int, 0);
    PERFORM pg_temp.eq('undo.transactions_deleted',
      (SELECT count(*) FROM public.transactions WHERE tenant_id=t.tenant_id AND date='2025-10-05')::int, 0);
  END;

  -- 7b. closed period blocks undo AND reverse
  DECLARE v_closed uuid;
  BEGIN
    v_closed := pg_temp.post_line(t.tenant_id, t.user_id, t.bank_id, v_salary, '2025-11-05', 4000, 0, 1::smallint);
    INSERT INTO public.fiscal_periods(tenant_id,name,period_start,period_end,status)
      VALUES(t.tenant_id,'Nov25','2025-11-01','2025-11-30','closed');
    PERFORM pg_temp.expect_error('undo.closed_period','CLOSED_PERIOD',
      format('SELECT public.undo_bank_statement_batch(%L,%L)', v_closed, 'x'));
    PERFORM pg_temp.expect_error('reverse.closed_period','CLOSED_PERIOD',
      format('SELECT public.void_bank_statement_batch(%L,%L)', v_closed, 'x'));
  END;

  -- 7c. reconciled line blocks undo
  DECLARE v_rec uuid; v_recjl uuid;
  BEGIN
    v_rec := pg_temp.post_line(t.tenant_id, t.user_id, t.bank_id, v_salary, '2025-12-05', 7000, 0, 1::smallint);
    SELECT jl.id INTO v_recjl FROM public.journal_lines jl
      JOIN public.bank_statement_lines l ON l.journal_entry_id=jl.journal_entry_id
     WHERE l.batch_id=v_rec AND jl.account_id=v_salary LIMIT 1;
    INSERT INTO public.bank_feed_transactions(tenant_id,bank_account_id,transaction_date,amount,state,status,matched_journal_line_id)
      VALUES(t.tenant_id,t.bank_id,'2025-12-05',7000,'matched','matched',v_recjl);
    PERFORM pg_temp.expect_error('undo.reconciled','RECONCILED',
      format('SELECT public.undo_bank_statement_batch(%L,%L)', v_rec, 'x'));
  END;

  -- ══ 8. Reverse nets to zero and clears the cash-flow rows ════════════════
  DECLARE v_rev uuid;
  BEGIN
    v_rev := pg_temp.post_line(t.tenant_id, t.user_id, t.bank_id, v_salary, '2026-01-05', 2500, 0, 1::smallint);
    PERFORM public.void_bank_statement_batch(v_rev, 'reverse test');
    PERFORM pg_temp.eq('reverse.salary_nets_zero',
      (SELECT COALESCE(sum(debit)-sum(credit),0) FROM public.journal_lines jl
         JOIN public.journal_entries je ON je.id=jl.journal_entry_id
        WHERE je.tenant_id=t.tenant_id AND jl.account_id=v_salary AND je.entry_date='2026-01-05'), 0::numeric);
    PERFORM pg_temp.eq('reverse.transactions_gone',
      (SELECT count(*) FROM public.transactions WHERE tenant_id=t.tenant_id AND date='2026-01-05')::int, 0);
  END;

  -- ══ 9. Clear a suspense item → re-points the leg IN PLACE, no new entry ═══
  -- Clearing must not create a second journal. It re-points the original
  -- entry's suspense leg to the final account, so the ledger carries one row
  -- per transaction and there is no reclass credit that could be orphaned.
  DECLARE
    v_line_b2 uuid;
    v_je_b2   uuid;
    v_susp    uuid;
    v_je_cnt  int;
  BEGIN
    SELECT id, journal_entry_id INTO v_line_b2, v_je_b2
      FROM public.bank_statement_lines WHERE batch_id=v_b2;
    SELECT bank_import_unrecognized_payment_account_id INTO v_susp
      FROM public.account_settings WHERE tenant_id=t.tenant_id;
    SELECT count(*) INTO v_je_cnt FROM public.journal_entries WHERE tenant_id=t.tenant_id;

    PERFORM public.clear_suspense_lines(ARRAY[v_line_b2], v_salary, 'was salary', NULL);

    PERFORM pg_temp.eq('clear.no_new_journal_entry',
      (SELECT count(*) FROM public.journal_entries WHERE tenant_id=t.tenant_id)::int, v_je_cnt);
    PERFORM pg_temp.eq('clear.no_reclass_entry',
      (SELECT count(*) FROM public.journal_entries
        WHERE tenant_id=t.tenant_id AND source_type='bank_import_reclass')::int, 0);
    -- The suspense leg is gone from the original entry and the final account
    -- carries it instead — one leg, not two.
    PERFORM pg_temp.eq('clear.suspense_leg_gone',
      (SELECT count(*) FROM public.journal_lines
        WHERE journal_entry_id=v_je_b2 AND account_id=v_susp)::int, 0);
    PERFORM pg_temp.eq('clear.target_leg_once',
      (SELECT count(*) FROM public.journal_lines
        WHERE journal_entry_id=v_je_b2 AND account_id=v_salary)::int, 1);
    -- Double entry still holds on the entry that was edited.
    PERFORM pg_temp.eq('clear.entry_balanced',
      (SELECT COALESCE(sum(debit)-sum(credit),0) FROM public.journal_lines
        WHERE journal_entry_id=v_je_b2), 0::numeric);
    PERFORM pg_temp.eq('clear.mode_in_place',
      (SELECT suspense_cleared_mode FROM public.bank_statement_lines WHERE id=v_line_b2), 'in_place');
    PERFORM pg_temp.eq('clear.no_reclass_link',
      (SELECT reclass_journal_entry_id IS NULL FROM public.bank_statement_lines WHERE id=v_line_b2), true);

    -- Cash flow still mirrors the final coding exactly once.
    PERFORM pg_temp.eq('clear.expense_unchanged',
      (SELECT COALESCE(sum(amount),0) FROM public.transactions WHERE tenant_id=t.tenant_id AND type='expense' AND date='2025-07-06'), 150::numeric);
    PERFORM pg_temp.eq('clear.no_double_row',
      (SELECT count(*) FROM public.transactions WHERE tenant_id=t.tenant_id AND date='2025-07-06')::int, 1);

    -- Clearing the same line twice is refused.
    PERFORM pg_temp.expect_error('clear.recleared', 'LINE_NOT_OPEN',
      format('SELECT public.clear_suspense_lines(ARRAY[%L]::uuid[], %L::uuid, NULL, NULL)', v_line_b2, v_salary));
  END;

  -- ══ 10. Undo AFTER clearing deletes everything ═══════════════════════════
  -- v_b2 above had its suspense line cleared in place, so there is a single
  -- entry to take back; undo must remove it, its lines, the statement lines and
  -- the cash-flow rows. (A closed-period clearing produces a separate reclass
  -- entry instead, which undo picks up via reclass_journal_entry_id.)
  PERFORM public.undo_bank_statement_batch(v_b2, 'delete the month');
  PERFORM pg_temp.eq('undo_after_clear.jes_gone',
    (SELECT count(*) FROM public.journal_entries je
      JOIN public.bank_statement_lines l ON l.journal_entry_id=je.id WHERE l.batch_id=v_b2)::int, 0);
  PERFORM pg_temp.eq('undo_after_clear.lines_gone',
    (SELECT count(*) FROM public.bank_statement_lines WHERE batch_id=v_b2)::int, 0);
  PERFORM pg_temp.eq('undo_after_clear.cashflow_gone',
    (SELECT count(*) FROM public.transactions WHERE tenant_id=t.tenant_id AND date='2025-07-06')::int, 0);

  RAISE NOTICE 'bank_import_e2e: ALL CHECKS PASSED';
END $main$;

-- If we reached here without an exception, every assertion held.
SELECT 'bank_import_e2e: PASS' AS result;

ROLLBACK;
