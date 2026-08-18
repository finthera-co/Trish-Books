-- Mapping a PARENT account onto a statement line was a silent no-op.
--
-- Parent accounts in a chart of accounts are headers: they carry no direct
-- journal lines (0 of 13 do, across every live tenant). fn_fs_eval_accounts
-- valued exactly the accounts named in fs_line_accounts, so a mapped parent
-- contributed 0.00 and its children — the accounts holding the money — were
-- reported as unmapped. Live at the time of writing:
--
--   CASH_EQUIV  <- 1101 Cash & cash Equivalents   own 0.00, 5 children  1,157,534,787.49
--   ASSETS      <- 1600 Property, Plant & Equipment own 0.00, 18 children 122,930,035.00
--
-- From here a mapped account carries its whole subtree, with one rule:
--
--   NEAREST MAPPED ANCESTOR WINS. A descendant is valued under the closest
--   ancestor that is itself mapped; if the descendant is mapped in its own
--   right, the walk stops there and it belongs to its own line instead.
--
-- So every account contributes to at most one line and cannot be double
-- counted, and mapping a parent is now a deliberate "and everything under it"
-- rather than a way to add nothing.
--
-- Note this is a mapping-time roll-up, NOT a chart-of-accounts tree drawn on
-- the face of the statement. The two hierarchies are orthogonal: on the live
-- tenant, the children of 6000 Administration Expenses are mapped across six
-- different statement lines (ADMIN_EXP, COS, SELLING_DIST, FINANCE_EXP,
-- REVENUE, OTHER_OP_INCOME). The statement's own hierarchy remains fs_lines.

-- ── 1. The expansion, in one place ──────────────────────────────────────────
-- Every consumer (valuation, coverage, tie-out) reads the mapping through this
-- function, so "what is on this statement" has exactly one definition.
CREATE OR REPLACE FUNCTION public.fn_fs_line_accounts_expanded(p_statement_id uuid)
RETURNS TABLE (
  out_line_id     uuid,
  out_sign        text,
  out_value_basis text,
  out_owner_id    uuid,
  out_account_id  uuid,
  out_depth       integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
  WITH RECURSIVE mapped AS (
    SELECT l.id AS line_id, l.sign, l.value_basis, la.account_id
    FROM public.fs_lines l
    JOIN public.fs_line_accounts la ON la.line_id = l.id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'detail'
  ),
  tree AS (
    -- Seed: the mapped account itself, at depth 0. Its own direct postings are
    -- included exactly once, whether or not it also has children.
    SELECT m.line_id, m.sign, m.value_basis, m.account_id AS owner_id, m.account_id, 0 AS depth
    FROM mapped m
    UNION ALL
    -- Descend, but stop at any account that is mapped in its own right: that
    -- one belongs to its own line, and so does everything beneath it.
    SELECT t.line_id, t.sign, t.value_basis, t.owner_id, c.id, t.depth + 1
    FROM tree t
    JOIN public.accounts c ON c.parent_account_id = t.account_id
                          AND c.tenant_id = public.get_user_tenant_id()
    WHERE t.depth < 12   -- cycle guard; a COA nested deeper than this is broken
      AND NOT EXISTS (SELECT 1 FROM mapped m2 WHERE m2.account_id = c.id)
  )
  SELECT t.line_id, t.sign, t.value_basis, t.owner_id, t.account_id, t.depth FROM tree t;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_fs_line_accounts_expanded(uuid) TO authenticated;

-- ── 2. One account, one line, per statement ─────────────────────────────────
-- Without roll-up, mapping an account onto two lines of one statement double
-- counted that account. With roll-up it would double count its entire subtree,
-- so the loophole is closed rather than documented. fs_line_accounts has no
-- statement_id to hang a unique index on, hence a trigger. No live tenant has
-- such a duplicate today, so nothing is grandfathered in.
CREATE OR REPLACE FUNCTION public.fn_fs_line_accounts_one_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_stmt  uuid;
  v_other text;
BEGIN
  SELECT l.statement_id INTO v_stmt FROM public.fs_lines l WHERE l.id = NEW.line_id;

  SELECT l.label INTO v_other
  FROM public.fs_line_accounts la
  JOIN public.fs_lines l ON l.id = la.line_id
  WHERE l.statement_id = v_stmt
    AND la.account_id = NEW.account_id
    AND la.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'That account is already mapped to "%" on this statement. An account belongs to exactly one line, otherwise it is counted twice.', v_other
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_fs_line_accounts_one_line ON public.fs_line_accounts;
CREATE TRIGGER trg_fs_line_accounts_one_line
  BEFORE INSERT OR UPDATE OF line_id, account_id ON public.fs_line_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_fs_line_accounts_one_line();

-- ── 3. Valuation reads the expanded mapping ─────────────────────────────────
-- Return type gains out_owner_id / out_depth so a caller can show the subtree
-- as a tree, hence DROP rather than REPLACE. Body is otherwise unchanged from
-- 20260816000003: only the line_acct CTE moved.
DROP FUNCTION IF EXISTS public.fn_fs_eval_accounts(uuid, date, date);
CREATE FUNCTION public.fn_fs_eval_accounts(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (
  out_line_id    uuid,
  out_account_id uuid,
  out_owner_id   uuid,
  out_depth      integer,
  out_value      numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant    uuid := public.get_user_tenant_id();
  v_period_id uuid;
BEGIN
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  RETURN QUERY
  WITH line_acct AS (
    SELECT e.out_line_id AS line_id, e.out_sign AS sign, e.out_value_basis AS value_basis,
           e.out_owner_id AS owner_id, e.out_account_id AS account_id, e.out_depth AS depth
    FROM public.fn_fs_line_accounts_expanded(p_statement_id) e
  ),
  -- Only these accounts need history before the period. Empty for a pure-P&L
  -- statement, which is what keeps the pre-period read off the critical path.
  cum_acct AS (
    SELECT DISTINCT la.account_id FROM line_acct la WHERE la.value_basis = 'cumulative'
  ),
  period_mv AS (
    SELECT jl.account_id, SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)) AS net
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
      AND jl.account_id IN (SELECT la.account_id FROM line_acct la)
    GROUP BY jl.account_id
  ),
  open_mv AS (
    SELECT jl.account_id, SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)) AS net
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date < p_date_from
      AND jl.account_id IN (SELECT ca.account_id FROM cum_acct ca)
    GROUP BY jl.account_id
  ),
  ob AS (
    SELECT o.account_id, COALESCE(o.debit,0) - COALESCE(o.credit,0) AS aud_open
    FROM public.opening_balances o
    WHERE o.tenant_id = v_tenant
      AND v_period_id IS NOT NULL AND o.fiscal_period_id = v_period_id
      AND o.account_id IN (SELECT ca.account_id FROM cum_acct ca)
  )
  -- period     -> movement in [from, to]
  -- cumulative -> audit opening (else ledger opening) + movement in [from, to],
  --               i.e. rpc_trial_balance's Closing, to the cent.
  -- LEFT JOINs throughout: an account with an opening balance and no movement,
  -- or no journal lines at all, must still produce a row. Dropping it is how a
  -- balance silently disappears off a statement.
  SELECT la.line_id, la.account_id, la.owner_id, la.depth,
         CASE WHEN la.sign = 'invert' THEN -v.raw ELSE v.raw END
  FROM line_acct la
  LEFT JOIN period_mv pm ON pm.account_id = la.account_id
  LEFT JOIN open_mv   om ON om.account_id = la.account_id
  LEFT JOIN ob            ON ob.account_id = la.account_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN la.value_basis = 'cumulative'
                THEN COALESCE(ob.aud_open, om.net, 0) + COALESCE(pm.net, 0)
                ELSE COALESCE(pm.net, 0)
           END AS raw
  ) v;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_fs_eval_accounts(uuid, date, date) TO authenticated;

-- ── 4. account_count must count what is actually valued ─────────────────────
-- Only the final RETURN QUERY changes: the per-line count now comes from the
-- expanded mapping, so a line fed by one parent reports its rolled-up ledgers
-- rather than "1 account". Everything above it is byte-for-byte 20260816000005.
CREATE OR REPLACE FUNCTION public.fn_fs_eval_statement(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (line_id uuid, value numeric, margin numeric, account_count integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_period_id  uuid;
  v_state      jsonb;
  v_delta      jsonb;
  v_pass       int;
  v_rows       int;
  v_unresolved int;
  v_base_value numeric;
BEGIN
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(l.id::text, jsonb_build_object('v', NULL, 'r', false)), '{}'::jsonb)
  INTO v_state
  FROM public.fs_lines l WHERE l.statement_id = p_statement_id;

  IF v_state = '{}'::jsonb THEN
    RETURN;
  END IF;

  -- 1. detail lines: SUM of the per-account valuation. Unmapped or no
  --    movement resolves to 0, not NULL — an empty line is a coverage issue,
  --    not a hole in the arithmetic.
  SELECT v_state || COALESCE(jsonb_object_agg(x.lid::text, jsonb_build_object('v', x.v, 'r', true)), '{}'::jsonb)
  INTO v_state
  FROM (
    SELECT l.id AS lid, COALESCE(sub.v, 0) AS v
    FROM public.fs_lines l
    LEFT JOIN (
      SELECT a.out_line_id AS acc_line_id, SUM(a.out_value) AS v
      FROM public.fn_fs_eval_accounts(p_statement_id, p_date_from, p_date_to) a
      GROUP BY a.out_line_id
    ) sub ON sub.acc_line_id = l.id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'detail'
  ) x;

  -- 2. spacer / text lines carry no figure but are resolved.
  SELECT v_state || COALESCE(jsonb_object_agg(l.id::text, jsonb_build_object('v', NULL, 'r', true)), '{}'::jsonb)
  INTO v_state
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.line_type IN ('spacer', 'text');

  -- 3. computed lines: fixed-point iteration, bounded at 20 passes. Terms are
  --    joined unconditionally so bool_and(r) is a true "every term is in" test.
  FOR v_pass IN 1..20 LOOP
    WITH st AS (
      SELECT (e.key)::uuid AS lid, (e.value ->> 'v')::numeric AS v, (e.value ->> 'r')::boolean AS r
      FROM jsonb_each(v_state) e
    ),
    newly AS (
      SELECT l.id AS lid, SUM(t.factor * term.v) AS v
      FROM public.fs_lines l
      JOIN st self ON self.lid = l.id AND NOT self.r
      JOIN public.fs_line_terms t ON t.line_id = l.id
      JOIN st term ON term.lid = t.term_line_id
      WHERE l.statement_id = p_statement_id AND l.line_type = 'computed'
      GROUP BY l.id
      HAVING bool_and(term.r)
    )
    SELECT COALESCE(jsonb_object_agg(n.lid::text, jsonb_build_object('v', n.v, 'r', true)), '{}'::jsonb),
           count(*)
    INTO v_delta, v_rows
    FROM newly n;

    v_state := v_state || v_delta;
    EXIT WHEN v_rows = 0;
  END LOOP;

  SELECT count(*) INTO v_unresolved
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.line_type = 'computed'
    AND NOT COALESCE((v_state -> l.id::text ->> 'r')::boolean, false);
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'CYCLE: % computed line(s) on this statement never reached a fixed point — check fs_line_terms for a cycle', v_unresolved
      USING ERRCODE = '55000';
  END IF;

  -- 4. per_share: numerator / fs_parameters[param_key] for the period. Missing
  --    or zero parameter -> NULL, never a divide-by-zero, never a fabricated
  --    denominator. DISTINCT ON pins a single numerator if a line ever grows a
  --    second term, rather than producing two conflicting answers.
  WITH st AS (
    SELECT (e.key)::uuid AS lid, (e.value ->> 'v')::numeric AS v, (e.value ->> 'r')::boolean AS r
    FROM jsonb_each(v_state) e
  ),
  ps AS (
    SELECT DISTINCT ON (l.id) l.id AS lid,
           CASE WHEN p.value IS NULL OR p.value = 0 THEN NULL ELSE term.v / p.value END AS v
    FROM public.fs_lines l
    JOIN st self ON self.lid = l.id AND NOT self.r
    JOIN public.fs_line_terms t ON t.line_id = l.id
    JOIN st term ON term.lid = t.term_line_id
    LEFT JOIN public.fs_parameters p
           ON p.tenant_id = v_tenant AND p.key = l.param_key
          AND p.fiscal_period_id IS NOT DISTINCT FROM v_period_id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'per_share'
    ORDER BY l.id, t.sort_order
  )
  SELECT COALESCE(jsonb_object_agg(ps.lid::text, jsonb_build_object('v', ps.v, 'r', true)), '{}'::jsonb)
  INTO v_delta FROM ps;
  v_state := v_state || v_delta;

  -- Any per_share line with no term at all still resolves, to NULL.
  SELECT COALESCE(jsonb_object_agg(l.id::text, jsonb_build_object('v', NULL, 'r', true)), '{}'::jsonb)
  INTO v_delta
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.line_type = 'per_share'
    AND NOT COALESCE((v_state -> l.id::text ->> 'r')::boolean, false);
  v_state := v_state || v_delta;

  -- 5. margin: value / the is_margin_base line's value.
  SELECT (v_state -> l.id::text ->> 'v')::numeric INTO v_base_value
  FROM public.fs_lines l
  WHERE l.statement_id = p_statement_id AND l.is_margin_base LIMIT 1;

  RETURN QUERY
  SELECT l.id,
         (v_state -> l.id::text ->> 'v')::numeric,
         CASE WHEN l.show_margin AND v_base_value IS NOT NULL AND v_base_value <> 0
              THEN round(((v_state -> l.id::text ->> 'v')::numeric / v_base_value) * 100, 2)
              ELSE NULL END,
         COALESCE(la.n, 0)::int
  FROM public.fs_lines l
  LEFT JOIN (
    SELECT e.out_line_id AS mapped_line_id, count(*) AS n
    FROM public.fn_fs_line_accounts_expanded(p_statement_id) e
    GROUP BY e.out_line_id
  ) la ON la.mapped_line_id = l.id
  WHERE l.statement_id = p_statement_id;
END
$fn$;

-- ── 5. Drill-down carries the tree ──────────────────────────────────────────
-- owner_id / depth let the report indent a rolled-up subtree under the account
-- that was actually mapped, instead of a flat list in which the parent reads
-- 0.00 for no visible reason. Ordering is by the owner's code, then depth,
-- then code — i.e. each mapped account followed by what it brought with it.
DROP FUNCTION IF EXISTS public.rpc_fs_statement_accounts(text, date, date, date, date);
CREATE FUNCTION public.rpc_fs_statement_accounts(
  p_statement_code text,
  p_date_from      date,
  p_date_to        date,
  p_cmp_date_from  date DEFAULT NULL,
  p_cmp_date_to    date DEFAULT NULL
)
RETURNS TABLE (
  line_id       uuid,
  account_id    uuid,
  account_code  text,
  account_name  text,
  account_type  text,
  owner_id      uuid,
  depth         integer,
  current_value numeric,
  compare_value numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE v_statement_id uuid;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_cmp_date_from IS NOT NULL AND (p_cmp_date_to IS NULL OR p_cmp_date_to < p_cmp_date_from) THEN
    RAISE EXCEPTION 'Invalid comparative range' USING ERRCODE = '22007';
  END IF;

  SELECT id INTO v_statement_id FROM public.fs_statements
  WHERE tenant_id = public.get_user_tenant_id() AND code = p_statement_code;
  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'No statement with code % for this tenant', p_statement_code USING ERRCODE = '42704';
  END IF;

  IF p_cmp_date_from IS NULL THEN
    RETURN QUERY
    SELECT cur.out_line_id, cur.out_account_id, a.account_code, a.account_name, a.account_type,
           cur.out_owner_id, cur.out_depth, cur.out_value, NULL::numeric
    FROM public.fn_fs_eval_accounts(v_statement_id, p_date_from, p_date_to) cur
    JOIN public.accounts a ON a.id = cur.out_account_id
    JOIN public.accounts o ON o.id = cur.out_owner_id
    ORDER BY o.account_code, cur.out_depth, a.account_code;
  ELSE
    RETURN QUERY
    SELECT cur.out_line_id, cur.out_account_id, a.account_code, a.account_name, a.account_type,
           cur.out_owner_id, cur.out_depth, cur.out_value, cmp.out_value
    FROM public.fn_fs_eval_accounts(v_statement_id, p_date_from, p_date_to) cur
    JOIN public.accounts a ON a.id = cur.out_account_id
    JOIN public.accounts o ON o.id = cur.out_owner_id
    LEFT JOIN public.fn_fs_eval_accounts(v_statement_id, p_cmp_date_from, p_cmp_date_to) cmp
           ON cmp.out_line_id = cur.out_line_id AND cmp.out_account_id = cur.out_account_id
    ORDER BY o.account_code, cur.out_depth, a.account_code;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_statement_accounts(text, date, date, date, date) TO authenticated;

-- ── 6. Coverage: "mapped" now means mapped or covered by an ancestor ────────
-- Without this, every child of a mapped parent is reported as an unmapped
-- account the moment the roll-up starts including it — the report would
-- contradict its own figures. Body is 20260816000002's, with the three
-- membership tests rewritten against the expanded mapping.
CREATE OR REPLACE FUNCTION public.rpc_fs_coverage(
  p_statement_code text,
  p_date_from      date,
  p_date_to        date
)
RETURNS TABLE (
  issue_code   text,
  severity     text,
  account_id   uuid,
  account_code text,
  account_name text,
  detail       text,
  amount       numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_tenant       uuid := public.get_user_tenant_id();
  v_statement_id uuid;
  v_profit_line  uuid;
  v_stmt_profit  numeric;
  v_tb_profit    numeric;
  v_cycle_msg    text;
  v_bs_count     int;
  v_bs_amount    numeric;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;

  SELECT id INTO v_statement_id FROM public.fs_statements
  WHERE tenant_id = v_tenant AND code = p_statement_code;
  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'No statement with code % for this tenant', p_statement_code USING ERRCODE = '42704';
  END IF;

  BEGIN
    PERFORM * FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '55000' THEN
      GET STACKED DIAGNOSTICS v_cycle_msg = MESSAGE_TEXT;
      RETURN QUERY SELECT 'CYCLE', 'error', NULL::uuid, NULL::text, NULL::text, v_cycle_msg, NULL::numeric;
      RETURN;
    ELSE
      RAISE;
    END IF;
  END;

  -- UNMAPPED_ACCOUNT (error): a P&L account with movement that no line picks
  -- up, directly or through a mapped ancestor. This is how a statement quietly
  -- understates income, so it stays an error.
  RETURN QUERY
  SELECT 'UNMAPPED_ACCOUNT', 'error', a.id, a.account_code, a.account_name,
         'Account has period movement but is not mapped to any line of this statement',
         round(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 2)
  FROM public.accounts a
  JOIN public.journal_lines jl ON jl.account_id = a.id
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE a.tenant_id = v_tenant
    AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
    AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_date_from AND p_date_to
    AND NOT EXISTS (
      SELECT 1 FROM public.fn_fs_line_accounts_expanded(v_statement_id) e
      WHERE e.out_account_id = a.id
    )
  GROUP BY a.id, a.account_code, a.account_name
  HAVING abs(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0))) > 0.005;

  -- UNMAPPED_BS_ACCOUNT (warning): asset/liability/equity accounts carrying a
  -- balance at date_to that are not on this statement. A SOCI that omits them
  -- is the standard presentation, so this can never be an error — it exists so
  -- that "everything is on the statement" is a checkable claim, not a hope.
  SELECT count(*), round(SUM(abs(q.bal)), 2) INTO v_bs_count, v_bs_amount
  FROM (
    SELECT a.id,
           COALESCE(o.debit,0) - COALESCE(o.credit,0)
             + COALESCE(SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)), 0) AS bal
    FROM public.accounts a
    LEFT JOIN public.opening_balances o
           ON o.account_id = a.id AND o.tenant_id = v_tenant
          AND o.fiscal_period_id = (
            SELECT fp.id FROM public.fiscal_periods fp
            WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
            ORDER BY fp.period_start DESC LIMIT 1
          )
    LEFT JOIN public.journal_lines jl ON jl.account_id = a.id
    LEFT JOIN public.journal_entries je ON je.id = jl.journal_entry_id
         AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
         AND je.entry_date <= p_date_to
    WHERE a.tenant_id = v_tenant
      AND a.account_type IN ('Asset', 'Liability', 'Equity')
      AND NOT EXISTS (
        SELECT 1 FROM public.fn_fs_line_accounts_expanded(v_statement_id) e
        WHERE e.out_account_id = a.id
      )
    GROUP BY a.id, o.debit, o.credit
  ) q
  WHERE abs(q.bal) > 0.005;

  IF COALESCE(v_bs_count, 0) > 0 THEN
    RETURN QUERY SELECT 'UNMAPPED_BS_ACCOUNT', 'warning', NULL::uuid, NULL::text, NULL::text,
      v_bs_count || ' balance-sheet account(s) carrying a balance at this date are not on this statement — normal for a statement of comprehensive income, map them only if they belong on its face',
      v_bs_amount;
  END IF;

  -- MISSING_PARAM
  RETURN QUERY
  SELECT 'MISSING_PARAM', 'warning', NULL::uuid, NULL::text, NULL::text,
         'Line "' || l.label || '" needs fs_parameters[' || l.param_key || '] for this period, which is not set — EPS will render blank', NULL::numeric
  FROM public.fs_lines l
  WHERE l.statement_id = v_statement_id AND l.line_type = 'per_share'
    AND NOT EXISTS (
      SELECT 1 FROM public.fs_parameters p, public.fiscal_periods fp
      WHERE p.tenant_id = v_tenant AND p.key = l.param_key
        AND fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
        AND p.fiscal_period_id = fp.id
    );

  -- TIE_OUT_VARIANCE, excluding P&L accounts parked off the profit roll-up.
  -- "Parked" is now also inherited: a P&L account swept onto a memorandum line
  -- by a mapped ancestor is just as absent from profit as one mapped there
  -- directly, and the trial-balance side has to agree.
  SELECT id INTO v_profit_line FROM public.fs_lines
  WHERE statement_id = v_statement_id AND line_code = 'PROFIT_FOR_YEAR';

  IF v_profit_line IS NOT NULL THEN
    SELECT value INTO v_stmt_profit
    FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to)
    WHERE line_id = v_profit_line;

    WITH RECURSIVE in_profit(line_id) AS (
      SELECT v_profit_line
      UNION
      SELECT t.term_line_id
      FROM public.fs_line_terms t
      JOIN in_profit p ON p.line_id = t.line_id
    ),
    parked AS (
      SELECT e.out_account_id AS account_id
      FROM public.fn_fs_line_accounts_expanded(v_statement_id) e
      WHERE NOT EXISTS (SELECT 1 FROM in_profit ip WHERE ip.line_id = e.out_line_id)
    )
    SELECT SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)) INTO v_tb_profit
    FROM public.accounts a
    JOIN public.journal_lines jl ON jl.account_id = a.id
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE a.tenant_id = v_tenant
      AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense')
      AND je.tenant_id = v_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
      AND a.id NOT IN (SELECT pk.account_id FROM parked pk);

    IF abs(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0)) > 0.005 THEN
      RETURN QUERY SELECT 'TIE_OUT_VARIANCE', 'error', NULL::uuid, NULL::text, NULL::text,
        'Profit for the year does not tie to the trial balance''s net P&L movement for this range',
        round(COALESCE(v_stmt_profit,0) - COALESCE(v_tb_profit,0), 2);
    END IF;
  END IF;
END
$fn$;

-- Volatility is load-bearing: PostgREST reads it to decide whether to open a
-- read-only transaction, and nothing in this chain writes.
ALTER FUNCTION public.rpc_fs_coverage(text, date, date) STABLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_fs_eval_statement', 'fn_fs_eval_accounts', 'fn_fs_line_accounts_expanded')
      AND pg_get_functiondef(p.oid) ILIKE '%CREATE TEMP TABLE%'
  ) THEN
    RAISE EXCEPTION 'The statement evaluator must not create temp tables — PostgREST runs it in a read-only transaction.';
  END IF;
END $$;
