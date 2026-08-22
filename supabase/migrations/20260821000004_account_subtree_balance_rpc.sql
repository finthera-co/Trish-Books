-- ============================================================
-- rpc_account_subtree_balance() — new, additive subtree rollup
--
-- Uses the persisted accounts.account_path column (now correctly maintained
-- across reparents/renames by fn_cascade_account_path_to_descendants, see
-- 20260821000002/3) as the natural way to select an account's whole subtree:
-- itself plus every descendant whose path starts with its own path.
--
-- This does NOT touch rpc_trial_balance or rpc_gl_account_tree — both already
-- work correctly today (the latter via its own from-scratch recursive
-- sort_path, not this column). This is new, additive infrastructure a report
-- or the Chart of Accounts page can opt into later; nothing existing is
-- rewired to use it by this migration.
--
-- Same date-range validation, opening-balance-override (audit vs. ledger),
-- and P&L-zero-reset rules as rpc_trial_balance / rpc_gl_account_tree, for
-- consistency with the rest of the reporting surface.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_account_subtree_balance(
  p_account_id UUID,
  p_date_from  DATE,
  p_date_to    DATE
)
RETURNS TABLE (
  account_id      UUID,
  account_code    TEXT,
  account_name    TEXT,
  account_type    TEXT,
  subtree_opening NUMERIC,
  subtree_debit   NUMERIC,
  subtree_credit  NUMERIC,
  subtree_closing NUMERIC,
  account_count   INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_root      RECORD;
  v_period_id UUID;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit (% days requested)', p_date_to - p_date_from
      USING ERRCODE = '22003';
  END IF;

  SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_path, a.tenant_id
    INTO v_root
  FROM public.accounts a
  WHERE a.id = p_account_id AND a.tenant_id = public.get_user_tenant_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: Account % is not visible to this tenant.', p_account_id
      USING ERRCODE = 'P0013';
  END IF;

  -- Enclosing fiscal period supplies the audit override, same lookup as
  -- rpc_trial_balance / rpc_gl_account_tree.
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_root.tenant_id
    AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  RETURN QUERY
  WITH subtree AS (
    SELECT a.id, a.account_type
    FROM public.accounts a
    WHERE a.tenant_id = v_root.tenant_id
      AND (a.id = v_root.id OR starts_with(a.account_path, v_root.account_path || '.'))
  ),
  mv AS (
    SELECT jl.account_id,
           SUM(CASE WHEN je.entry_date <  p_date_from
                    THEN COALESCE(jl.debit,0) - COALESCE(jl.credit,0) ELSE 0 END) AS led_open,
           SUM(CASE WHEN je.entry_date BETWEEN p_date_from AND p_date_to
                    THEN COALESCE(jl.debit,0)  ELSE 0 END)                        AS dr,
           SUM(CASE WHEN je.entry_date BETWEEN p_date_from AND p_date_to
                    THEN COALESCE(jl.credit,0) ELSE 0 END)                        AS cr
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    JOIN subtree s ON s.id = jl.account_id
    WHERE je.tenant_id  = v_root.tenant_id
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date <= p_date_to
    GROUP BY jl.account_id
  ),
  ob AS (
    SELECT o.account_id, COALESCE(o.debit,0) - COALESCE(o.credit,0) AS aud_open
    FROM public.opening_balances o
    JOIN subtree s ON s.id = o.account_id
    WHERE o.tenant_id = v_root.tenant_id
      AND v_period_id IS NOT NULL AND o.fiscal_period_id = v_period_id
  ),
  per_account AS (
    SELECT
      -- Temporary (P&L) accounts always start a period at zero — same rule
      -- as rpc_trial_balance / rpc_gl_account_tree / account_opening_balance.
      CASE WHEN s.account_type IN
             ('Income','Cost of Goods Sold','Expense','Other Income','Other Expense')
           THEN 0::numeric
           ELSE COALESCE(ob.aud_open, mv.led_open, 0)
      END AS opening,
      COALESCE(mv.dr, 0) AS dr,
      COALESCE(mv.cr, 0) AS cr
    FROM subtree s
    LEFT JOIN mv ON mv.account_id = s.id
    LEFT JOIN ob ON ob.account_id = s.id
  )
  SELECT
    v_root.id, v_root.account_code, v_root.account_name, v_root.account_type,
    round(SUM(pa.opening), 2),
    round(SUM(pa.dr), 2),
    round(SUM(pa.cr), 2),
    -- Raw debit-positive net across the whole subtree: summing each account's
    -- own opening+dr-cr this way is equivalent to the client's
    -- computeRollupBalance signed-debit-net accumulation (a credit-normal
    -- account like Accumulated Depreciation contributes negatively on its
    -- own, without needing a separate per-account-type sign flip here).
    round(SUM(pa.opening) + SUM(pa.dr) - SUM(pa.cr), 2),
    count(*)::INTEGER
  FROM per_account pa;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_account_subtree_balance(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.rpc_account_subtree_balance(UUID, DATE, DATE) IS
  'Rolled-up opening/debit/credit/closing for an account and its whole subtree (via account_path prefix), for the given date range. subtree_closing is a raw debit-positive net; convert to {balance: abs(x), type} the same way netAccountBalance() does. New, additive -- not wired into any existing report by this migration.';
