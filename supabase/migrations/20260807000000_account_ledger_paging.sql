-- ═══════════════════════════════════════════════════════════════════════════
-- Server-side paging for the account register (Ledger.tsx / AccountReport.tsx).
--
-- account_ledger_lines() returns an account's ENTIRE window in one call. For
-- 1110 Sampath Bank (32,916 posted lines) that is a 20 MB JSON payload, and
-- AccountReport rendered every row as a <tr>. It was also silently truncated to
-- 1000 rows by PostgREST's max_rows setting, so the register showed 1000 of
-- 32,916 transactions with a running balance and totals computed off that
-- fraction. max_rows has been raised, but "download the whole account" is not
-- a register.
--
-- account_ledger_page() returns ONE page of the register:
--   * cum_debit / cum_credit are cumulative over the whole date window in
--     ledger order, so the caller derives each row's true running balance as
--     opening + cumulative — correct on page 600 as on page 1, and unaffected
--     by the display sort or by search filtering (the accounting running
--     balance is a property of the ledger order, not of what you filtered to).
--   * search / entry-type / transaction-type filtering happen in SQL, so the
--     client never needs rows it will not render.
--   * the expensive per-row lookups (contra lines, bank-import cheque/payee)
--     run only for the rows on the page.
--
-- account_ledger_totals() carries the window's row count and debit/credit
-- totals separately, so the totals footer is still right when a search matches
-- nothing on the current page.
--
-- account_ledger_lines() is kept as-is: it still backs CSV/Excel export, where
-- pulling the whole window is the point.
-- ═══════════════════════════════════════════════════════════════════════════

-- Transaction type derived from reference prefix / description keywords.
-- Ported from detectTransactionType() in src/pages/Ledger.tsx — branch order
-- matters and must match it. The SQL is now the single authority: Ledger.tsx
-- renders and filters on the txn_type this returns, so the two cannot drift.
CREATE OR REPLACE FUNCTION public.ledger_txn_type(p_ref text, p_desc text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_ref, '')) LIKE 'INV%'
      OR lower(coalesce(p_desc, '')) LIKE '%invoice%'            THEN 'Invoice'
    WHEN upper(coalesce(p_ref, '')) LIKE 'PMT%'
      OR lower(coalesce(p_desc, '')) LIKE '%payment received%'
      OR lower(coalesce(p_desc, '')) LIKE '%receipt%'            THEN 'Payment'
    WHEN upper(coalesce(p_ref, '')) LIKE 'PV-%'
      OR lower(coalesce(p_desc, '')) LIKE '%payment voucher%'
      OR lower(coalesce(p_desc, '')) LIKE '%bill payment%'       THEN 'Bill Payment'
    WHEN upper(coalesce(p_ref, '')) LIKE 'EXP%'
      OR lower(coalesce(p_desc, '')) LIKE '%expense%'            THEN 'Expense'
    WHEN upper(coalesce(p_ref, '')) LIKE 'PAY%'
      OR lower(coalesce(p_desc, '')) LIKE '%payroll%'            THEN 'Payroll'
    WHEN upper(coalesce(p_ref, '')) LIKE 'ADJ%'
      OR lower(coalesce(p_desc, '')) LIKE '%adjustment%'         THEN 'Adjustment'
    WHEN upper(coalesce(p_ref, '')) LIKE 'REV%'
      OR lower(coalesce(p_desc, '')) LIKE '%reversal%'           THEN 'Reversal'
    WHEN lower(coalesce(p_desc, '')) LIKE '%opening balance%'    THEN 'Opening Balance'
    WHEN lower(coalesce(p_desc, '')) LIKE '%depreciation%'       THEN 'Depreciation'
    WHEN lower(coalesce(p_desc, '')) LIKE '%bank%'
      OR lower(coalesce(p_desc, '')) LIKE '%transfer%'           THEN 'Transfer'
    ELSE 'Journal Entry'
  END;
$$;

-- Window totals + row count, independent of paging and of the search filter.
CREATE OR REPLACE FUNCTION public.account_ledger_totals(
  p_account_id uuid,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS TABLE (
  line_count   bigint,
  total_debit  numeric,
  total_credit numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*), coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.status = 'posted'
    AND je.voided_at IS NULL
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to   IS NULL OR je.entry_date <= p_date_to);
$$;

-- Distinct filter values present in the window, for the filter dropdowns.
-- Returned as one jsonb row so a dropdown costs one round trip, not two.
CREATE OR REPLACE FUNCTION public.account_ledger_facets(
  p_account_id uuid,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH win AS (
    SELECT coalesce(nullif(je.entry_type, ''), 'manual') AS entry_type,
           public.ledger_txn_type(je.reference, je.description) AS txn_type
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id = p_account_id
      AND je.status = 'posted'
      AND je.voided_at IS NULL
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
  )
  SELECT jsonb_build_object(
    'entry_types', coalesce((SELECT jsonb_agg(DISTINCT entry_type ORDER BY entry_type) FROM win), '[]'::jsonb),
    'txn_types',   coalesce((SELECT jsonb_agg(DISTINCT txn_type   ORDER BY txn_type)   FROM win), '[]'::jsonb)
  );
$$;

DROP FUNCTION IF EXISTS public.account_ledger_page(uuid, date, date, text, text, text, text, text, int, int);

CREATE FUNCTION public.account_ledger_page(
  p_account_id uuid,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL,
  p_search     text DEFAULT NULL,
  p_entry_type text DEFAULT NULL,   -- journal_entries.entry_type ('manual' when null)
  p_txn_type   text DEFAULT NULL,   -- derived ledger_txn_type()
  p_sort       text DEFAULT 'date', -- date | amount | reference
  p_sort_dir   text DEFAULT 'asc',
  p_limit      int  DEFAULT 50,
  p_offset     int  DEFAULT 0
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
  cheque              text,
  payee               text,
  contra_lines        jsonb,
  txn_type            text,
  cum_debit           numeric,
  cum_credit          numeric,
  filtered_rows       bigint,
  filtered_debit      numeric,
  filtered_credit     numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_dir     text := CASE WHEN lower(coalesce(p_sort_dir, 'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  v_order   text;
  v_like    text;   -- escaped ILIKE pattern for the free-text search
  v_amount  text;   -- digits-only pattern for the amount search, NULL if none
  v_sql     text;
BEGIN
  -- Sort is interpolated, never the search text: whitelist it to a fixed set of
  -- expressions so nothing user-supplied reaches the SQL string.
  v_order := CASE lower(coalesce(p_sort, 'date'))
    WHEN 'amount'    THEN format('(f.debit + f.credit) %s, f.entry_date, f.created_at, f.entry_id, f.line_id', v_dir)
    WHEN 'reference' THEN format('coalesce(f.reference, '''') %s, f.entry_date, f.created_at, f.entry_id, f.line_id', v_dir)
    ELSE format('f.entry_date %1$s, f.created_at %1$s, f.entry_id %1$s, f.line_id %1$s', v_dir)
  END;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    -- Escape LIKE metacharacters so a literal % or _ in the search text matches
    -- itself instead of acting as a wildcard.
    v_like := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- Amount search: "3,080" / "LKR 3080" / "3080.00" all look for 3080 in a
    -- debit or credit, matching the client's old behaviour.
    v_amount := regexp_replace(lower(btrim(p_search)), '[^0-9.]', '', 'g');
    IF v_amount = '' OR v_amount !~ '[0-9]' THEN
      v_amount := NULL;
    ELSE
      v_amount := '%' || v_amount || '%';
    END IF;
  END IF;

  v_sql := format($q$
    WITH win AS (
      SELECT jl.id            AS line_id,
             je.id            AS entry_id,
             je.entry_date,
             je.created_at,
             je.description,
             je.reference,
             je.status,
             je.entry_type,
             je.source_type,
             je.is_system_generated,
             je.reversal_of,
             je.voided_at,
             je.void_reason,
             jl.debit,
             jl.credit
      FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = $1
        AND je.status = 'posted'
        AND je.voided_at IS NULL
        AND ($2::date IS NULL OR je.entry_date >= $2::date)
        AND ($3::date IS NULL OR je.entry_date <= $3::date)
    ),
    ranked AS (
      -- Cumulative sums in LEDGER order over the whole window, before any
      -- filtering: row N's running balance does not depend on what the user
      -- searched for or how the grid is sorted.
      SELECT w.*,
             public.ledger_txn_type(w.reference, w.description) AS txn_type,
             sum(w.debit)  OVER (ORDER BY w.entry_date, w.created_at, w.entry_id, w.line_id
                                 ROWS UNBOUNDED PRECEDING) AS cum_debit,
             sum(w.credit) OVER (ORDER BY w.entry_date, w.created_at, w.entry_id, w.line_id
                                 ROWS UNBOUNDED PRECEDING) AS cum_credit
      FROM win w
    ),
    filt AS (
      SELECT r.* FROM ranked r
      WHERE ($5::text IS NULL OR coalesce(nullif(r.entry_type, ''), 'manual') = $5::text)
        AND ($6::text IS NULL OR r.txn_type = $6::text)
        AND ($4::text IS NULL OR (
              r.description ILIKE $4 ESCAPE '\'
           OR r.reference   ILIKE $4 ESCAPE '\'
           OR upper(left(r.entry_id::text, 8)) LIKE upper($4) ESCAPE '\'
           OR ($7::text IS NOT NULL AND (
                   to_char(r.debit,  'FM9999999999999990.00') LIKE $7
                OR to_char(r.credit, 'FM9999999999999990.00') LIKE $7
                OR r.debit::text  LIKE $7
                OR r.credit::text LIKE $7
              ))
           OR EXISTS (
                SELECT 1
                FROM public.journal_lines jl2
                JOIN public.accounts a ON a.id = jl2.account_id
                WHERE jl2.journal_entry_id = r.entry_id
                  AND jl2.id <> r.line_id
                  AND a.account_name ILIKE $4 ESCAPE '\'
              )
           OR EXISTS (
                SELECT 1
                FROM public.bank_statement_lines bsl
                WHERE (bsl.journal_entry_id = r.entry_id OR bsl.reclass_journal_entry_id = r.entry_id)
                  AND (bsl.voucher_no ILIKE $4 ESCAPE '\' OR bsl.name ILIKE $4 ESCAPE '\')
              )
        ))
    ),
    tot AS (
      SELECT count(*) AS n, coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c FROM filt
    ),
    page AS (
      SELECT f.* FROM filt f ORDER BY %1$s LIMIT $8 OFFSET $9
    )
    SELECT f.entry_id, f.entry_date, f.created_at, f.description, f.reference, f.status,
           f.entry_type, f.source_type, f.is_system_generated, f.reversal_of, f.voided_at,
           f.void_reason, f.line_id, f.debit, f.credit,
           bimp.cheque, bimp.payee,
           coalesce(contra.lines, '[]'::jsonb),
           f.txn_type, f.cum_debit, f.cum_credit,
           tot.n, tot.d, tot.c
    FROM page f
    CROSS JOIN tot
    LEFT JOIN LATERAL (
      SELECT bsl.voucher_no AS cheque, bsl.name AS payee
      FROM public.bank_statement_lines bsl
      WHERE bsl.journal_entry_id = f.entry_id OR bsl.reclass_journal_entry_id = f.entry_id
      ORDER BY (bsl.journal_entry_id = f.entry_id) DESC
      LIMIT 1
    ) bimp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'account_id',   jl2.account_id,
               'account_code', a.account_code,
               'account_name', a.account_name,
               'debit',        jl2.debit,
               'credit',       jl2.credit
             )) AS lines
      FROM public.journal_lines jl2
      LEFT JOIN public.accounts a ON a.id = jl2.account_id
      WHERE jl2.journal_entry_id = f.entry_id AND jl2.id <> f.line_id
    ) contra ON true
    ORDER BY %1$s
  $q$, v_order);

  RETURN QUERY EXECUTE v_sql
    USING p_account_id, p_date_from, p_date_to, v_like, p_entry_type, p_txn_type,
          v_amount, greatest(coalesce(p_limit, 50), 1), greatest(coalesce(p_offset, 0), 0);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ledger_txn_type(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_ledger_totals(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_ledger_facets(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_ledger_page(uuid, date, date, text, text, text, text, text, int, int) TO authenticated;
