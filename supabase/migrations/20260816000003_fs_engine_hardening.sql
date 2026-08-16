-- Statement engine: per-account valuation, hardening, and guardrails.
--
-- The centrepiece is fn_fs_eval_accounts. Until now a detail line's figure was
-- computed inline inside fn_fs_eval_statement, so showing the ledgers BEHIND a
-- line would have meant writing that arithmetic a second time — and a second
-- implementation is a second answer. The per-account valuation is now the only
-- implementation: fn_fs_eval_accounts values one account on one line, and the
-- line total is defined as the SUM of it. A child can therefore never fail to
-- add up to its parent, because the parent is nothing but the children added up.
--
-- Also fixed here:
--
-- A. PERFORMANCE REGRESSION (introduced by 20260816000002). The cumulative
--    basis made the evaluator read every mapped account's history back to
--    inception even on statements with no cumulative line — i.e. every
--    statement that has not had a balance-sheet account mapped onto it. The
--    pre-period read is now confined to accounts actually sitting on a
--    cumulative line, so a pure-P&L statement touches exactly the rows it did
--    before.
--
-- B. SHARED TEMP TABLE. fn_fs_eval_statement holds its fixed-point state in a
--    fixed-name temp table it DELETEs on entry. rpc_fs_statement called it
--    TWICE INSIDE ONE STATEMENT on every request, comparative or not — two
--    executions sharing one scratch table, correct only while the planner
--    happens to drain one function scan before starting the other. That is a
--    planner-dependent assumption, not a guarantee. The no-comparative path no
--    longer makes the second call at all, and the comparative path forces the
--    ordering with MATERIALIZED CTEs.
--
-- C. MISSING GUARDRAIL. Nothing stopped a closing-balance line being wired
--    into profit — an asset balance added to earnings. Prose is not a control;
--    two triggers now walk the term graph and refuse, from both directions.
--
-- D. value_basis was settable on line types where it means nothing.

-- ── D. value_basis only means something on a detail line ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fs_lines_value_basis_detail_only') THEN
    ALTER TABLE public.fs_lines
      ADD CONSTRAINT fs_lines_value_basis_detail_only
      CHECK (value_basis = 'period' OR line_type = 'detail');
  END IF;
END $$;

-- ── 1. Per-account valuation — the single source of truth ───────────────────
-- OUT columns are prefixed out_ deliberately: a RETURNS TABLE column name is
-- also a plpgsql variable, and an unqualified reference to one elsewhere in the
-- body raises 42702 at EXECUTION time, so a migration can push clean and leave
-- the function broken. Prefixing removes the whole class of trap.
CREATE OR REPLACE FUNCTION public.fn_fs_eval_accounts(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (out_line_id uuid, out_account_id uuid, out_value numeric)
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
    SELECT l.id AS line_id, l.sign, l.value_basis, la.account_id
    FROM public.fs_lines l
    JOIN public.fs_line_accounts la ON la.line_id = l.id
    WHERE l.statement_id = p_statement_id AND l.line_type = 'detail'
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
  SELECT la.line_id, la.account_id,
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

-- ── 2. Line evaluator: detail lines are now SUM(per-account) ────────────────
CREATE OR REPLACE FUNCTION public.fn_fs_eval_statement(
  p_statement_id uuid,
  p_date_from    date,
  p_date_to      date
)
RETURNS TABLE (line_id uuid, value numeric, margin numeric, account_count integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_pass       int;
  v_rows       int;
  v_unresolved int;
  v_tenant     uuid := public.get_user_tenant_id();
  v_period_id  uuid;
  v_base_value numeric;
BEGIN
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_tenant AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  CREATE TEMP TABLE IF NOT EXISTS fs_eval_values (
    line_id uuid PRIMARY KEY, value numeric, resolved boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  DELETE FROM fs_eval_values WHERE true;

  INSERT INTO fs_eval_values (line_id, value, resolved)
  SELECT id, NULL, false FROM public.fs_lines WHERE statement_id = p_statement_id;

  -- 1. detail lines. One arithmetic, shared with the drill-down.
  UPDATE fs_eval_values ev
  SET value = COALESCE(sub.v, 0), resolved = true
  FROM (
    SELECT a.out_line_id AS acc_line_id, SUM(a.out_value) AS v
    FROM public.fn_fs_eval_accounts(p_statement_id, p_date_from, p_date_to) a
    GROUP BY a.out_line_id
  ) sub
  WHERE ev.line_id = sub.acc_line_id;

  UPDATE fs_eval_values ev SET value = 0, resolved = true
  FROM public.fs_lines l
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type = 'detail' AND NOT ev.resolved;

  UPDATE fs_eval_values ev SET resolved = true
  FROM public.fs_lines l
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type IN ('spacer', 'text') AND NOT ev.resolved;

  -- 2. computed lines: fixed-point iteration, bounded at 20 passes.
  FOR v_pass IN 1..20 LOOP
    UPDATE fs_eval_values ev
    SET value = sub.v, resolved = true
    FROM (
      SELECT l.id AS c_line_id, SUM(t.factor * evt.value) AS v
      FROM public.fs_lines l
      JOIN public.fs_line_terms t ON t.line_id = l.id
      JOIN fs_eval_values evt ON evt.line_id = t.term_line_id
      WHERE l.statement_id = p_statement_id AND l.line_type = 'computed'
      GROUP BY l.id
      HAVING bool_and(evt.resolved)
    ) sub
    WHERE ev.line_id = sub.c_line_id AND NOT ev.resolved;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;

  SELECT count(*) INTO v_unresolved
  FROM fs_eval_values ev JOIN public.fs_lines l ON l.id = ev.line_id
  WHERE l.statement_id = p_statement_id AND l.line_type = 'computed' AND NOT ev.resolved;
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'CYCLE: % computed line(s) on this statement never reached a fixed point — check fs_line_terms for a cycle', v_unresolved
      USING ERRCODE = '55000';
  END IF;

  -- 3. per_share
  UPDATE fs_eval_values ev
  SET value = CASE WHEN p.value IS NULL OR p.value = 0 THEN NULL ELSE evt.value / p.value END,
      resolved = true
  FROM public.fs_lines l
  JOIN public.fs_line_terms t ON t.line_id = l.id
  JOIN fs_eval_values evt ON evt.line_id = t.term_line_id
  LEFT JOIN public.fs_parameters p
         ON p.tenant_id = v_tenant AND p.key = l.param_key
        AND p.fiscal_period_id IS NOT DISTINCT FROM v_period_id
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type = 'per_share' AND NOT ev.resolved;

  UPDATE fs_eval_values ev SET value = NULL, resolved = true
  FROM public.fs_lines l
  WHERE ev.line_id = l.id AND l.statement_id = p_statement_id
    AND l.line_type = 'per_share' AND NOT ev.resolved;

  -- 4. margin
  SELECT ev.value INTO v_base_value
  FROM public.fs_lines l JOIN fs_eval_values ev ON ev.line_id = l.id
  WHERE l.statement_id = p_statement_id AND l.is_margin_base LIMIT 1;

  RETURN QUERY
  SELECT
    ev.line_id,
    ev.value,
    CASE WHEN l.show_margin AND v_base_value IS NOT NULL AND v_base_value <> 0
         THEN round(ev.value / v_base_value * 100, 2) ELSE NULL END,
    COALESCE(la.n, 0)::int
  FROM fs_eval_values ev
  JOIN public.fs_lines l ON l.id = ev.line_id
  LEFT JOIN (
    SELECT fla.line_id AS mapped_line_id, count(*) AS n
    FROM public.fs_line_accounts fla
    GROUP BY fla.line_id
  ) la ON la.mapped_line_id = ev.line_id
  WHERE l.statement_id = p_statement_id;
END
$fn$;

-- ── 3. rpc_fs_statement: one evaluation unless a comparative was asked for ──
CREATE OR REPLACE FUNCTION public.rpc_fs_statement(
  p_statement_code text,
  p_date_from      date,
  p_date_to        date,
  p_cmp_date_from  date DEFAULT NULL,
  p_cmp_date_to    date DEFAULT NULL
)
RETURNS TABLE (
  line_id        uuid,
  line_code      text,
  label          text,
  note_ref       text,
  line_type      text,
  emphasis       text,
  show_margin    boolean,
  sort_order     integer,
  current_value  numeric,
  compare_value  numeric,
  current_margin numeric,
  compare_margin numeric,
  account_count  integer
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE v_statement_id uuid;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit' USING ERRCODE = '22003';
  END IF;
  IF p_cmp_date_from IS NOT NULL THEN
    IF p_cmp_date_to IS NULL OR p_cmp_date_to < p_cmp_date_from THEN
      RAISE EXCEPTION 'Invalid comparative range' USING ERRCODE = '22007';
    END IF;
  END IF;

  SELECT id INTO v_statement_id FROM public.fs_statements
  WHERE tenant_id = public.get_user_tenant_id() AND code = p_statement_code;
  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'No statement with code % for this tenant', p_statement_code USING ERRCODE = '42704';
  END IF;

  IF p_cmp_date_from IS NULL THEN
    -- No comparative: evaluate once. The old shape evaluated the current range
    -- a second time purely to null the columns out.
    RETURN QUERY
    SELECT l.id, l.line_code, l.label, l.note_ref, l.line_type, l.emphasis, l.show_margin, l.sort_order,
           cur.value, NULL::numeric, cur.margin, NULL::numeric, cur.account_count
    FROM public.fs_lines l
    JOIN public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to) cur ON cur.line_id = l.id
    WHERE l.statement_id = v_statement_id
    ORDER BY l.sort_order;
  ELSE
    -- Comparative: the evaluator reuses one fixed-name temp table, so the two
    -- calls must not interleave. MATERIALIZED forces each CTE to be drained in
    -- full before the next is pulled.
    RETURN QUERY
    WITH cur AS MATERIALIZED (
      SELECT * FROM public.fn_fs_eval_statement(v_statement_id, p_date_from, p_date_to)
    ),
    cmp AS MATERIALIZED (
      SELECT * FROM public.fn_fs_eval_statement(v_statement_id, p_cmp_date_from, p_cmp_date_to)
    )
    SELECT l.id, l.line_code, l.label, l.note_ref, l.line_type, l.emphasis, l.show_margin, l.sort_order,
           cur.value, cmp.value, cur.margin, cmp.margin, cur.account_count
    FROM public.fs_lines l
    JOIN cur ON cur.line_id = l.id
    LEFT JOIN cmp ON cmp.line_id = l.id
    WHERE l.statement_id = v_statement_id
    ORDER BY l.sort_order;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_statement(text, date, date, date, date) TO authenticated;

-- ── 4. rpc_fs_statement_accounts: the ledgers behind each line ──────────────
-- Same valuation as the line totals, by construction. fn_fs_eval_accounts is
-- STABLE and holds no scratch state, so calling it twice in one statement is
-- safe — unlike fn_fs_eval_statement above.
CREATE OR REPLACE FUNCTION public.rpc_fs_statement_accounts(
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
           cur.out_value, NULL::numeric
    FROM public.fn_fs_eval_accounts(v_statement_id, p_date_from, p_date_to) cur
    JOIN public.accounts a ON a.id = cur.out_account_id
    ORDER BY a.account_code;
  ELSE
    RETURN QUERY
    SELECT cur.out_line_id, cur.out_account_id, a.account_code, a.account_name, a.account_type,
           cur.out_value, cmp.out_value
    FROM public.fn_fs_eval_accounts(v_statement_id, p_date_from, p_date_to) cur
    JOIN public.accounts a ON a.id = cur.out_account_id
    LEFT JOIN public.fn_fs_eval_accounts(v_statement_id, p_cmp_date_from, p_cmp_date_to) cmp
           ON cmp.out_line_id = cur.out_line_id AND cmp.out_account_id = cur.out_account_id
    ORDER BY a.account_code;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_statement_accounts(text, date, date, date, date) TO authenticated;

-- ── 5. C. A closing-balance line can never reach profit ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_fs_no_cumulative_in_profit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_statement_id uuid;
  v_profit_line  uuid;
  v_offender     text;
BEGIN
  SELECT l.statement_id INTO v_statement_id FROM public.fs_lines l WHERE l.id = NEW.line_id;

  SELECT l.id INTO v_profit_line
  FROM public.fs_lines l
  WHERE l.statement_id = v_statement_id AND l.line_code = 'PROFIT_FOR_YEAR';

  IF v_profit_line IS NULL THEN
    RETURN NEW;  -- no bottom line on this statement; nothing to protect
  END IF;

  -- Walk down from the profit line across the term graph AS IT WILL BE once
  -- this row exists, and look for a closing-balance line in the closure.
  WITH RECURSIVE terms AS (
    SELECT t.line_id AS parent_id, t.term_line_id AS child_id
    FROM public.fs_line_terms t
    WHERE t.line_id <> NEW.line_id OR t.term_line_id <> NEW.term_line_id
    UNION ALL
    SELECT NEW.line_id, NEW.term_line_id
  ),
  reach(reached_id) AS (
    SELECT v_profit_line
    UNION
    SELECT tt.child_id FROM terms tt JOIN reach r ON r.reached_id = tt.parent_id
  )
  SELECT l.label INTO v_offender
  FROM reach r
  JOIN public.fs_lines l ON l.id = r.reached_id
  WHERE l.value_basis = 'cumulative'
  LIMIT 1;

  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      'Line "%" is a closing-balance (balance sheet) line and cannot form part of profit for the year. Keep it in the memorandum section.',
      v_offender
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fs_no_cumulative_in_profit ON public.fs_line_terms;
CREATE TRIGGER trg_fs_no_cumulative_in_profit
  BEFORE INSERT OR UPDATE ON public.fs_line_terms
  FOR EACH ROW EXECUTE FUNCTION public.fn_fs_no_cumulative_in_profit();

-- The same hazard from the other direction: flipping a line that already feeds
-- profit over to a closing-balance basis.
CREATE OR REPLACE FUNCTION public.fn_fs_line_basis_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_profit_line uuid; v_hit boolean;
BEGIN
  IF NEW.value_basis <> 'cumulative' OR OLD.value_basis = 'cumulative' THEN
    RETURN NEW;
  END IF;

  SELECT l.id INTO v_profit_line FROM public.fs_lines l
  WHERE l.statement_id = NEW.statement_id AND l.line_code = 'PROFIT_FOR_YEAR';
  IF v_profit_line IS NULL THEN RETURN NEW; END IF;

  WITH RECURSIVE reach(reached_id) AS (
    SELECT v_profit_line
    UNION
    SELECT t.term_line_id FROM public.fs_line_terms t JOIN reach r ON r.reached_id = t.line_id
  )
  SELECT EXISTS (SELECT 1 FROM reach r WHERE r.reached_id = NEW.id) INTO v_hit;

  IF v_hit THEN
    RAISE EXCEPTION
      'Line "%" feeds profit for the year, so it cannot be switched to a closing-balance basis. Remove it from the profit formula first.',
      NEW.label USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fs_line_basis_guard ON public.fs_lines;
CREATE TRIGGER trg_fs_line_basis_guard
  BEFORE UPDATE OF value_basis ON public.fs_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_fs_line_basis_guard();
