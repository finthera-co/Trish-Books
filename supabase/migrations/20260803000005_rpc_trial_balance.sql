-- Trial Balance RPC. Replaces both client-side implementations (TrialBalance.tsx and
-- Reports.tsx's renderTrialBalance), which independently aggregate journal_lines and
-- can disagree with each other on the same tenant. One function, one answer.
--
-- Closing = Audit Opening + Debit - Credit (NOT Ledger Opening — verified against the
-- reference workbook: Cash In Hand 44,207,582.42 ledger-opening / 44,207,582.42... the
-- actual audit opening differs from ledger opening on override rows, and Closing always
-- ties off Audit Opening). Raw Dr-Cr throughout; never signed by normal balance.
CREATE OR REPLACE FUNCTION public.rpc_trial_balance(
  p_date_from        date,
  p_date_to          date,
  p_group_by         text    DEFAULT 'parent',
  p_include_zero     boolean DEFAULT false,
  p_include_inactive boolean DEFAULT true
)
RETURNS TABLE (
  group_key        text,
  group_label      text,
  group_sort       text,
  account_id       uuid,
  account_code     text,
  account_name     text,
  account_type     text,
  ledger_opening   numeric,
  audit_opening    numeric,
  opening_variance numeric,
  period_debit     numeric,
  period_credit    numeric,
  closing          numeric,
  has_audit_row    boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE v_period_id uuid;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit' USING ERRCODE = '22003';
  END IF;
  IF p_group_by NOT IN ('parent', 'category', 'type') THEN
    RAISE EXCEPTION 'p_group_by must be parent, category, or type' USING ERRCODE = '22023';
  END IF;

  -- Enclosing fiscal period supplies the Audit Opening. NULL is fine: every account
  -- then falls back to its Ledger Opening and the two columns agree by construction.
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = public.get_user_tenant_id()
    AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  RETURN QUERY
  WITH acct AS (
    SELECT a.id, a.account_code, a.account_name, a.account_type,
           a.parent_account_id, a.category_id
    FROM public.accounts a
    WHERE a.tenant_id = public.get_user_tenant_id()
      AND (p_include_inactive OR a.is_active)
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
    WHERE je.tenant_id  = public.get_user_tenant_id()
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date <= p_date_to
    GROUP BY jl.account_id
  ),
  ob AS (
    SELECT o.account_id, COALESCE(o.debit,0) - COALESCE(o.credit,0) AS aud_open
    FROM public.opening_balances o
    WHERE o.tenant_id = public.get_user_tenant_id()
      AND v_period_id IS NOT NULL AND o.fiscal_period_id = v_period_id
  ),
  base AS (
    SELECT a.id, a.account_code, a.account_name, a.account_type,
           a.parent_account_id, a.category_id,
           COALESCE(mv.led_open, 0)              AS ledger_opening,
           COALESCE(ob.aud_open, mv.led_open, 0)  AS audit_opening,
           COALESCE(mv.dr, 0)                    AS dr,
           COALESCE(mv.cr, 0)                    AS cr,
           ob.account_id IS NOT NULL              AS has_audit_row
    FROM acct a
    LEFT JOIN mv ON mv.account_id = a.id
    LEFT JOIN ob ON ob.account_id = a.id
  )
  SELECT
    CASE p_group_by
      WHEN 'parent'   THEN COALESCE(p.id::text, 'type:' || b.account_type)
      WHEN 'category' THEN COALESCE(b.category_id::text, 'type:' || b.account_type)
      ELSE 'type:' || b.account_type
    END,
    CASE p_group_by
      WHEN 'parent'   THEN COALESCE(p.account_name, b.account_type)
      WHEN 'category' THEN COALESCE(ac.name, b.account_type)
      ELSE b.account_type
    END,
    lpad(COALESCE(tr.r, 99)::text, 2, '0') || '/' ||
      lpad(COALESCE(NULLIF(regexp_replace(COALESCE(p.account_code, b.account_code), '\D', '', 'g'), ''), '0'), 12, '0'),
    b.id, b.account_code, b.account_name, b.account_type,
    round(b.ledger_opening, 2),
    round(b.audit_opening, 2),
    round(b.audit_opening - b.ledger_opening, 2),
    round(b.dr, 2),
    round(b.cr, 2),
    round(b.audit_opening + b.dr - b.cr, 2),
    b.has_audit_row
  FROM base b
  LEFT JOIN acct p ON p.id = b.parent_account_id
  LEFT JOIN public.account_categories ac ON ac.id = b.category_id
  LEFT JOIN (VALUES ('Asset',1),('Liability',2),('Equity',3),('Income',4),
                    ('Cost of Goods Sold',5),('Expense',6),
                    ('Other Income',7),('Other Expense',8)) AS tr(t, r)
         ON tr.t = b.account_type
  WHERE p_include_zero
     OR abs(b.ledger_opening) > 0.005 OR abs(b.audit_opening) > 0.005
     OR b.dr > 0.005 OR b.cr > 0.005
  ORDER BY 3, b.account_code;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_trial_balance(date, date, text, boolean, boolean) TO authenticated;
