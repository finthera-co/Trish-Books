-- ═══════════════════════════════════════════════════════════════════════════
-- GENERAL LEDGER REPORT — database test suite (rpc_gl_account_tree,
-- rpc_gl_transactions, rpc_gl_integrity).
--
-- Builds a small fixture tenant (plus a second tenant for cross-tenant /
-- orphan-parent checks) and exercises the 18 cases in PART 4.1 of the GL
-- report spec, plus a few bonus integrity-RPC checks. Every failure RAISEs,
-- so psql / the CI runner exits non-zero. Wrapped in BEGIN;...ROLLBACK; so
-- it is non-destructive against any database it points at.
--
-- Run locally:   supabase db query --linked --file supabase/tests/gl_report.test.sql
--        or:     psql "$DATABASE_URL" -f supabase/tests/gl_report.test.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_label text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  -- Nested block so the RPC's own exception (any SQLSTATE — these RPCs raise
  -- with custom codes like 22007/22003, not the generic P0001 raise_exception
  -- class) is caught here, without swallowing the "it didn't fail" RAISE below.
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

CREATE OR REPLACE FUNCTION pg_temp.new_gl_tenant(p_name text, OUT tenant_id uuid, OUT user_id uuid, OUT auth_id uuid)
LANGUAGE plpgsql AS $$
DECLARE v_role uuid;
BEGIN
  SELECT id INTO v_role FROM public.roles WHERE role_name = 'Primary Admin' LIMIT 1;
  auth_id := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (auth_id);
  INSERT INTO public.tenants(company_name) VALUES (p_name) RETURNING id INTO tenant_id;
  ALTER TABLE public.users DISABLE TRIGGER enforce_user_insert;
  INSERT INTO public.users(tenant_id, email, first_name, last_name, role_id, auth_user_id)
    VALUES (tenant_id, lower(replace(p_name, ' ', '')) || '@gltest.com', p_name, 'Admin', v_role, auth_id)
    RETURNING id INTO user_id;
  ALTER TABLE public.users ENABLE TRIGGER enforce_user_insert;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.new_account(
  p_tenant uuid, p_code text, p_name text, p_type text,
  p_parent uuid DEFAULT NULL, p_level int DEFAULT 1, p_postable boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type, parent_account_id,
                               account_level, account_path, is_postable, is_active)
    VALUES (p_tenant, p_code, p_name, p_type, p_parent, p_level, p_code || ' ' || p_name, p_postable, true)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Insert a posted, balanced-or-not journal entry and return its id. Lines are
-- inserted separately by the caller (line count/shape varies per test case).
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
  -- Tenant A accounts
  L1 uuid; L2 uuid; L3 uuid; L4 uuid; cash uuid; sales uuid; dormant uuid;
  cyc_a uuid; cyc_b uuid; orphan uuid;
  -- Tenant B
  b_root uuid;
  -- Entries / lines
  je1 uuid; je2 uuid; je3 uuid; je4 uuid; je5 uuid; je6 uuid; je7 uuid; je8 uuid; je9 uuid;
  l1a uuid; l1b uuid;
  n int; v_debit numeric; v_credit numeric; v_bal numeric; v_split text; v_memo text;
  v_cyc_excluded int; v_orphan_row record;
BEGIN
  -- ══ Fixture: tenant B (used for cross-tenant + orphan-parent tests) ═══════
  SELECT * INTO tB FROM pg_temp.new_gl_tenant('GL Test Co B');
  b_root := pg_temp.new_account(tB.tenant_id, '1000', 'B Root', 'Asset', NULL, 1, false);

  -- ══ Fixture: tenant A ══════════════════════════════════════════════════════
  SELECT * INTO tA FROM pg_temp.new_gl_tenant('GL Test Co A');

  -- 4-level chain: L1 (struct) > L2 (postable parent, own postings) > L3 (struct) > L4 (leaf)
  L1 := pg_temp.new_account(tA.tenant_id, '1000', 'Current Assets', 'Asset', NULL, 1, false);
  L2 := pg_temp.new_account(tA.tenant_id, '1010', 'Bank Accounts',  'Asset', L1,   2, true);
  L3 := pg_temp.new_account(tA.tenant_id, '1011', 'Local Banks',    'Asset', L2,   3, false);
  L4 := pg_temp.new_account(tA.tenant_id, '1012', 'Savings',        'Asset', L3,   4, true);
  cash    := pg_temp.new_account(tA.tenant_id, '1001', 'Cash in Hand',    'Asset',  L1, 2, true);
  sales   := pg_temp.new_account(tA.tenant_id, '4000', 'Sales Revenue',   'Income', NULL, 1, true);
  dormant := pg_temp.new_account(tA.tenant_id, '6900', 'Unused Expense',  'Expense', NULL, 1, true);

  -- Mutual parent cycle, built via UPDATE after both rows exist (a straight
  -- INSERT can't create a cycle — the FK requires the parent to exist first).
  cyc_a := pg_temp.new_account(tA.tenant_id, '9001', 'Cyclic A', 'Asset', NULL, 1, true);
  cyc_b := pg_temp.new_account(tA.tenant_id, '9002', 'Cyclic B', 'Asset', cyc_a, 2, true);
  UPDATE public.accounts SET parent_account_id = cyc_b WHERE id = cyc_a;

  -- Orphan: parent exists (in tenant B), but not in this tenant.
  orphan := pg_temp.new_account(tA.tenant_id, '9100', 'Orphan Child', 'Asset', b_root, 2, true);

  PERFORM set_config('request.jwt.claim.sub', tA.auth_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- fn_prevent_posting_non_postable() auto-flips an account to is_postable=false
  -- the moment it gains a child (L2 got this from L3's insert above), which is
  -- stricter than this test fixture assumed. JE2 and JE9 deliberately post to
  -- L2/L1 anyway to exercise the "- Other" pseudo-child and the POSTING_TO_PARENT
  -- integrity warning, so the whole fixture section runs under the same bulk
  -- bypass the real bank-import pipeline uses for verified postings.
  PERFORM set_config('app.bank_import_bulk', '1', true);

  -- ══ Journal entries ════════════════════════════════════════════════════════

  -- JE1: plain two-line entry. Case 1 — each line's split is the OTHER account's name.
  je1 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-05', 'JE1 two-line');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je1, L4, 1000, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je1, cash, 0, 1000);

  -- JE2: 1 Dr / 3 Cr. Case 2 — Dr line is -SPLIT-, each Cr line names the Dr account.
  je2 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-06', 'JE2 one-dr-three-cr');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je2, L2, 300, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je2, cash, 0, 100);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je2, sales, 0, 100);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je2, L4, 0, 100);

  -- JE3: touches `cash` twice. Case 3 — cash is excluded from its own split set.
  je3 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-07', 'JE3 same-account-twice');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je3, cash, 50, 0)  RETURNING id INTO l1a;
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je3, cash, 0, 20);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je3, sales, 0, 30) RETURNING id INTO l1b;

  -- JE4: memo test. Case 13 — 2 distinct memos, 3rd line null -> -MULTIPLE-.
  je4 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-08', 'JE4 memo');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, memo) VALUES (je4, cash, 10, 0, 'memoA');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, memo) VALUES (je4, sales, 0, 5, 'memoB');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, memo) VALUES (je4, L4, 0, 5, NULL);

  -- JE5: dated before the report range. Case 10 — lands in opening, not debit/credit.
  je5 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2020-01-01', 'JE5 pre-range');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je5, cash, 200, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je5, sales, 0, 200);

  -- JE6: voided. Case 8 — absent from tree and transactions.
  je6 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-09', 'JE6 voided');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je6, cash, 999, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je6, sales, 0, 999);
  UPDATE public.journal_entries SET voided_at = now(), voided_by = tA.user_id, void_reason = 'test' WHERE id = je6;

  -- JE7: draft, never posted. Case 9 — absent.
  je7 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-10', 'JE7 draft', 'draft');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je7, cash, 777, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je7, sales, 0, 777);

  -- JE8: Income-only credits, to prove the negative-balance invariant (case 6).
  je8 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-11', 'JE8 income');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je8, cash, 400, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je8, sales, 0, 400);

  -- JE9: bonus — deliberately unbalanced + single-line + degenerate + posting to
  -- a non-postable parent, to exercise rpc_gl_integrity beyond the 18-case matrix.
  je9 := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-12', 'JE9 broken');
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je9, cash, 10, 0);
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je9, sales, 0, 0); -- degenerate: neither side set
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je9, L1, 5, 0); -- L1 is non-postable

  -- Single-line entry (SINGLE_LINE_ENTRY).
  INSERT INTO public.journal_entries(tenant_id, entry_date, description, status, created_by, posted_at)
    VALUES (tA.tenant_id, '2025-06-13', 'JE10 single line', 'posted', tA.user_id, now())
    RETURNING id INTO je9; -- reuse var
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (je9, cash, 15, 0);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- ASSERTIONS
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Case 1: two-line split
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[L4]) WHERE entry_id = je1;
  PERFORM pg_temp.eq('case1.dr_line_names_cr_account', v_split, 'Cash in Hand');
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je1;
  PERFORM pg_temp.eq('case1.cr_line_names_dr_account', v_split, 'Savings');

  -- Case 2: 1 Dr / 3 Cr, 4 distinct accounts total. split_text is computed from
  -- "every other distinct account on the entry" (§2.3), not from debit/credit
  -- side — so with 4 distinct accounts every line (Dr and all 3 Cr) sees >=2
  -- others and reads -SPLIT-. (The spec's own prose example — "each Cr line
  -- names the Dr account" — only holds when the credit side is a single line;
  -- with 3 distinct credit accounts every line necessarily sees multiple
  -- others. Verified against the mandated SQL, not the prose.)
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[L2]) WHERE entry_id = je2;
  PERFORM pg_temp.eq('case2.dr_line_is_split', v_split, '-SPLIT-');
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[sales]) WHERE entry_id = je2;
  PERFORM pg_temp.eq('case2.cr_line_is_split_too', v_split, '-SPLIT-');
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je2;
  PERFORM pg_temp.eq('case2.other_cr_line_is_split_too', v_split, '-SPLIT-');

  -- Case 3: same account twice in one entry
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE line_id = l1a;
  PERFORM pg_temp.eq('case3.cash_debit_line_excludes_self', v_split, 'Sales Revenue');
  SELECT split_text INTO v_split FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[sales]) WHERE line_id = l1b;
  PERFORM pg_temp.eq('case3.sales_line_names_cash_only_once', v_split, 'Cash in Hand');

  -- Case 4: 4-level nesting; subtree rolls up correctly through every level
  PERFORM pg_temp.eq('case4.L4_depth', (SELECT depth FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = L4 AND NOT is_other_node), 4);
  PERFORM pg_temp.eq('case4.L1_depth', (SELECT depth FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = L1 AND NOT is_other_node), 1);
  SELECT subtree_debit, subtree_credit INTO v_debit, v_credit
    FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = L1 AND NOT is_other_node;
  -- L1's subtree = cash(own) + L2 subtree (L2 own + L3 subtree (L3 own + L4 own))
  PERFORM pg_temp.eq('case4.L1_subtree_debit', v_debit,
    (SELECT COALESCE(SUM(debit),0) FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
      WHERE je.status='posted' AND je.voided_at IS NULL AND je.entry_date BETWEEN '2025-06-01' AND '2025-06-30'
        AND jl.account_id IN (L1,L2,L3,L4,cash)));

  -- Case 5: parent with its own direct postings -> ":other" node carries them,
  -- and the parent's subtree counts them exactly once (not doubled).
  PERFORM pg_temp.ok('case5.other_node_exists', EXISTS (
    SELECT 1 FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = L2 AND is_other_node));
  SELECT own_debit INTO v_debit FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = L2 AND is_other_node;
  PERFORM pg_temp.eq('case5.other_node_own_debit', v_debit, 300::numeric);
  SELECT subtree_debit INTO v_debit FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = L2 AND NOT is_other_node;
  -- L2's subtree = L2's own postings + everything under L3/L4 — computed live so this
  -- assertion can't drift from whatever the fixture actually posts to that subtree.
  PERFORM pg_temp.eq('case5.parent_subtree_counts_own_once', v_debit,
    (SELECT COALESCE(SUM(debit),0) FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
      WHERE je.status='posted' AND je.voided_at IS NULL AND je.entry_date BETWEEN '2025-06-01' AND '2025-06-30'
        AND jl.account_id IN (L2,L3,L4)));

  -- Case 6: Income account with only credits -> negative closing balance (raw Dr - Cr)
  SELECT (subtree_opening + subtree_debit - subtree_credit) INTO v_bal
    FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = sales AND NOT is_other_node;
  PERFORM pg_temp.ok('case6.income_balance_is_negative', v_bal < 0);

  -- Case 7: zero-activity account still appears
  PERFORM pg_temp.eq('case7.dormant_txn_count', (
    SELECT own_txn_count FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = dormant AND NOT is_other_node), 0::bigint);

  -- Case 8: voided entry absent
  PERFORM pg_temp.eq('case8.voided_absent_from_txns', (
    SELECT count(*) FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je6)::int, 0);

  -- Case 9: draft entry absent
  PERFORM pg_temp.eq('case9.draft_absent_from_txns', (
    SELECT count(*) FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je7)::int, 0);

  -- Case 10: pre-range entry contributes to opening, not to period debit/credit
  SELECT own_opening, own_debit INTO v_bal, v_debit FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = cash AND NOT is_other_node;
  PERFORM pg_temp.ok('case10.prerange_in_opening', v_bal >= 200); -- includes JE5's 200 plus later postings' pre-range contribution (none here)
  PERFORM pg_temp.eq('case10.prerange_not_in_period_debit',
    (SELECT count(*) FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je5)::int, 0);

  -- Case 11: batched vs unbatched running balances are byte-identical
  PERFORM pg_temp.eq('case11.batched_matches_unbatched',
    (SELECT running_balance FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash, sales, L2, L4]) WHERE entry_id = je1 AND account_id = cash),
    (SELECT running_balance FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je1 AND account_id = cash));

  -- Case 12: multi-row insert assigns distinct seq (bulk INSERT ... SELECT)
  WITH ins AS (
    INSERT INTO public.journal_entries(tenant_id, entry_date, description, status, created_by, posted_at)
      VALUES (tA.tenant_id, '2025-06-14', 'JE seq probe', 'posted', tA.user_id, now())
      RETURNING id
  ), lines AS (
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    SELECT ins.id, x.acct, 1, 0 FROM ins, (VALUES (cash), (sales), (L4)) AS x(acct)
    RETURNING seq
  )
  SELECT count(DISTINCT seq) INTO n FROM lines;
  PERFORM pg_temp.eq('case12.multirow_insert_distinct_seq', n, 3);

  -- Case 13: multi-memo -> -MULTIPLE- on the null-memo line
  SELECT memo INTO v_memo FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[L4]) WHERE entry_id = je4;
  PERFORM pg_temp.eq('case13.multiple_memo', v_memo, '-MULTIPLE-');
  SELECT memo INTO v_memo FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', ARRAY[cash]) WHERE entry_id = je4;
  PERFORM pg_temp.eq('case13.own_memo_preserved', v_memo, 'memoA');

  -- Case 14: injected parent cycle -> no infinite recursion, cycle members excluded
  SELECT count(*) INTO v_cyc_excluded FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id IN (cyc_a, cyc_b) AND NOT is_other_node;
  PERFORM pg_temp.eq('case14.cycle_members_excluded_not_crashed', v_cyc_excluded, 0);

  -- Case 15: orphan account appears at root, never silently dropped
  SELECT depth INTO n FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id = orphan AND NOT is_other_node;
  PERFORM pg_temp.eq('case15.orphan_surfaces_at_root_depth1', n, 1);
  PERFORM pg_temp.ok('case15.orphan_flagged_by_integrity', EXISTS (
    SELECT 1 FROM public.rpc_gl_integrity('2025-06-01','2025-06-30') WHERE code = 'ORPHAN_ACCOUNT' AND entity_id = orphan));

  -- Case 16: cross-tenant isolation — tenant B sees none of tenant A's rows
  PERFORM set_config('request.jwt.claim.sub', tB.auth_id::text, true);
  PERFORM pg_temp.eq('case16.cross_tenant_tree_empty', (
    SELECT count(*) FROM public.rpc_gl_account_tree('2025-06-01','2025-06-30') WHERE account_id IN (cash, sales, L1, L2, L4))::int, 0);
  PERFORM pg_temp.eq('case16.cross_tenant_txns_empty', (
    SELECT count(*) FROM public.rpc_gl_transactions('2025-06-01','2025-06-30', NULL) WHERE entry_id IN (je1, je2, je3))::int, 0);
  PERFORM set_config('request.jwt.claim.sub', tA.auth_id::text, true);

  -- Case 17: date_to < date_from raises
  PERFORM pg_temp.expect_error('case17.date_to_before_date_from',
    $sql$SELECT * FROM public.rpc_gl_account_tree('2025-06-30','2025-06-01')$sql$);

  -- Case 18: > 10-year range raises
  PERFORM pg_temp.expect_error('case18.range_exceeds_ten_years',
    $sql$SELECT * FROM public.rpc_gl_account_tree('2000-01-01','2025-06-30')$sql$);

  -- ── Bonus: rpc_gl_integrity beyond the 18-case matrix ──────────────────────
  PERFORM pg_temp.ok('bonus.unbalanced_entry_flagged', EXISTS (
    SELECT 1 FROM public.rpc_gl_integrity('2025-06-01','2025-06-30') WHERE code = 'UNBALANCED_ENTRY' AND entity_id = je9));
  PERFORM pg_temp.ok('bonus.degenerate_line_flagged', EXISTS (
    SELECT 1 FROM public.rpc_gl_integrity('2025-06-01','2025-06-30') WHERE code = 'DEGENERATE_LINE'));
  PERFORM pg_temp.ok('bonus.posting_to_parent_flagged', EXISTS (
    SELECT 1 FROM public.rpc_gl_integrity('2025-06-01','2025-06-30') WHERE code = 'POSTING_TO_PARENT' AND entity_id = L1));
  PERFORM pg_temp.ok('bonus.single_line_entry_flagged', EXISTS (
    SELECT 1 FROM public.rpc_gl_integrity('2025-06-01','2025-06-30') WHERE code = 'SINGLE_LINE_ENTRY'));

  RAISE NOTICE 'gl_report.test.sql: ALL CHECKS PASSED';
END $main$;

ROLLBACK;
