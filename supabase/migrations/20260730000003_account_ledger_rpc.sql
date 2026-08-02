-- Account-scoped ledger reads for Ledger.tsx and AccountReport.tsx.
--
-- Both pages render exactly one account's register but were getting there via
-- useJournalEntries(), which loads the ENTIRE journal_entries table (every
-- account, every entry, ~35 sequential 1000-row pages at current volume) and
-- then filters down to one account in JS. idx_jl_account_entry
-- (20260729000001) was added specifically to serve this account-scoped read
-- and has gone unused until now.

-- One row per journal line touching the account, for posted/non-voided
-- entries, optionally date-bounded. Sibling lines on the same entry come back
-- as a jsonb array so callers can resolve the contra account(s) without a
-- second round trip or a join against the full accounts/entries arrays.
--
-- DROP first: an earlier deployed version of this function has a different
-- return-row shape, and CREATE OR REPLACE cannot change OUT-parameter columns.
DROP FUNCTION IF EXISTS public.account_ledger_lines(uuid, date, date);

CREATE OR REPLACE FUNCTION public.account_ledger_lines(
  p_account_id uuid,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS TABLE (
  entry_id            uuid,
  entry_date          date,
  created_at          timestamptz,
  description         text,
  reference           text,
  status              text,
  entry_type          text,
  source_type         text,
  is_system_generated boolean,
  reversal_of         uuid,
  voided_at           timestamptz,
  void_reason         text,
  line_id             uuid,
  debit               numeric,
  credit              numeric,
  contra_lines        jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT je.id, je.entry_date, je.created_at, je.description, je.reference,
         je.status, je.entry_type, je.source_type, je.is_system_generated,
         je.reversal_of, je.voided_at, je.void_reason,
         jl.id, jl.debit, jl.credit,
         COALESCE(contra.lines, '[]'::jsonb)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
             'account_id', jl2.account_id,
             'account_code', a.account_code,
             'account_name', a.account_name,
             'debit', jl2.debit,
             'credit', jl2.credit
           )) AS lines
    FROM public.journal_lines jl2
    LEFT JOIN public.accounts a ON a.id = jl2.account_id
    WHERE jl2.journal_entry_id = je.id AND jl2.id <> jl.id
  ) contra ON true
  WHERE jl.account_id = p_account_id
    AND je.status = 'posted'
    AND je.voided_at IS NULL
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
  ORDER BY je.entry_date, je.created_at, je.id;
$$;

-- Sum of movements strictly before p_date_from, for the opening-balance row.
CREATE OR REPLACE FUNCTION public.account_opening_balance(
  p_account_id uuid,
  p_date_from  date
)
RETURNS TABLE (
  debit  numeric,
  credit numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(jl.debit), 0), COALESCE(SUM(jl.credit), 0)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.status = 'posted'
    AND je.voided_at IS NULL
    AND je.entry_date < p_date_from;
$$;

-- Earliest posted entry touching the account, for AccountReport's
-- auto-widen-to-full-history behaviour.
CREATE OR REPLACE FUNCTION public.account_earliest_entry_date(
  p_account_id uuid
)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT MIN(je.entry_date)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.status = 'posted'
    AND je.voided_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.account_ledger_lines(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_opening_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_earliest_entry_date(uuid) TO authenticated;
