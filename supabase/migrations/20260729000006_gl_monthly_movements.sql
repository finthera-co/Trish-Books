-- Monthly GL movements, aggregated server-side.
--
-- The dashboard and the reports pages don't need journal entries — they need sums
-- per month per account. They were getting there by pulling all ~35k entries with
-- their ~70k lines into the browser and reducing in JS, which is the single reason
-- the landing page hangs after a bank import.
--
-- Aggregated, the same information is 557 rows.
--
-- Voided entries are excluded here, matching the `status = 'posted' AND voided_at
-- IS NULL` filter the callers applied client-side.

CREATE OR REPLACE FUNCTION public.gl_monthly_account_movements(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  month        date,
  account_id   uuid,
  account_type text,
  account_code text,
  account_name text,
  debit        numeric,
  credit       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT date_trunc('month', je.entry_date)::date AS month,
         a.id,
         a.account_type,
         a.account_code,
         a.account_name,
         COALESCE(SUM(jl.debit), 0),
         COALESCE(SUM(jl.credit), 0)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  JOIN public.accounts a         ON a.id = jl.account_id
  WHERE je.status = 'posted'
    AND je.voided_at IS NULL
    AND (p_from IS NULL OR je.entry_date >= p_from)
    AND (p_to   IS NULL OR je.entry_date <= p_to)
  GROUP BY 1, 2, 3, 4, 5;
$$;

-- Closing/period balances per account, for trial balance and balance-sheet style
-- reads. p_from NULL means "from the beginning", i.e. cumulative to p_to.
CREATE OR REPLACE FUNCTION public.gl_account_balances(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  account_id   uuid,
  account_type text,
  account_code text,
  account_name text,
  debit        numeric,
  credit       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id,
         a.account_type,
         a.account_code,
         a.account_name,
         COALESCE(SUM(jl.debit), 0),
         COALESCE(SUM(jl.credit), 0)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  JOIN public.accounts a         ON a.id = jl.account_id
  WHERE je.status = 'posted'
    AND je.voided_at IS NULL
    AND (p_from IS NULL OR je.entry_date >= p_from)
    AND (p_to   IS NULL OR je.entry_date <= p_to)
  GROUP BY 1, 2, 3, 4;
$$;

-- Supports both aggregates: they join lines to entries and filter on entry status
-- and date, so lead with the join key and carry the date.
CREATE INDEX IF NOT EXISTS idx_je_posted_date
  ON public.journal_entries (id, entry_date)
  WHERE status = 'posted' AND voided_at IS NULL;

GRANT EXECUTE ON FUNCTION public.gl_monthly_account_movements(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gl_account_balances(date,date) TO authenticated;

ANALYZE public.journal_lines;
