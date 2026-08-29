-- ── Trial Balance: where the out-of-balance comes from ───────────────────
--
-- The Trial Balance can close out of balance for four — and only four —
-- reasons, and they decompose the difference exactly. Writing
--   led(a)  = net of posted lines on account a dated before p_date_from
--   dr(a), cr(a) = posted debits/credits on a inside the range
--   P       = the account population the report actually renders
--             (tenant accounts, minus inactive ones when they are filtered out)
--   open(a) = 0 for P&L accounts, else COALESCE(recorded opening, led(a))
--
--   closing_difference = SUM over P of (open + dr - cr)
--                      = L + T1 + T2 + T3
--
--   L  = SUM over every posted line dated <= p_date_to of (debit - credit)
--        — journal entries whose own debits and credits do not agree. Zero for
--        a ledger that has always been posted double-entry.
--   T1 = -SUM over P&L accounts in P of led(a)
--        — profit earned before the start date. The report opens every P&L
--        account at zero (a period starts fresh), so unless that profit has
--        been closed into equity it has no counterpart on the opening side.
--        This is the usual culprit, and the fix is a year-end closing entry.
--   T2 = SUM over balance-sheet accounts in P carrying a recorded opening of
--        (recorded opening - led(a)) — audit overrides that do not themselves
--        net to zero.
--   T3 = -SUM over accounts outside P of (led + dr - cr)
--        — balances parked on accounts the report is not showing: inactive
--        accounts when that filter is off, and lines pointing at an account
--        row that no longer exists.
--
-- Each component ships with the accounts or entries behind it, so the banner
-- can be opened and followed all the way to the ledger. `residual` is the
-- arithmetic check: it must be zero, and is surfaced rather than hidden if it
-- ever is not.
CREATE OR REPLACE FUNCTION public.rpc_trial_balance_diagnostics(
  p_date_from        date,
  p_date_to          date,
  p_include_inactive boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_tenant    uuid := public.get_user_tenant_id();
  v_period_id uuid;
  v_pl_types  text[] := ARRAY['Income','Cost of Goods Sold','Expense','Other Income','Other Expense'];
  v_result    jsonb;
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit' USING ERRCODE = '22003';
  END IF;

  -- Same enclosing-period lookup rpc_trial_balance uses, so the recorded
  -- openings this explains are the ones the report actually applied.
  SELECT fp.id INTO v_period_id
  FROM public.fiscal_periods fp
  WHERE fp.tenant_id = v_tenant
    AND p_date_from BETWEEN fp.period_start AND fp.period_end
  ORDER BY fp.period_start DESC LIMIT 1;

  WITH acct AS (
    SELECT a.id, a.account_code, a.account_name, a.account_type, a.is_active
    FROM public.accounts a
    WHERE a.tenant_id = v_tenant
      AND (p_include_inactive OR a.is_active)
  ),
  known AS (
    SELECT a.id, a.account_code, a.account_name, a.account_type, a.is_active
    FROM public.accounts a
    WHERE a.tenant_id = v_tenant
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
    WHERE je.tenant_id  = v_tenant
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date <= p_date_to
    GROUP BY jl.account_id
  ),
  ob AS (
    SELECT o.account_id, COALESCE(o.debit,0) - COALESCE(o.credit,0) AS aud_open
    FROM public.opening_balances o
    WHERE o.tenant_id = v_tenant
      AND v_period_id IS NOT NULL AND o.fiscal_period_id = v_period_id
  ),
  -- The report's own population, with the openings it actually renders.
  --
  -- `open_bal` is rounded HERE, per account, because that is where
  -- rpc_trial_balance rounds: it emits round(audit_opening + dr - cr, 2) a row
  -- at a time, and the screen adds up those rounded rows. journal_lines.debit
  -- and .credit are numeric(14,2) so ledger figures cannot carry sub-cent
  -- digits, but opening_balances.debit/.credit are unconstrained numeric and
  -- can — and three recorded openings of 0.004 round to 0.00 apiece on the
  -- report while summing to 0.01 unrounded. Rounding per row keeps this
  -- function measuring the difference the reader is actually looking at.
  -- Every later total inherits the rounding for free: dr and cr are exact to
  -- the cent, so round(open + dr - cr, 2) = round(open, 2) + dr - cr.
  shown AS (
    SELECT a.id, a.account_code, a.account_name, a.account_type,
           COALESCE(mv.led_open, 0) AS led_open,
           round(CASE WHEN a.account_type = ANY(v_pl_types) THEN 0::numeric
                      ELSE COALESCE(ob.aud_open, mv.led_open, 0) END, 2) AS open_bal,
           COALESCE(mv.dr, 0) AS dr,
           COALESCE(mv.cr, 0) AS cr,
           (ob.account_id IS NOT NULL AND NOT (a.account_type = ANY(v_pl_types))) AS has_audit_row
    FROM acct a
    LEFT JOIN mv ON mv.account_id = a.id
    LEFT JOIN ob ON ob.account_id = a.id
  ),
  -- Movement stranded outside that population: inactive accounts the reader
  -- filtered out, and lines whose account row is gone.
  hidden AS (
    SELECT mv.account_id,
           k.account_code, k.account_name, k.account_type, k.is_active,
           mv.led_open, mv.dr, mv.cr
    FROM mv
    LEFT JOIN known k ON k.id = mv.account_id
    WHERE NOT EXISTS (SELECT 1 FROM acct a WHERE a.id = mv.account_id)
  ),
  ent AS (
    SELECT je.id, je.entry_date, je.reference, je.description,
           SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)) AS diff
    FROM public.journal_entries je
    JOIN public.journal_lines  jl ON jl.journal_entry_id = je.id
    WHERE je.tenant_id  = v_tenant
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date <= p_date_to
    GROUP BY je.id, je.entry_date, je.reference, je.description
    HAVING ABS(SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0))) > 0.005
  ),
  -- Unrounded. Rounding each total before differencing them could manufacture
  -- a residual out of nothing; the residual is the panel's proof of
  -- completeness, so it is derived from the raw sums and rounded once.
  raw AS (
    SELECT
      COALESCE((SELECT SUM(s.open_bal) FROM shown s), 0)               AS opening_difference,
      COALESCE((SELECT SUM(s.dr - s.cr) FROM shown s), 0)              AS period_difference,
      COALESCE((SELECT SUM(s.open_bal + s.dr - s.cr) FROM shown s), 0) AS closing_difference,
      COALESCE((SELECT SUM(e.diff) FROM ent e), 0)                     AS entry_imbalance,
      COALESCE((SELECT -SUM(s.led_open) FROM shown s
                 WHERE s.account_type = ANY(v_pl_types)), 0)           AS pl_opening,
      COALESCE((SELECT SUM(s.open_bal - s.led_open) FROM shown s
                 WHERE s.has_audit_row), 0)                            AS audit_override,
      COALESCE((SELECT -SUM(h.led_open + h.dr - h.cr) FROM hidden h), 0) AS excluded
  ),
  -- What the panel prints. The components are rounded for display and the
  -- residual is measured against those same rounded figures, so the column a
  -- reader adds up by hand reconciles to the stated difference exactly.
  totals AS (
    SELECT
      round(r.opening_difference, 2) AS opening_difference,
      round(r.period_difference,  2) AS period_difference,
      round(r.closing_difference, 2) AS closing_difference,
      round(r.entry_imbalance,    2) AS entry_imbalance,
      round(r.pl_opening,         2) AS pl_opening,
      round(r.audit_override,     2) AS audit_override,
      round(r.excluded,           2) AS excluded,
      round(r.closing_difference, 2)
        - round(r.entry_imbalance, 2) - round(r.pl_opening, 2)
        - round(r.audit_override, 2)  - round(r.excluded, 2) AS residual
    FROM raw r
  )
  SELECT jsonb_build_object(
    'date_from',          p_date_from,
    'date_to',            p_date_to,
    'include_inactive',   p_include_inactive,
    'opening_difference', t.opening_difference,
    'period_difference',  t.period_difference,
    'closing_difference', t.closing_difference,
    'residual',           t.residual,
    'components', jsonb_build_array(
      jsonb_build_object(
        'code',   'pl_opening_not_closed',
        'label',  'Prior-period profit or loss never closed to equity',
        'detail', 'Income and expense accounts start every period at zero. Net movement posted to them before '
                  || to_char(p_date_from, 'DD/MM/YYYY')
                  || ' therefore leaves the opening side, and only a closing entry into Retained Earnings puts it back.',
        'amount', t.pl_opening,
        'count',  COALESCE((SELECT count(*) FROM shown s
                            WHERE s.account_type = ANY(v_pl_types) AND ABS(s.led_open) > 0.005), 0),
        'items',  COALESCE((
          SELECT jsonb_agg(x) FROM (
            SELECT jsonb_build_object(
                     'kind', 'account', 'id', s.id, 'code', s.account_code,
                     'label', s.account_name, 'note', s.account_type,
                     'amount', round(-s.led_open, 2)) AS x
            FROM shown s
            WHERE s.account_type = ANY(v_pl_types) AND ABS(s.led_open) > 0.005
            ORDER BY ABS(s.led_open) DESC LIMIT 15
          ) q), '[]'::jsonb)
      ),
      jsonb_build_object(
        'code',   'unbalanced_entries',
        'label',  'Journal entries whose own debits and credits disagree',
        'detail', 'Every posted entry dated on or before ' || to_char(p_date_to, 'DD/MM/YYYY')
                  || ' should net to zero. These do not, so they move the report''s totals apart by their own difference.',
        'amount', t.entry_imbalance,
        'count',  COALESCE((SELECT count(*) FROM ent), 0),
        'items',  COALESCE((
          SELECT jsonb_agg(x) FROM (
            SELECT jsonb_build_object(
                     'kind', 'entry', 'id', e.id,
                     'code', COALESCE(NULLIF(e.reference, ''), left(e.id::text, 8)),
                     'label', COALESCE(NULLIF(e.description, ''), 'Journal entry'),
                     'note', to_char(e.entry_date, 'DD/MM/YYYY'),
                     'amount', round(e.diff, 2)) AS x
            FROM ent e ORDER BY ABS(e.diff) DESC LIMIT 15
          ) q), '[]'::jsonb)
      ),
      jsonb_build_object(
        'code',   'audit_opening_override',
        'label',  'Recorded opening balances that differ from the ledger',
        'detail', 'Opening balances entered for this period override what the ledger carries forward. Where the overrides do not themselves balance, the difference lands here.',
        'amount', t.audit_override,
        'count',  COALESCE((SELECT count(*) FROM shown s
                            WHERE s.has_audit_row AND ABS(s.open_bal - s.led_open) > 0.005), 0),
        'items',  COALESCE((
          SELECT jsonb_agg(x) FROM (
            SELECT jsonb_build_object(
                     'kind', 'account', 'id', s.id, 'code', s.account_code,
                     'label', s.account_name, 'note', s.account_type,
                     'amount', round(s.open_bal - s.led_open, 2)) AS x
            FROM shown s
            WHERE s.has_audit_row AND ABS(s.open_bal - s.led_open) > 0.005
            ORDER BY ABS(s.open_bal - s.led_open) DESC LIMIT 15
          ) q), '[]'::jsonb)
      ),
      jsonb_build_object(
        'code',   'excluded_accounts',
        'label',  'Balances on accounts this report is not showing',
        'detail', 'Posted movement sits on accounts outside the report — inactive accounts while that filter is off, or lines pointing at an account row that no longer exists.',
        'amount', t.excluded,
        'count',  COALESCE((SELECT count(*) FROM hidden h
                            WHERE ABS(h.led_open + h.dr - h.cr) > 0.005), 0),
        'items',  COALESCE((
          SELECT jsonb_agg(x) FROM (
            SELECT jsonb_build_object(
                     'kind', 'account', 'id', h.account_id,
                     'code', COALESCE(h.account_code, '—'),
                     'label', COALESCE(h.account_name, 'Deleted or unknown account'),
                     'note', CASE WHEN h.account_code IS NULL THEN 'Missing account row'
                                  WHEN h.is_active IS FALSE  THEN 'Inactive'
                                  ELSE COALESCE(h.account_type, '') END,
                     'amount', round(-(h.led_open + h.dr - h.cr), 2)) AS x
            FROM hidden h
            WHERE ABS(h.led_open + h.dr - h.cr) > 0.005
            ORDER BY ABS(h.led_open + h.dr - h.cr) DESC LIMIT 15
          ) q), '[]'::jsonb)
      )
    )
  ) INTO v_result
  FROM totals t;

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_trial_balance_diagnostics(date, date, boolean) TO authenticated;
