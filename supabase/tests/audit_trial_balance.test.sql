-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT TRIAL BALANCE + STATEMENT OF COMPREHENSIVE INCOME — database test suite
-- (rpc_trial_balance, rpc_fs_statement, rpc_fs_coverage, fs_line_accounts
-- unique-mapping trigger).
--
-- Builds a fixture tenant (plus a second tenant for cross-tenant checks) and
-- exercises the 18 cases in PART 4.1. Every failure RAISEs, so psql / the CI
-- runner exits non-zero. Wrapped in BEGIN;...ROLLBACK; — non-destructive.
--
-- Run locally:   supabase db query --linked --file supabase/tests/audit_trial_balance.test.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_label text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    v_succeeded := false;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'FAIL[%]: expected an error but statement succeeded', p_label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.eq(p_label text, p_got anyelement, p_want anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'FAIL[%]: got % expected %', p_label, p_got, p_want;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_label text, p_cond boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_cond THEN
    RAISE EXCEPTION 'FAIL[%]: condition was false', p_label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.new_fs_tenant(p_name text, OUT tenant_id uuid, OUT user_id uuid, OUT auth_id uuid)
LANGUAGE plpgsql AS $$
DECLARE v_role uuid;
BEGIN
  SELECT id INTO v_role FROM public.roles WHERE role_name = 'Primary Admin' LIMIT 1;
  auth_id := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (auth_id);
  INSERT INTO public.tenants(company_name) VALUES (p_name) RETURNING id INTO tenant_id;
  ALTER TABLE public.users DISABLE TRIGGER enforce_user_insert;
  INSERT INTO public.users(tenant_id, email, first_name, last_name, role_id, auth_user_id)
    VALUES (tenant_id, lower(replace(p_name, ' ', '')) || '@fstest.com', p_name, 'Admin', v_role, auth_id)
    RETURNING id INTO user_id;
  ALTER TABLE public.users ENABLE TRIGGER enforce_user_insert;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.new_account(
  p_tenant uuid, p_code text, p_name text, p_type text, p_is_contra boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type, account_level, account_path, is_postable, is_active, is_contra)
    VALUES (p_tenant, p_code, p_name, p_type, 1, p_code || ' ' || p_name, true, true, p_is_contra)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.new_entry(
  p_tenant uuid, p_user uuid, p_date date, p_desc text, p_status text DEFAULT 'posted'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.journal_entries(tenant_id, entry_date, description, status, created_by, posted_at)
    VALUES (p_tenant, p_date, p_desc, p_status, p_user, CASE WHEN p_status = 'posted' THEN now() END)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DO $main$
DECLARE
  tA record; tB record;
  cash uuid; sales uuid; sales_discount uuid; cogs uuid; admin_exp uuid; dormant uuid; no_history uuid;
  period_id uuid; period_id2 uuid;
  je1 uuid; je2 uuid; je3 uuid; je4 uuid; je5 uuid; je6 uuid; je7 uuid; je8 uuid;
  v_row record;
  v_closing numeric; v_variance numeric; v_has_audit boolean; v_ledger numeric; v_audit numeric;
  v_n int; v_stmt_id uuid; v_profit numeric; v_tb_pnl numeric;
BEGIN
  -- ══ Fixture: tenant B (cross-tenant checks only) ═══════════════════════════
  SELECT * INTO tB FROM pg_temp.new_fs_tenant('FS Test Co B');
  PERFORM pg_temp.new_account(tB.tenant_id, '9000', 'B Cash', 'Asset');

  -- ══ Fixture: tenant A ═══════════════════════════════════════════════════════
  SELECT * INTO tA FROM pg_temp.new_fs_tenant('FS Test Co A');

  cash           := pg_temp.new_account(tA.tenant_id, '1000', 'Cash',            'Asset');
  sales          := pg_temp.new_account(tA.tenant_id, '4000', 'Sales Revenue',   'Income');
  sales_discount := pg_temp.new_account(tA.tenant_id, '4900', 'Sales Discounts', 'Income', true); -- contra-revenue
  cogs           := pg_temp.new_account(tA.tenant_id, '5000', 'Cost of Sales',   'Cost of Goods Sold');
  admin_exp      := pg_temp.new_account(tA.tenant_id, '6000', 'Admin Expense',   'Expense');
  dormant        := pg_temp.new_account(tA.tenant_id, '6900', 'Dormant',         'Expense');
  no_history     := pg_temp.new_account(tA.tenant_id, '1900', 'No History Asset','Asset');

  -- Fiscal period covering the test range, with an opening_balances override
  -- on `cash` (audit_opening differs from ledger_opening — case 2) and an
  -- audit-only opening on `no_history` (case 3).
  INSERT INTO public.fiscal_periods(tenant_id, name, period_start, period_end, status)
    VALUES (tA.tenant_id, 'FY Test', '2025-04-01', '2026-03-31', 'open')
    RETURNING id INTO period_id;
  INSERT INTO public.opening_balances(tenant_id, account_id, fiscal_period_id, debit, credit, balance)
    VALUES (tA.tenant_id, cash, period_id, 500, 0, 500); -- audit says 500; ledger history (below) will differ (+400 delta)
  -- Audit overrides are double-entry adjustments in the real world (like the
  -- reference workbook's own audit-opening column, which ties to ~0 despite
  -- differing wildly from the book column) — this -400 is cash's counterpart,
  -- keeping the grand total's audit-opening column self-balancing (case 5).
  INSERT INTO public.opening_balances(tenant_id, account_id, fiscal_period_id, debit, credit, balance)
    VALUES (tA.tenant_id, no_history, period_id, 0, 400, -400); -- no journal history at all for this account

  PERFORM set_config('request.jwt.claim.sub', tA.auth_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Pre-range entry for `cash` -> ledger_opening = 100 (differs from audit's 500).
  je1 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-01-01', 'Pre-range cash');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je1, cash, 100, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je1, sales, 0, 100);

  -- In-range activity.
  je2 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-01', 'Cash sale');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je2, cash, 1000, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je2, sales, 0, 1000);

  je3 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-02', 'Sales discount given');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je3, sales_discount, 50, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je3, cash, 0, 50);

  je4 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-03', 'Cost of sale');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je4, cogs, 300, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je4, cash, 0, 300);

  je5 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-04', 'Admin expense');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je5, admin_exp, 150, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je5, cash, 0, 150);

  -- Case 7: voided entry, excluded.
  je6 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-05', 'Voided entry');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je6, cash, 9999, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je6, sales, 0, 9999);
  UPDATE public.journal_entries SET voided_at = now(), voided_by = tA.user_id, void_reason = 'test' WHERE id = je6;

  -- Case 7: draft entry, excluded.
  je7 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-06', 'Draft entry', 'draft');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je7, cash, 8888, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je7, sales, 0, 8888);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TRIAL BALANCE ASSERTIONS
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Case 1: dormant account has ledger opening (0), no opening_balances row ->
  -- audit = ledger, variance 0, has_audit_row false.
  SELECT ledger_opening, audit_opening, opening_variance, has_audit_row INTO v_row
  FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true) WHERE account_id = admin_exp;
  -- admin_exp has activity (150 debit) in range, own opening 0 either way
  SELECT ledger_opening, audit_opening, opening_variance, has_audit_row
    INTO v_ledger, v_audit, v_variance, v_has_audit
  FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true) WHERE account_id = dormant;
  PERFORM pg_temp.eq('case1.audit_equals_ledger', v_audit, v_ledger);
  PERFORM pg_temp.eq('case1.variance_zero', v_variance, 0::numeric);
  PERFORM pg_temp.eq('case1.has_audit_row_false', v_has_audit, false);

  -- Case 2: cash has an opening_balances row (500) differing from its ledger
  -- history (100) -> variance exact, has_audit_row true.
  SELECT ledger_opening, audit_opening, opening_variance, has_audit_row
    INTO v_ledger, v_audit, v_variance, v_has_audit
  FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true) WHERE account_id = cash;
  PERFORM pg_temp.eq('case2.ledger_opening', v_ledger, 100::numeric);
  PERFORM pg_temp.eq('case2.audit_opening', v_audit, 500::numeric);
  PERFORM pg_temp.eq('case2.variance', v_variance, 400::numeric);
  PERFORM pg_temp.eq('case2.has_audit_row_true', v_has_audit, true);

  -- Case 3: no_history has an audit opening (300) and zero ledger history.
  SELECT ledger_opening, audit_opening INTO v_ledger, v_audit
  FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true) WHERE account_id = no_history;
  PERFORM pg_temp.eq('case3.ledger_opening_zero', v_ledger, 0::numeric);
  PERFORM pg_temp.eq('case3.audit_opening_populated', v_audit, -400::numeric);

  -- Case 4: audit_opening + debit - credit = closing, every row.
  SELECT count(*) INTO v_n FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true)
  WHERE abs((audit_opening + period_debit - period_credit) - closing) > 0.005;
  PERFORM pg_temp.eq('case4.identity_holds_every_row', v_n, 0);

  -- Case 5: balanced ledger -> grand total closing = 0.00.
  SELECT round(SUM(closing), 2) INTO v_closing FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true);
  PERFORM pg_temp.eq('case5.grand_total_zero', v_closing, 0.00::numeric);

  -- Case 6: credit-normal account (sales) shows negative raw Dr-Cr closing.
  SELECT closing INTO v_closing FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true) WHERE account_id = sales;
  PERFORM pg_temp.ok('case6.credit_normal_negative', v_closing < 0);

  -- Case 7: voided/draft entries excluded from period movement.
  SELECT period_debit INTO v_ledger FROM public.rpc_trial_balance('2025-04-01','2026-03-31', 'parent', true, true) WHERE account_id = cash;
  PERFORM pg_temp.ok('case7.voided_draft_excluded', v_ledger < 5000); -- would be >8888+9999 if either leaked in

  -- Case 8: p_date_from outside all fiscal periods -> falls back to ledger
  -- openings (audit_opening = ledger_opening for accounts with no period-scoped
  -- opening_balances row), no error.
  SELECT ledger_opening, audit_opening INTO v_ledger, v_audit
  FROM public.rpc_trial_balance('2020-01-01','2020-12-31', 'parent', true, true) WHERE account_id = admin_exp;
  PERFORM pg_temp.eq('case8.fallback_no_period', v_audit, v_ledger);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- STATEMENT ENGINE ASSERTIONS
  -- ═══════════════════════════════════════════════════════════════════════════

  v_stmt_id := public.rpc_fs_seed_soci();

  -- Case 11: mapping the same account to two lines of one statement is rejected.
  INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id)
    VALUES (tA.tenant_id, (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'REVENUE'), sales);
  PERFORM pg_temp.expect_error('case11.duplicate_mapping_rejected', format(
    $sql$INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id) VALUES ('%s', (SELECT id FROM public.fs_lines WHERE statement_id = '%s' AND line_code = 'COS'), '%s')$sql$,
    tA.tenant_id, v_stmt_id, sales));

  -- Case 16: contra-revenue account mapped onto Revenue nets automatically
  -- (per Treshane's decision) — no special-casing, just another mapped account.
  INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id)
    VALUES (tA.tenant_id, (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'REVENUE'), sales_discount);
  SELECT current_value INTO v_row FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31') WHERE line_code = 'REVENUE';
  -- sales: credit 1100, debit 0 (je1+je2) within/around range... recompute: je1 is pre-range (2025-01-01, excluded from period
  -- movement), je2 in range credit 1000. sales_discount: debit 50 in range. invert sign: (credit-debit) summed =
  -- (1000-0) + (0-50) = 950.
  SELECT current_value INTO v_closing FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31') WHERE line_code = 'REVENUE';
  PERFORM pg_temp.eq('case16.contra_nets_into_revenue', v_closing, 950::numeric);

  -- Map the rest for the tie-out / margin cases.
  INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id)
    VALUES (tA.tenant_id, (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'COS'), cogs);
  INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id)
    VALUES (tA.tenant_id, (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'ADMIN_EXP'), admin_exp);
  -- `dormant` (Expense, zero activity) deliberately left mapped too so it doesn't show as UNMAPPED_ACCOUNT noise.
  INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id)
    VALUES (tA.tenant_id, (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'ADMIN_EXP'), dormant);

  -- Case 9: every P&L account now mapped -> PROFIT_FOR_YEAR ties to the trial
  -- balance's net P&L movement for the same range.
  SELECT current_value INTO v_profit FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31') WHERE line_code = 'PROFIT_FOR_YEAR';
  SELECT SUM(period_credit - period_debit) INTO v_tb_pnl
  FROM public.rpc_trial_balance('2025-04-01','2026-03-31','parent', true, true)
  WHERE account_type IN ('Income','Cost of Goods Sold','Expense','Other Income','Other Expense');
  PERFORM pg_temp.eq('case9.profit_ties_to_trial_balance', round(v_profit,2), round(v_tb_pnl,2));
  PERFORM pg_temp.eq('case9.coverage_clean_no_unmapped', (
    SELECT count(*) FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31') WHERE issue_code = 'UNMAPPED_ACCOUNT')::int, 0);
  PERFORM pg_temp.eq('case9.coverage_clean_no_tieout', (
    SELECT count(*) FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31') WHERE issue_code = 'TIE_OUT_VARIANCE')::int, 0);

  -- Case 13: weighted_average_shares never set -> EPS NULL, MISSING_PARAM warns,
  -- no divide-by-zero (function would have raised otherwise).
  SELECT current_value INTO v_row FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31') WHERE line_code = 'EPS';
  PERFORM pg_temp.ok('case13.eps_null_without_param', v_row IS NULL);
  PERFORM pg_temp.ok('case13.missing_param_warning', EXISTS (
    SELECT 1 FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31') WHERE issue_code = 'MISSING_PARAM'));

  -- Now set the parameter and confirm EPS resolves.
  INSERT INTO public.fs_parameters(tenant_id, fiscal_period_id, key, value)
    VALUES (tA.tenant_id, period_id, 'weighted_average_shares', 100);
  SELECT current_value INTO v_row FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31') WHERE line_code = 'EPS';
  PERFORM pg_temp.ok('case13b.eps_resolves_with_param', v_row IS NOT NULL);

  -- Case 10: unmap COS so an unmapped revenue-side account produces a
  -- coverage error at its exact balance. Use cogs (Cost of Goods Sold, P&L).
  DELETE FROM public.fs_line_accounts
  WHERE tenant_id = tA.tenant_id AND account_id = cogs
    AND line_id IN (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id);
  SELECT amount INTO v_closing FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31')
  WHERE issue_code = 'UNMAPPED_ACCOUNT' AND account_id = cogs;
  -- cogs: debit 300 in range, invert sign (credit-debit) = -300.
  PERFORM pg_temp.eq('case10.unmapped_account_exact_balance', v_closing, -300::numeric);
  -- Re-map for subsequent cases.
  INSERT INTO public.fs_line_accounts(tenant_id, line_id, account_id)
    VALUES (tA.tenant_id, (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'COS'), cogs);

  -- Case 14: revenue zero (out-of-range date with nothing mapped active) ->
  -- margins NULL, not Infinity, not 0. Use a range with zero Revenue movement.
  PERFORM pg_temp.ok('case14.margin_null_when_base_zero', (
    SELECT current_margin FROM public.rpc_fs_statement('SOCI','2020-01-01','2020-12-31') WHERE line_code = 'GROSS_PROFIT'
  ) IS NULL);

  -- Case 15: comparative range omitted -> comparative columns NULL, not a copy of current.
  PERFORM pg_temp.ok('case15.comparative_null_when_omitted', (
    SELECT compare_value FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31') WHERE line_code = 'REVENUE'
  ) IS NULL);
  -- Sanity: WITH a comparative range supplied, comparative is NOT null (assuming any P&L account existed then; here 0 is a valid resolved value, not null).
  PERFORM pg_temp.ok('case15b.comparative_populated_when_given', (
    SELECT compare_value FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31','2020-01-01','2020-12-31') WHERE line_code = 'REVENUE'
  ) IS NOT NULL);

  -- Case 12: fs_line_terms cycle -> CYCLE raised via rpc_fs_coverage (no
  -- partial statement), verified without corrupting the real seeded statement
  -- (rolled back at the very end of this whole script anyway, but scoped
  -- narrowly here so later assertions in this same run aren't affected).
  INSERT INTO public.fs_line_terms(tenant_id, line_id, term_line_id, factor)
    VALUES (tA.tenant_id,
            (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'GROSS_PROFIT'),
            (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'OPERATING_PROFIT'), 1);
  PERFORM pg_temp.ok('case12.cycle_detected', EXISTS (
    SELECT 1 FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31') WHERE issue_code = 'CYCLE'));
  DELETE FROM public.fs_line_terms
  WHERE tenant_id = tA.tenant_id
    AND line_id = (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'GROSS_PROFIT')
    AND term_line_id = (SELECT id FROM public.fs_lines WHERE statement_id = v_stmt_id AND line_code = 'OPERATING_PROFIT');
  -- Confirm the statement evaluates cleanly again post-cleanup.
  PERFORM pg_temp.ok('case12b.no_cycle_after_cleanup', NOT EXISTS (
    SELECT 1 FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31') WHERE issue_code = 'CYCLE'));

  -- Case 17: cross-tenant isolation for all statement/trial-balance RPCs.
  PERFORM set_config('request.jwt.claim.sub', tB.auth_id::text, true);
  PERFORM public.rpc_fs_seed_soci(); -- tenant B needs its own SOCI to exercise isolation, not a "not found" error
  PERFORM pg_temp.eq('case17.tb_cross_tenant_empty', (
    SELECT count(*) FROM public.rpc_trial_balance('2025-04-01','2026-03-31') WHERE account_id IN (cash, sales, cogs))::int, 0);
  PERFORM pg_temp.eq('case17.fs_statement_cross_tenant_isolated', (
    SELECT count(*) FROM public.rpc_fs_statement('SOCI','2025-04-01','2026-03-31')),
    (SELECT count(*) FROM public.fs_lines WHERE statement_id = (SELECT id FROM public.fs_statements WHERE tenant_id = tB.tenant_id AND code = 'SOCI')));
  PERFORM pg_temp.eq('case17.fs_coverage_cross_tenant_empty', (
    SELECT count(*) FROM public.rpc_fs_coverage('SOCI','2025-04-01','2026-03-31') WHERE account_id IN (cash, sales, cogs))::int, 0);
  PERFORM set_config('request.jwt.claim.sub', tA.auth_id::text, true);

  -- Case 18: date_to < date_from; 11-year range — both raise, for both RPCs.
  PERFORM pg_temp.expect_error('case18a.tb_date_to_before_from',
    $sql$SELECT * FROM public.rpc_trial_balance('2026-03-31','2025-04-01')$sql$);
  PERFORM pg_temp.expect_error('case18b.tb_range_exceeds_ten_years',
    $sql$SELECT * FROM public.rpc_trial_balance('2000-01-01','2026-03-31')$sql$);
  PERFORM pg_temp.expect_error('case18c.fs_statement_date_to_before_from',
    $sql$SELECT * FROM public.rpc_fs_statement('SOCI','2026-03-31','2025-04-01')$sql$);
  PERFORM pg_temp.expect_error('case18d.fs_statement_range_exceeds_ten_years',
    $sql$SELECT * FROM public.rpc_fs_statement('SOCI','2000-01-01','2026-03-31')$sql$);

  RAISE NOTICE 'audit_trial_balance.test.sql: ALL CHECKS PASSED';
END $main$;

ROLLBACK;
