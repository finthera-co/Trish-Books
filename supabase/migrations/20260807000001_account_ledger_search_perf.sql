-- ═══════════════════════════════════════════════════════════════════════════
-- account_ledger_page(): make the free-text search cheap.
--
-- The first cut matched the contra-account name and the bank-import
-- cheque/payee with correlated EXISTS subqueries in the OR chain, so both ran
-- per candidate row — 32,916 of them for 1110 Sampath Bank. Measured as
-- `authenticated` (RLS on): a searched page took 4.06s against an 8s
-- statement_timeout. An unsearched page was 1.4s.
--
-- Both lookups are inverted here: resolve the matching accounts and
-- bank_statement_lines ONCE into a set of entry ids, then semi-join. The
-- account-name side starts from `accounts` (a few hundred rows) and reaches
-- journal_lines through idx_jl_account_entry instead of walking every sibling
-- line. Same results, one pass instead of 32,916.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.account_ledger_page(
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
    -- Entries whose CONTRA account name matches the search. Starts from
    -- `accounts` (small) and reaches the lines through idx_jl_account_entry.
    -- The viewed account is excluded so searching the account's own name does
    -- not match every row — the client only ever displayed the contra name.
    contra_hits AS (
      SELECT DISTINCT jl2.journal_entry_id AS entry_id
      FROM public.journal_lines jl2
      WHERE $4::text IS NOT NULL
        AND jl2.account_id <> $1
        AND jl2.account_id IN (
              SELECT a.id FROM public.accounts a WHERE a.account_name ILIKE $4 ESCAPE '\'
            )
    ),
    -- Entries whose bank-import cheque number or payee matches.
    bank_hits AS (
      SELECT bsl.journal_entry_id AS entry_id
      FROM public.bank_statement_lines bsl
      WHERE $4::text IS NOT NULL
        AND bsl.journal_entry_id IS NOT NULL
        AND (bsl.voucher_no ILIKE $4 ESCAPE '\' OR bsl.name ILIKE $4 ESCAPE '\')
      UNION
      SELECT bsl.reclass_journal_entry_id
      FROM public.bank_statement_lines bsl
      WHERE $4::text IS NOT NULL
        AND bsl.reclass_journal_entry_id IS NOT NULL
        AND (bsl.voucher_no ILIKE $4 ESCAPE '\' OR bsl.name ILIKE $4 ESCAPE '\')
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
           OR r.entry_id IN (SELECT entry_id FROM contra_hits)
           OR r.entry_id IN (SELECT entry_id FROM bank_hits)
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

GRANT EXECUTE ON FUNCTION public.account_ledger_page(uuid, date, date, text, text, text, text, text, int, int) TO authenticated;
