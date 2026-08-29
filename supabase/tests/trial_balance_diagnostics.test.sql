-- ═══════════════════════════════════════════════════════════════════════════
-- TRIAL BALANCE DIAGNOSTICS — database test suite (rpc_trial_balance_diagnostics)
--
-- The out-of-balance banner claims to explain the difference completely, so
-- the contract under test is arithmetic, not cosmetic:
--
--   1. every one of the four causes is measured correctly, in isolation;
--   2. the four amounts sum to the closing difference exactly (residual = 0);
--   3. that closing difference is the same number the Trial Balance itself
--      prints — the report's own rows, split into Dr/Cr the way the UI splits
--      them, netted;
--   4. the drill-down lists name the actual accounts and entries behind it.
--
-- The fixture ledger is built so that all four causes are non-zero at once and
-- none of them can be right by accident: the expected component amounts
-- (700 / 50 / 400 / -260) are all distinct, and so are the two totals they
-- roll up to (1150 with inactive accounts shown, 890 with them hidden).
--
-- Wrapped in BEGIN;...ROLLBACK; — non-destructive.
--
-- Run locally:  supabase db query --linked --file supabase/tests/trial_balance_diagnostics.test.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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

CREATE OR REPLACE FUNCTION pg_temp.new_tenant(p_name text, OUT tenant_id uuid, OUT user_id uuid, OUT auth_id uuid)
LANGUAGE plpgsql AS $$
DECLARE v_role uuid;
BEGIN
  SELECT id INTO v_role FROM public.roles WHERE role_name = 'Primary Admin' LIMIT 1;
  auth_id := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (auth_id);
  INSERT INTO public.tenants(company_name) VALUES (p_name) RETURNING id INTO tenant_id;
  ALTER TABLE public.users DISABLE TRIGGER enforce_user_insert;
  INSERT INTO public.users(tenant_id, email, first_name, last_name, role_id, auth_user_id)
    VALUES (tenant_id, lower(replace(p_name, ' ', '')) || '@tbdiag.com', p_name, 'Admin', v_role, auth_id)
    RETURNING id INTO user_id;
  ALTER TABLE public.users ENABLE TRIGGER enforce_user_insert;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.new_account(
  p_tenant uuid, p_code text, p_name text, p_type text, p_active boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type,
                              account_level, account_path, is_postable, is_active)
    VALUES (p_tenant, p_code, p_name, p_type, 1, p_code || ' ' || p_name, true, p_active)
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

CREATE OR REPLACE FUNCTION pg_temp.line(p_entry uuid, p_account uuid, p_debit numeric, p_credit numeric)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (p_entry, p_account, p_debit, p_credit);
$$;

/** One component's signed amount, by code. */
CREATE OR REPLACE FUNCTION pg_temp.comp(p_diag jsonb, p_code text)
RETURNS numeric LANGUAGE sql AS $$
  SELECT (c->>'amount')::numeric
  FROM jsonb_array_elements(p_diag->'components') c
  WHERE c->>'code' = p_code;
$$;

/** How many accounts/entries a component says are behind it. */
CREATE OR REPLACE FUNCTION pg_temp.comp_count(p_diag jsonb, p_code text)
RETURNS int LANGUAGE sql AS $$
  SELECT (c->>'count')::int
  FROM jsonb_array_elements(p_diag->'components') c
  WHERE c->>'code' = p_code;
$$;

/** The listed amount for one drill-down row, or NULL when it is not listed. */
CREATE OR REPLACE FUNCTION pg_temp.item_amount(p_diag jsonb, p_code text, p_id uuid)
RETURNS numeric LANGUAGE sql AS $$
  SELECT (i->>'amount')::numeric
  FROM jsonb_array_elements(p_diag->'components') c,
       jsonb_array_elements(c->'items') i
  WHERE c->>'code' = p_code AND i->>'id' = p_id::text;
$$;

/** The Trial Balance's own bottom line, split into Dr/Cr exactly as the UI splits it. */
CREATE OR REPLACE FUNCTION pg_temp.ui_closing_difference(p_from date, p_to date, p_include_inactive boolean)
RETURNS numeric LANGUAGE sql AS $$
  SELECT round(COALESCE(
           SUM(CASE WHEN t.closing >  0.005 THEN t.closing  ELSE 0 END)
         - SUM(CASE WHEN t.closing < -0.005 THEN -t.closing ELSE 0 END), 0), 2)
  FROM public.rpc_trial_balance(p_from, p_to, 'parent', false, p_include_inactive) t;
$$;

DO $main$
DECLARE
  tA record; tB record; tC record;
  cash uuid; sales uuid; expense uuid; dormant_inactive uuid; ob_asset uuid;
  period_id uuid;
  je_pre_sale uuid; je_pre_exp uuid; je_pre_inactive uuid;
  je_sale uuid; je_inactive uuid; je_unbalanced uuid; je_void uuid; je_draft uuid;
  c_dust uuid; c_rounds_up uuid;
  d jsonb; d_active jsonb;
  v_sum numeric; v_i int;
BEGIN
  -- ══ Fixture: a second tenant, whose ledger must never leak in ══════════════
  SELECT * INTO tB FROM pg_temp.new_tenant('TB Diag Co B');
  DECLARE b_cash uuid; b_sales uuid; b_je uuid;
  BEGIN
    b_cash  := pg_temp.new_account(tB.tenant_id, '1000', 'B Cash',  'Asset');
    b_sales := pg_temp.new_account(tB.tenant_id, '4000', 'B Sales', 'Income');
    PERFORM set_config('request.jwt.claim.sub', tB.auth_id::text, true);
    PERFORM set_config('role', 'authenticated', true);
    -- Pre-range income and a lopsided entry: if tenant scoping ever slipped,
    -- both of tenant A's headline totals would move.
    b_je := pg_temp.new_entry(tB.tenant_id, tB.user_id, '2025-01-01', 'B pre-range sale');
    PERFORM pg_temp.line(b_je, b_cash, 7777, 0);
    PERFORM pg_temp.line(b_je, b_sales, 0, 7777);
    b_je := pg_temp.new_entry(tB.tenant_id, tB.user_id, '2025-06-01', 'B unbalanced');
    PERFORM pg_temp.line(b_je, b_cash, 1234, 0);
    PERFORM set_config('role', 'postgres', true);
  END;

  -- ══ Fixture: tenant A ══════════════════════════════════════════════════════
  SELECT * INTO tA FROM pg_temp.new_tenant('TB Diag Co A');

  cash             := pg_temp.new_account(tA.tenant_id, '1000', 'Cash',            'Asset');
  ob_asset         := pg_temp.new_account(tA.tenant_id, '1100', 'Audited Asset',   'Asset');
  dormant_inactive := pg_temp.new_account(tA.tenant_id, '1200', 'Retired Asset',   'Asset', false);
  sales            := pg_temp.new_account(tA.tenant_id, '4000', 'Sales Revenue',   'Income');
  expense          := pg_temp.new_account(tA.tenant_id, '6000', 'Admin Expense',   'Expense');

  INSERT INTO public.fiscal_periods(tenant_id, name, period_start, period_end, status)
    VALUES (tA.tenant_id, 'FY Test', '2025-04-01', '2026-03-31', 'open')
    RETURNING id INTO period_id;

  -- Cause 3: a recorded opening with no ledger history and no counterpart, so
  -- the override does not net to zero on its own.
  INSERT INTO public.opening_balances(tenant_id, account_id, fiscal_period_id, debit, credit, balance)
    VALUES (tA.tenant_id, ob_asset, period_id, 400, 0, 400);

  PERFORM set_config('request.jwt.claim.sub', tA.auth_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Before the range. Cause 1 lives here: the P&L halves of these entries are
  -- opened at zero by the report, their asset halves are carried forward.
  je_pre_sale := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-01-01', 'Pre-range sale');
  PERFORM pg_temp.line(je_pre_sale, cash, 1000, 0);
  PERFORM pg_temp.line(je_pre_sale, sales, 0, 1000);

  je_pre_exp := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-01-02', 'Pre-range expense');
  PERFORM pg_temp.line(je_pre_exp, expense, 300, 0);
  PERFORM pg_temp.line(je_pre_exp, cash, 0, 300);

  -- Cause 4 (part): pre-range movement stranded on an inactive account.
  je_pre_inactive := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-01-05', 'Pre-range retired asset');
  PERFORM pg_temp.line(je_pre_inactive, dormant_inactive, 200, 0);
  PERFORM pg_temp.line(je_pre_inactive, cash, 0, 200);

  -- Inside the range.
  je_sale := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-06-01', 'Cash sale');
  PERFORM pg_temp.line(je_sale, cash, 500, 0);
  PERFORM pg_temp.line(je_sale, sales, 0, 500);

  -- Cause 4 (part): in-range movement on the same inactive account.
  je_inactive := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-07-01', 'Retired asset top-up');
  PERFORM pg_temp.line(je_inactive, dormant_inactive, 60, 0);
  PERFORM pg_temp.line(je_inactive, cash, 0, 60);

  -- Cause 2: a posted entry that does not net to zero.
  je_unbalanced := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-08-01', 'One-legged entry');
  PERFORM pg_temp.line(je_unbalanced, cash, 50, 0);

  -- Neither of these may register anywhere: voided and draft are out of scope.
  je_void := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-09-01', 'Voided entry');
  PERFORM pg_temp.line(je_void, cash, 9999, 0);
  PERFORM pg_temp.line(je_void, sales, 0, 9999);
  UPDATE public.journal_entries SET voided_at = now(), voided_by = tA.user_id, void_reason = 'test'
   WHERE id = je_void;

  je_draft := pg_temp.new_entry(tA.tenant_id, tA.user_id, '2025-09-02', 'Draft entry', 'draft');
  PERFORM pg_temp.line(je_draft, cash, 8888, 0);
  PERFORM pg_temp.line(je_draft, sales, 0, 8888);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 1 — inactive accounts shown. All four causes measured in isolation.
  -- ═══════════════════════════════════════════════════════════════════════════
  d_active := public.rpc_trial_balance_diagnostics('2025-04-01', '2026-03-31', true);
  d := d_active;

  -- Opening: cash 500 + retired asset 200 + audited asset 400; both P&L accounts at zero.
  PERFORM pg_temp.eq('case1.opening_difference', (d->>'opening_difference')::numeric, 1100::numeric);
  -- Movement: cash +490, sales -500, retired asset +60.
  PERFORM pg_temp.eq('case1.period_difference',  (d->>'period_difference')::numeric,  50::numeric);
  PERFORM pg_temp.eq('case1.closing_difference', (d->>'closing_difference')::numeric, 1150::numeric);

  -- Pre-range P&L: sales -1000, expense +300, sign-flipped onto the difference.
  PERFORM pg_temp.eq('case1.pl_opening',       pg_temp.comp(d, 'pl_opening_not_closed'),   700::numeric);
  PERFORM pg_temp.eq('case1.pl_opening_count', pg_temp.comp_count(d, 'pl_opening_not_closed'), 2);
  PERFORM pg_temp.eq('case1.unbalanced',       pg_temp.comp(d, 'unbalanced_entries'),       50::numeric);
  PERFORM pg_temp.eq('case1.unbalanced_count', pg_temp.comp_count(d, 'unbalanced_entries'),  1);
  PERFORM pg_temp.eq('case1.audit_override',   pg_temp.comp(d, 'audit_opening_override'),  400::numeric);
  PERFORM pg_temp.eq('case1.audit_count',      pg_temp.comp_count(d, 'audit_opening_override'), 1);
  -- Nothing is excluded while inactive accounts are shown.
  PERFORM pg_temp.eq('case1.excluded',         pg_temp.comp(d, 'excluded_accounts'),         0::numeric);
  PERFORM pg_temp.eq('case1.excluded_count',   pg_temp.comp_count(d, 'excluded_accounts'),   0);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 2 — the causes account for the difference completely.
  -- ═══════════════════════════════════════════════════════════════════════════
  SELECT round(sum((c->>'amount')::numeric), 2) INTO v_sum
  FROM jsonb_array_elements(d->'components') c;
  PERFORM pg_temp.eq('case2.components_sum_to_difference', v_sum, (d->>'closing_difference')::numeric);
  PERFORM pg_temp.eq('case2.residual_zero', (d->>'residual')::numeric, 0::numeric);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 3 — the difference explained is the difference the report prints.
  -- ═══════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.eq('case3.matches_report',
    pg_temp.ui_closing_difference('2025-04-01', '2026-03-31', true),
    (d->>'closing_difference')::numeric);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 4 — the drill-down names the right accounts and entries.
  -- ═══════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.eq('case4.lists_sales',    pg_temp.item_amount(d, 'pl_opening_not_closed', sales),   1000::numeric);
  PERFORM pg_temp.eq('case4.lists_expense',  pg_temp.item_amount(d, 'pl_opening_not_closed', expense), -300::numeric);
  PERFORM pg_temp.eq('case4.lists_entry',    pg_temp.item_amount(d, 'unbalanced_entries', je_unbalanced), 50::numeric);
  PERFORM pg_temp.eq('case4.lists_ob_acct',  pg_temp.item_amount(d, 'audit_opening_override', ob_asset), 400::numeric);
  -- A balance-sheet account is never a P&L cause, and cash's own carry-forward
  -- is not a cause at all — it is matched by the other side of the entry.
  PERFORM pg_temp.ok('case4.cash_not_a_pl_cause',
    pg_temp.item_amount(d, 'pl_opening_not_closed', cash) IS NULL);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 5 — hiding inactive accounts moves their balance into its own cause.
  -- ═══════════════════════════════════════════════════════════════════════════
  d := public.rpc_trial_balance_diagnostics('2025-04-01', '2026-03-31', false);

  PERFORM pg_temp.eq('case5.closing_difference', (d->>'closing_difference')::numeric, 890::numeric);
  -- 200 carried forward + 60 in-range, removed from the report.
  PERFORM pg_temp.eq('case5.excluded',       pg_temp.comp(d, 'excluded_accounts'), -260::numeric);
  PERFORM pg_temp.eq('case5.excluded_count', pg_temp.comp_count(d, 'excluded_accounts'), 1);
  PERFORM pg_temp.eq('case5.lists_inactive',
    pg_temp.item_amount(d, 'excluded_accounts', dormant_inactive), -260::numeric);
  -- The other three causes are untouched by the filter.
  PERFORM pg_temp.eq('case5.pl_opening',     pg_temp.comp(d, 'pl_opening_not_closed'),  700::numeric);
  PERFORM pg_temp.eq('case5.unbalanced',     pg_temp.comp(d, 'unbalanced_entries'),      50::numeric);
  PERFORM pg_temp.eq('case5.audit_override', pg_temp.comp(d, 'audit_opening_override'), 400::numeric);

  SELECT round(sum((c->>'amount')::numeric), 2) INTO v_sum
  FROM jsonb_array_elements(d->'components') c;
  PERFORM pg_temp.eq('case5.components_sum_to_difference', v_sum, (d->>'closing_difference')::numeric);
  PERFORM pg_temp.eq('case5.residual_zero', (d->>'residual')::numeric, 0::numeric);
  PERFORM pg_temp.eq('case5.matches_report',
    pg_temp.ui_closing_difference('2025-04-01', '2026-03-31', false),
    (d->>'closing_difference')::numeric);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 6 — a balanced ledger reports no causes at all.
  --
  -- Ends before the one-legged entry, starts before any posting, and is read
  -- with inactive accounts shown: no carry-forward, nothing stranded, and the
  -- recorded opening belongs to a fiscal period this range does not start in.
  -- ═══════════════════════════════════════════════════════════════════════════
  d := public.rpc_trial_balance_diagnostics('2024-01-01', '2025-07-31', true);
  PERFORM pg_temp.eq('case6.balanced',        (d->>'closing_difference')::numeric, 0::numeric);
  PERFORM pg_temp.eq('case6.no_pl_cause',     pg_temp.comp(d, 'pl_opening_not_closed'),   0::numeric);
  PERFORM pg_temp.eq('case6.no_unbalanced',   pg_temp.comp(d, 'unbalanced_entries'),      0::numeric);
  PERFORM pg_temp.eq('case6.no_override',     pg_temp.comp(d, 'audit_opening_override'),  0::numeric);
  PERFORM pg_temp.eq('case6.no_excluded',     pg_temp.comp(d, 'excluded_accounts'),       0::numeric);
  PERFORM pg_temp.eq('case6.residual_zero',   (d->>'residual')::numeric,                  0::numeric);
  PERFORM pg_temp.eq('case6.matches_report',
    pg_temp.ui_closing_difference('2024-01-01', '2025-07-31', true), 0::numeric);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 7 — voided and draft entries are invisible to every cause.
  --
  -- Case 1's figures already prove it: the void and the draft each carry 9999
  -- and 8888 of cash, and neither moved a single total. Assert directly that
  -- they are not named as unbalanced entries either.
  -- ═══════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.ok('case7.void_not_listed',
    pg_temp.item_amount(d_active, 'unbalanced_entries', je_void) IS NULL);
  PERFORM pg_temp.ok('case7.draft_not_listed',
    pg_temp.item_amount(d_active, 'unbalanced_entries', je_draft) IS NULL);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 8 — tenant B's ledger, including its own lopsided entry, stays out.
  -- ═══════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.eq('case8.no_cross_tenant_leak',
    (d_active->>'closing_difference')::numeric, 1150::numeric);
  PERFORM pg_temp.eq('case8.no_cross_tenant_unbalanced',
    pg_temp.comp(d_active, 'unbalanced_entries'), 50::numeric);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 10 — sub-cent recorded openings round the way the report rounds.
  --
  -- journal_lines.debit/.credit are numeric(14,2), but opening_balances
  -- .debit/.credit are unconstrained numeric, so a recorded opening is the one
  -- figure here that can carry sub-cent digits. rpc_trial_balance rounds each
  -- row before the screen adds them up; summing first and rounding once gives a
  -- different answer, and the reader would be handed an explanation of a
  -- number the report never printed.
  --
  -- Three openings of 0.004 (each rounding to nothing, and each below the
  -- report's own zero-row threshold) plus one of 12.006 (rounding up to 12.01):
  -- per row that is 12.01, which is what the report shows. Unrounded it is
  -- 12.018, which rounds to 12.02 — so this case fails loudly if the rounding
  -- ever moves back to the end.
  -- ═══════════════════════════════════════════════════════════════════════════
  PERFORM set_config('role', 'postgres', true);
  SELECT * INTO tC FROM pg_temp.new_tenant('TB Diag Co C');

  INSERT INTO public.fiscal_periods(tenant_id, name, period_start, period_end, status)
    VALUES (tC.tenant_id, 'FY Test C', '2025-04-01', '2026-03-31', 'open')
    RETURNING id INTO period_id;

  FOR v_i IN 1..3 LOOP
    c_dust := pg_temp.new_account(tC.tenant_id, '190' || v_i, 'Dust ' || v_i, 'Asset');
    INSERT INTO public.opening_balances(tenant_id, account_id, fiscal_period_id, debit, credit, balance)
      VALUES (tC.tenant_id, c_dust, period_id, 0.004, 0, 0.004);
  END LOOP;

  c_rounds_up := pg_temp.new_account(tC.tenant_id, '1950', 'Rounds Up', 'Asset');
  INSERT INTO public.opening_balances(tenant_id, account_id, fiscal_period_id, debit, credit, balance)
    VALUES (tC.tenant_id, c_rounds_up, period_id, 12.006, 0, 12.006);

  PERFORM set_config('request.jwt.claim.sub', tC.auth_id::text, true);
  PERFORM set_config('role', 'authenticated', true);

  d := public.rpc_trial_balance_diagnostics('2025-04-01', '2026-03-31', true);
  PERFORM pg_temp.eq('case10.closing_difference', (d->>'closing_difference')::numeric, 12.01::numeric);
  PERFORM pg_temp.eq('case10.opening_difference', (d->>'opening_difference')::numeric, 12.01::numeric);
  PERFORM pg_temp.eq('case10.audit_override', pg_temp.comp(d, 'audit_opening_override'), 12.01::numeric);
  PERFORM pg_temp.eq('case10.residual_zero', (d->>'residual')::numeric, 0::numeric);
  -- The contract: the same number the report prints, with zero rows hidden…
  PERFORM pg_temp.eq('case10.matches_report',
    pg_temp.ui_closing_difference('2025-04-01', '2026-03-31', true), 12.01::numeric);
  -- …and with them shown, where the three dust rows render as 0.00 apiece.
  SELECT round(COALESCE(
           SUM(CASE WHEN t.closing >  0.005 THEN t.closing  ELSE 0 END)
         - SUM(CASE WHEN t.closing < -0.005 THEN -t.closing ELSE 0 END), 0), 2)
    INTO v_sum
  FROM public.rpc_trial_balance('2025-04-01', '2026-03-31', 'parent', true, true) t;
  PERFORM pg_temp.eq('case10.matches_report_with_zero_rows', v_sum, 12.01::numeric);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CASE 9 — the same range guards the Trial Balance itself enforces.
  -- ═══════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.expect_error('case9.date_to_before_from',
    $sql$SELECT public.rpc_trial_balance_diagnostics('2026-03-31','2025-04-01')$sql$);
  PERFORM pg_temp.expect_error('case9.range_exceeds_ten_years',
    $sql$SELECT public.rpc_trial_balance_diagnostics('2000-01-01','2026-03-31')$sql$);

  RAISE NOTICE 'trial_balance_diagnostics.test.sql: ALL CHECKS PASSED';
END $main$;

-- A silent run is not a passing run: emit a row so the runner's output
-- distinguishes "every assertion held" from "the file never got that far".
SELECT 'trial_balance_diagnostics.test.sql: ALL CHECKS PASSED' AS result;

ROLLBACK;
