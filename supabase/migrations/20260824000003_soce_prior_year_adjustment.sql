-- Prior Year Adjustment, for real now. 20260823000002 always read this as 0
-- because nothing in this schema tagged a journal entry as a PYA — the
-- validate-journal-entry edge function now accepts is_prior_year_adjustment
-- and sets journal_entries.entry_type = 'prior_year_adjustment' when checked.
--
-- Computed per equity category (not only the retained-earnings-equivalent
-- column) — a PYA can correct any equity account, e.g. a misstated Stated
-- Capital balance, not only retained earnings.

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
  v_open numeric; v_close numeric; v_cat_profit numeric; v_cat_div numeric; v_cat_pya numeric; v_cat_other numeric;
  v_opening jsonb := '{}'::jsonb;
  v_pya     jsonb := '{}'::jsonb;
  v_profit_row jsonb := '{}'::jsonb;
  v_div_row jsonb := '{}'::jsonb;
  v_other_row jsonb := '{}'::jsonb;
  v_closing jsonb := '{}'::jsonb;
  v_tot_open numeric := 0; v_tot_close numeric := 0; v_tot_profit numeric := 0; v_tot_div numeric := 0; v_tot_pya numeric := 0; v_tot_other numeric := 0;
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

    SELECT COALESCE(SUM(COALESCE(jl.credit,0) - COALESCE(jl.debit,0)), 0) INTO v_cat_pya
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = p_tenant AND je.status = 'posted' AND je.voided_at IS NULL
      AND je.entry_type = 'prior_year_adjustment'
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND jl.account_id = ANY(v_account_ids);

    v_cat_other := v_close - v_open - v_cat_pya - v_cat_profit - v_cat_div;

    v_opening := v_opening || jsonb_build_object(v_cat, round(v_open, 2));
    v_pya := v_pya || jsonb_build_object(v_cat, round(v_cat_pya, 2));
    v_profit_row := v_profit_row || jsonb_build_object(v_cat, round(v_cat_profit, 2));
    v_div_row := v_div_row || jsonb_build_object(v_cat, round(v_cat_div, 2));
    v_other_row := v_other_row || jsonb_build_object(v_cat, round(v_cat_other, 2));
    v_closing := v_closing || jsonb_build_object(v_cat, round(v_close, 2));

    v_tot_open := v_tot_open + v_open;
    v_tot_close := v_tot_close + v_close;
    v_tot_profit := v_tot_profit + v_cat_profit;
    v_tot_div := v_tot_div + v_cat_div;
    v_tot_pya := v_tot_pya + v_cat_pya;
    v_tot_other := v_tot_other + v_cat_other;
  END LOOP;

  v_opening := v_opening || jsonb_build_object('Total', round(v_tot_open, 2));
  v_pya := v_pya || jsonb_build_object('Total', round(v_tot_pya, 2));
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
