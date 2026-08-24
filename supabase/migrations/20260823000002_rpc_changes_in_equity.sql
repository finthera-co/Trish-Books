-- Statement of Changes in Equity. Genuinely bespoke — unlike the Balance
-- Sheet and Cash Flow statements (20260823000000/1), its shape is a matrix
-- (movement type x Stated Capital / Revenue Reserves / Total, two stacked
-- year-blocks), which the fs_lines engine's flat list of lines cannot render.
-- Self-contained: does not read SOCI's or SFP's account mappings, so it works
-- correctly even if those haven't been mapped yet.
--
-- Same "no closing entries" problem as SFP (20260823000000): Revenue Reserves
-- as at any date is the Retained-Earnings-type accounts' own balance PLUS
-- all-time P&L movement up to that date, not just the RE account's balance.
-- fn_soce_balance_asof below reproduces the fs engine's own "audit opening +
-- movement" formula for an arbitrary date and arbitrary account set (the
-- engine's own fn_fs_eval_accounts is keyed to an fs_lines mapping, so it
-- cannot be called directly for an ad hoc account grouping like "every
-- Equity account except Stated Capital").
--
-- Prior Year Adjustment is always reported as 0. There is no entry_type or
-- other tag anywhere in this schema that marks a journal entry as a prior-
-- year adjustment (confirmed: only 'manual' and 'opening_balance' are used
-- anywhere) — guessing at it via description text matching would be exactly
-- the kind of fragile heuristic this codebase already avoids elsewhere (see
-- the bank-statement-import "never-guess" engine). "Other Movements" is a
-- plug (closing − opening − prior_year_adjustment − profit − dividends) so
-- the roll-forward always foots exactly, with any unmodeled movement (a
-- manual equity adjustment, a share issue, etc.) landing there visibly
-- instead of silently vanishing into an approximation.

CREATE OR REPLACE FUNCTION public.fn_soce_balance_asof(
  p_tenant       uuid,
  p_account_ids  uuid[],
  p_asof         date
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_period_id    uuid;
  v_period_start date;
  v_ob           numeric;
  v_mv           numeric;
BEGIN
  IF p_account_ids IS NULL OR array_length(p_account_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT fp.id, fp.period_start INTO v_period_id, v_period_start
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = p_tenant AND p_asof BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  IF v_period_id IS NOT NULL THEN
    SELECT SUM(COALESCE(o.credit,0) - COALESCE(o.debit,0)) INTO v_ob
    FROM public.opening_balances o
    WHERE o.tenant_id = p_tenant AND o.fiscal_period_id = v_period_id
      AND o.account_id = ANY(p_account_ids);
  END IF;

  IF v_ob IS NULL THEN
    -- No override for the period containing p_asof: ledger movement for
    -- everything up to and including p_asof, credit-debit.
    SELECT SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)) INTO v_mv
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date <= p_asof
      AND jl.account_id = ANY(p_account_ids);
    RETURN COALESCE(v_mv, 0);
  ELSE
    -- Override exists for that period: the override plus everything posted
    -- from the period's own start through p_asof — identical in shape to
    -- fn_fs_eval_accounts' ob/open_mv/period_mv split (20260818150000), just
    -- evaluated for one date instead of a [date_from, date_to] range.
    SELECT SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)) INTO v_mv
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_date BETWEEN v_period_start AND p_asof
      AND jl.account_id = ANY(p_account_ids);
    RETURN v_ob + COALESCE(v_mv, 0);
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_soce_balance_asof(uuid, uuid[], date) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_soce_period_block(
  p_tenant             uuid,
  p_stated_capital_ids uuid[],
  p_other_equity_ids   uuid[],
  p_pl_ids             uuid[],
  p_dividend_ids       uuid[],
  p_period_start       date,
  p_period_end         date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_sc_open  numeric := public.fn_soce_balance_asof(p_tenant, p_stated_capital_ids, p_period_start - 1);
  v_sc_close numeric := public.fn_soce_balance_asof(p_tenant, p_stated_capital_ids, p_period_end);
  v_oe_open  numeric := public.fn_soce_balance_asof(p_tenant, p_other_equity_ids, p_period_start - 1);
  v_oe_close numeric := public.fn_soce_balance_asof(p_tenant, p_other_equity_ids, p_period_end);
  v_pl_open  numeric := public.fn_soce_balance_asof(p_tenant, p_pl_ids, p_period_start - 1);
  v_pl_close numeric := public.fn_soce_balance_asof(p_tenant, p_pl_ids, p_period_end);
  v_rr_open  numeric := v_oe_open + v_pl_open;
  v_rr_close numeric := v_oe_close + v_pl_close;
  v_profit   numeric;
  v_dividends numeric;
  v_sc_other numeric;
  v_rr_other numeric;
BEGIN
  SELECT COALESCE(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 0) INTO v_profit
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_period_start AND p_period_end
    AND jl.account_id = ANY(p_pl_ids);

  SELECT COALESCE(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 0) INTO v_dividends
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_period_start AND p_period_end
    AND jl.account_id = ANY(p_dividend_ids);

  v_sc_other := v_sc_close - v_sc_open;                              -- prior_year_adj and profit/dividends never touch stated capital
  v_rr_other := v_rr_close - v_rr_open - v_profit - v_dividends;      -- prior_year_adj is always 0

  RETURN jsonb_build_object(
    'opening_balance', jsonb_build_object('stated_capital', round(v_sc_open,2), 'revenue_reserves', round(v_rr_open,2), 'total', round(v_sc_open+v_rr_open,2)),
    'prior_year_adjustment', jsonb_build_object('stated_capital', 0, 'revenue_reserves', 0, 'total', 0),
    'profit_for_year', jsonb_build_object('stated_capital', 0, 'revenue_reserves', round(v_profit,2), 'total', round(v_profit,2)),
    'dividends', jsonb_build_object('stated_capital', 0, 'revenue_reserves', round(v_dividends,2), 'total', round(v_dividends,2)),
    'other_movements', jsonb_build_object('stated_capital', round(v_sc_other,2), 'revenue_reserves', round(v_rr_other,2), 'total', round(v_sc_other+v_rr_other,2)),
    'closing_balance', jsonb_build_object('stated_capital', round(v_sc_close,2), 'revenue_reserves', round(v_rr_close,2), 'total', round(v_sc_close+v_rr_close,2))
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_soce_period_block(uuid, uuid[], uuid[], uuid[], uuid[], date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_changes_in_equity(
  p_period_start     date,
  p_period_end       date,
  p_cmp_period_start date DEFAULT NULL,
  p_cmp_period_end   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stated_capital_ids uuid[];
  v_pl_ids             uuid[];
  v_dividend_ids        uuid[];
  v_other_equity_ids   uuid[];
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context' USING ERRCODE = '28000';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid range: period_end (%) precedes period_start (%)', p_period_end, p_period_start
      USING ERRCODE = '22007';
  END IF;
  IF p_cmp_period_start IS NOT NULL AND (p_cmp_period_end IS NULL OR p_cmp_period_end < p_cmp_period_start) THEN
    RAISE EXCEPTION 'Invalid comparative range' USING ERRCODE = '22007';
  END IF;

  SELECT array_agg(a.id) INTO v_stated_capital_ids
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant AND a.account_type = 'Equity' AND a.is_postable IS NOT FALSE
    AND (a.account_subtype ILIKE '%stated capital%' OR a.account_subtype ILIKE '%share capital%'
         OR a.account_name ILIKE '%stated capital%' OR a.account_name ILIKE '%share capital%');

  SELECT array_agg(a.id) INTO v_other_equity_ids
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant AND a.account_type = 'Equity' AND a.is_postable IS NOT FALSE
    AND NOT (a.id = ANY(COALESCE(v_stated_capital_ids, ARRAY[]::uuid[])));

  SELECT array_agg(a.id) INTO v_pl_ids
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant AND a.is_postable IS NOT FALSE
    AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense');

  SELECT array_agg(a.id) INTO v_dividend_ids
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant AND a.is_postable IS NOT FALSE AND a.account_subtype = 'Dividends';

  v_result := jsonb_build_object(
    'columns', jsonb_build_array('Stated Capital', 'Revenue Reserves', 'Total'),
    'current_period', public.fn_soce_period_block(v_tenant, v_stated_capital_ids, v_other_equity_ids, v_pl_ids, v_dividend_ids, p_period_start, p_period_end)
  );

  IF p_cmp_period_start IS NOT NULL THEN
    v_result := v_result || jsonb_build_object(
      'comparative_period', public.fn_soce_period_block(v_tenant, v_stated_capital_ids, v_other_equity_ids, v_pl_ids, v_dividend_ids, p_cmp_period_start, p_cmp_period_end)
    );
  END IF;

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_changes_in_equity(date, date, date, date) TO authenticated;
