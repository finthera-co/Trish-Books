-- Performance fix for rpc_gl_transactions: entry_accts and bank_dir previously
-- aggregated over every entry in the WHOLE date range (via `scope`), regardless
-- of how narrow p_account_ids was. That means a 40-account batch call's cost
-- scaled with the tenant's total entry count in range, not the batch size —
-- confirmed by a seeded 305-account/60k-line probe where a 40-account batch
-- call exceeded the function's own 60s statement_timeout (budget: <=500ms).
--
-- Fix: scope both CTEs to only the entries that actually have a line among the
-- requested accounts (relevant_ids), while still reading every line of THOSE
-- entries (not just the batch-account lines) — preserving the original
-- correctness requirement (split/-MULTIPLE- must see every account/memo on the
-- entry, not just the batch's) while bounding cost to the batch's own entries
-- rather than the whole tenant history. When p_account_ids IS NULL, lines is
-- already unfiltered, so relevant_ids covers the same entries as before —
-- no behavior change for that path.
CREATE OR REPLACE FUNCTION public.rpc_gl_transactions(
  p_date_from   date,
  p_date_to     date,
  p_account_ids uuid[] DEFAULT NULL,
  p_limit       integer DEFAULT 5000,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  account_id      uuid,
  entry_id        uuid,
  line_id         uuid,
  line_seq        bigint,
  entry_date      date,
  txn_type        text,
  num             text,
  is_adjusting    boolean,
  entity_name     text,
  memo            text,
  split_text      text,
  debit           numeric,
  credit          numeric,
  running_balance numeric,
  total_rows      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit (% days requested)', p_date_to - p_date_from
      USING ERRCODE = '22003';
  END IF;
  IF p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 50000' USING ERRCODE = '22003';
  END IF;

  RETURN QUERY
  WITH scope AS (
    SELECT je.id, je.entry_date, je.reference, je.description, je.source_type,
           je.source_id, je.entry_type, je.is_adjusting, je.created_at
    FROM public.journal_entries je
    WHERE je.tenant_id  = public.get_user_tenant_id()
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
  ),
  lines AS (
    SELECT jl.id, jl.seq, jl.journal_entry_id, jl.account_id, jl.memo,
           COALESCE(jl.debit,0) AS debit, COALESCE(jl.credit,0) AS credit,
           jl.customer_id, jl.vendor_id
    FROM public.journal_lines jl
    JOIN scope s ON s.id = jl.journal_entry_id
    WHERE p_account_ids IS NULL OR jl.account_id = ANY (p_account_ids)
  ),
  -- Only the entries the batch actually touches. Bounds entry_accts/bank_dir's
  -- cost to the batch rather than every entry in the whole date range.
  relevant_ids AS (
    SELECT DISTINCT journal_entry_id FROM lines
  ),
  -- Split source: every distinct account on the entry, including lines belonging to
  -- accounts NOT in p_account_ids. Reading only the batch would silently mislabel
  -- -SPLIT- rows as two-sided.
  entry_accts AS (
    SELECT jl.journal_entry_id,
           array_agg(DISTINCT jl.account_id) AS accts,
           count(DISTINCT jl.memo) FILTER (WHERE jl.memo IS NOT NULL AND jl.memo <> '') AS memo_variants
    FROM public.journal_lines jl
    JOIN relevant_ids r ON r.journal_entry_id = jl.journal_entry_id
    GROUP BY jl.journal_entry_id
  ),
  -- Bank-import direction: the posting RPC debits the bank leg when money comes in
  -- (statement credit) and credits it when money goes out (statement debit). Both
  -- lines of the entry render the same Type, matching QuickBooks Deposit/Check display.
  bank_dir AS (
    SELECT s.id AS entry_id,
           CASE WHEN bl.debit > 0 THEN 'Deposit' WHEN bl.credit > 0 THEN 'Check' END AS txn_label
    FROM scope s
    JOIN relevant_ids r ON r.journal_entry_id = s.id
    JOIN public.bank_statement_lines bsl ON bsl.id = s.source_id
    JOIN public.bank_statement_batches bb ON bb.id = bsl.batch_id
    JOIN public.journal_lines bl ON bl.journal_entry_id = s.id AND bl.account_id = bb.bank_account_id
    WHERE s.source_type = 'bank_import'
  ),
  opening AS (
    SELECT jl.account_id,
           SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)) AS bal
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id  = public.get_user_tenant_id()
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date < p_date_from
      AND (p_account_ids IS NULL OR jl.account_id = ANY (p_account_ids))
    GROUP BY jl.account_id
  ),
  enriched AS (
    SELECT
      l.account_id, s.id AS entry_id, l.id AS line_id, l.seq AS line_seq, s.entry_date,
      CASE
        WHEN s.source_type = 'invoice'          THEN 'Invoice'
        WHEN s.source_type = 'invoice_reversal' THEN 'Invoice Reversal'
        WHEN s.source_type = 'invoice_payment'  THEN 'Payment'
        WHEN s.source_type = 'supplier_bill'    THEN 'Bill'
        WHEN s.source_type = 'bill_payment'     THEN 'Bill Pmt -Check'
        WHEN s.source_type = 'payment_voucher'  THEN 'Check'
        WHEN s.source_type = 'petty_cash'       THEN 'Petty Cash'
        WHEN s.source_type = 'grn'              THEN 'Item Receipt'
        WHEN s.source_type = 'depreciation'     THEN 'Depreciation'
        WHEN s.source_type = 'payroll'          THEN 'Paycheck'
        WHEN s.source_type = 'period_close'     THEN 'Closing Entry'
        WHEN s.source_type = 'bank_import'      THEN COALESCE(bd.txn_label, 'Bank Transaction')
        WHEN s.entry_type  = 'reversal'         THEN 'Reversal'
        ELSE 'General Journal'
      END AS txn_type,
      COALESCE(s.reference, '')                                   AS num,
      s.is_adjusting,
      COALESCE(c.name, v.name, '')                                AS entity_name,
      CASE
        WHEN l.memo IS NOT NULL AND l.memo <> '' THEN l.memo
        WHEN ea.memo_variants >= 2               THEN '-MULTIPLE-'
        ELSE COALESCE(s.description, '')
      END                                                          AS memo,
      CASE
        WHEN cardinality(array_remove(ea.accts, l.account_id)) = 0 THEN ''
        WHEN cardinality(array_remove(ea.accts, l.account_id)) = 1 THEN COALESCE(sa.account_name, '')
        ELSE '-SPLIT-'
      END                                                          AS split_text,
      l.debit, l.credit,
      COALESCE(op.bal, 0) + SUM(l.debit - l.credit) OVER (
        PARTITION BY l.account_id
        ORDER BY s.entry_date, s.created_at, s.id, l.seq
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                            AS running_balance,
      s.created_at
    FROM lines l
    JOIN scope       s  ON s.id  = l.journal_entry_id
    JOIN entry_accts ea ON ea.journal_entry_id = l.journal_entry_id
    LEFT JOIN bank_dir  bd ON bd.entry_id = s.id
    LEFT JOIN opening   op ON op.account_id = l.account_id
    LEFT JOIN public.accounts sa
           ON cardinality(array_remove(ea.accts, l.account_id)) = 1
          AND sa.id = (array_remove(ea.accts, l.account_id))[1]
    LEFT JOIN public.customers c ON c.id = l.customer_id
    LEFT JOIN public.vendors   v ON v.id = l.vendor_id
  )
  SELECT e.account_id, e.entry_id, e.line_id, e.line_seq, e.entry_date, e.txn_type,
         e.num, e.is_adjusting, e.entity_name, e.memo, e.split_text,
         e.debit, e.credit, e.running_balance,
         count(*) OVER () AS total_rows
  FROM enriched e
  ORDER BY e.account_id, e.entry_date, e.created_at, e.entry_id, e.line_seq
  LIMIT p_limit OFFSET p_offset;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_gl_transactions(date, date, uuid[], integer, integer) TO authenticated;
