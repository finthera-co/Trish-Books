-- Statement of Changes in Equity, round 2: dynamic reserve columns.
--
-- The first version hardcoded exactly two columns — Stated Capital and
-- Revenue Reserves — which is too narrow for IAS 1.106: an entity with a
-- Revaluation Reserve, a General Reserve, etc. should show each as its own
-- column, not folded together.
--
-- Columns are now one per distinct account_subtype among the tenant's
-- postable Equity accounts (a null subtype groups under "Other Equity").
-- Exactly one column absorbs the all-time P&L movement (the same technique
-- as SFP/CF: this system posts no closing entries, so retained profit has
-- to be added synthetically — see 20260823000000's header comment) —
-- 'Retained Earnings' if that subtype exists among the tenant's accounts,
-- else 'Owner''s Equity', else a synthetic 'Retained Earnings' column with
-- no backing ledger account, so profit is never silently dropped. Dividends
-- accounts (subtype 'Dividends') are folded into whichever column absorbs
-- P&L — a dividend reduces retained earnings, it is not its own equity
-- category — and still populate their own row (the Dividends movement row),
-- component of that column's total change, not a separate column.
--
-- fn_soce_balance_asof (20260823000002) is unchanged and reused as-is.

CREATE OR REPLACE FUNCTION public.fn_soce_period_block_v2(
  p_tenant        uuid,
  p_categories    text[],
  p_absorbing     text,
  p_period_start  date,
  p_period_end    date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_pl_ids  uuid[];
  v_div_ids uuid[];
  v_pl_open numeric;
  v_pl_close numeric;
  v_profit  numeric;
  v_dividends numeric;
  v_cat text;
  v_account_ids uuid[];
  v_open numeric; v_close numeric; v_cat_profit numeric; v_cat_div numeric; v_cat_other numeric;
  v_opening jsonb := '{}'::jsonb;
  v_pya     jsonb := '{}'::jsonb;
  v_profit_row jsonb := '{}'::jsonb;
  v_div_row jsonb := '{}'::jsonb;
  v_other_row jsonb := '{}'::jsonb;
  v_closing jsonb := '{}'::jsonb;
  v_tot_open numeric := 0; v_tot_close numeric := 0; v_tot_profit numeric := 0; v_tot_div numeric := 0; v_tot_other numeric := 0;
BEGIN
  SELECT array_agg(a.id) INTO v_pl_ids
  FROM public.accounts a
  WHERE a.tenant_id = p_tenant AND a.is_postable IS NOT FALSE
    AND a.account_type IN ('Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense');

  SELECT array_agg(a.id) INTO v_div_ids
  FROM public.accounts a
  WHERE a.tenant_id = p_tenant AND a.is_postable IS NOT FALSE AND a.account_subtype = 'Dividends';

  v_pl_open := public.fn_soce_balance_asof(p_tenant, v_pl_ids, p_period_start - 1);
  v_pl_close := public.fn_soce_balance_asof(p_tenant, v_pl_ids, p_period_end);

  SELECT COALESCE(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 0) INTO v_profit
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_period_start AND p_period_end
    AND jl.account_id = ANY(v_pl_ids);

  SELECT COALESCE(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 0) INTO v_dividends
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_period_start AND p_period_end
    AND jl.account_id = ANY(v_div_ids);

  FOREACH v_cat IN ARRAY p_categories LOOP
    SELECT array_agg(a.id) INTO v_account_ids
    FROM public.accounts a
    WHERE a.tenant_id = p_tenant AND a.account_type = 'Equity' AND a.is_postable IS NOT FALSE
      AND (a.account_subtype = v_cat OR (v_cat = p_absorbing AND a.account_subtype = 'Dividends'));

    v_open := public.fn_soce_balance_asof(p_tenant, v_account_ids, p_period_start - 1);
    v_close := public.fn_soce_balance_asof(p_tenant, v_account_ids, p_period_end);

    IF v_cat = p_absorbing THEN
      v_open := v_open + v_pl_open;
      v_close := v_close + v_pl_close;
      v_cat_profit := v_profit;
      v_cat_div := v_dividends;
    ELSE
      v_cat_profit := 0;
      v_cat_div := 0;
    END IF;
    v_cat_other := v_close - v_open - v_cat_profit - v_cat_div; -- prior_year_adj is always 0

    v_opening := v_opening || jsonb_build_object(v_cat, round(v_open, 2));
    v_pya := v_pya || jsonb_build_object(v_cat, 0);
    v_profit_row := v_profit_row || jsonb_build_object(v_cat, round(v_cat_profit, 2));
    v_div_row := v_div_row || jsonb_build_object(v_cat, round(v_cat_div, 2));
    v_other_row := v_other_row || jsonb_build_object(v_cat, round(v_cat_other, 2));
    v_closing := v_closing || jsonb_build_object(v_cat, round(v_close, 2));

    v_tot_open := v_tot_open + v_open;
    v_tot_close := v_tot_close + v_close;
    v_tot_profit := v_tot_profit + v_cat_profit;
    v_tot_div := v_tot_div + v_cat_div;
    v_tot_other := v_tot_other + v_cat_other;
  END LOOP;

  v_opening := v_opening || jsonb_build_object('Total', round(v_tot_open, 2));
  v_pya := v_pya || jsonb_build_object('Total', 0);
  v_profit_row := v_profit_row || jsonb_build_object('Total', round(v_tot_profit, 2));
  v_div_row := v_div_row || jsonb_build_object('Total', round(v_tot_div, 2));
  v_other_row := v_other_row || jsonb_build_object('Total', round(v_tot_other, 2));
  v_closing := v_closing || jsonb_build_object('Total', round(v_tot_close, 2));

  RETURN jsonb_build_object(
    'opening_balance', v_opening,
    'prior_year_adjustment', v_pya,
    'profit_for_year', v_profit_row,
    'dividends', v_div_row,
    'other_movements', v_other_row,
    'closing_balance', v_closing
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_soce_period_block_v2(uuid, text[], text, date, date) TO authenticated;

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
  v_categories text[];
  v_absorbing  text;
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

  SELECT array_agg(DISTINCT COALESCE(a.account_subtype, 'Other Equity') ORDER BY COALESCE(a.account_subtype, 'Other Equity'))
  INTO v_categories
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant AND a.account_type = 'Equity' AND a.is_postable IS NOT FALSE
    AND a.account_subtype IS DISTINCT FROM 'Dividends';

  v_absorbing := CASE
    WHEN 'Retained Earnings' = ANY(COALESCE(v_categories, ARRAY[]::text[])) THEN 'Retained Earnings'
    WHEN 'Owner''s Equity' = ANY(COALESCE(v_categories, ARRAY[]::text[])) THEN 'Owner''s Equity'
    ELSE NULL
  END;

  IF v_absorbing IS NULL THEN
    v_categories := COALESCE(v_categories, ARRAY[]::text[]) || ARRAY['Retained Earnings'];
    v_absorbing := 'Retained Earnings';
  END IF;

  -- Stated Capital first, then the absorbing (retained-earnings) column,
  -- then everything else alphabetically — matches how these statements are
  -- conventionally read.
  SELECT array_agg(c ORDER BY (c = 'Stated Capital') DESC, (c = v_absorbing) DESC, c)
  INTO v_categories
  FROM unnest(v_categories) c;

  v_result := jsonb_build_object(
    'columns', to_jsonb(v_categories) || to_jsonb(ARRAY['Total']),
    'current_period', public.fn_soce_period_block_v2(v_tenant, v_categories, v_absorbing, p_period_start, p_period_end)
  );

  IF p_cmp_period_start IS NOT NULL THEN
    v_result := v_result || jsonb_build_object(
      'comparative_period', public.fn_soce_period_block_v2(v_tenant, v_categories, v_absorbing, p_cmp_period_start, p_cmp_period_end)
    );
  END IF;

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_changes_in_equity(date, date, date, date) TO authenticated;
