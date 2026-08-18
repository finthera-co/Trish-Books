-- Without MATERIALIZED, Postgres was pulling the `tot` totals aggregate
-- inside a nested loop against `page` and re-scanning/re-aggregating all of
-- `filt` once per OUTPUT row (i.e. up to p_limit times per chunk), turning an
-- O(n) pass into O(n * p_limit). On a large account (e.g. 18k lines) this
-- burned 6+ GB of temp disk per export chunk and blew past the statement
-- timeout. Forcing materialization of filt/tot computes each exactly once.
-- Also folds cum_debit/cum_credit directly into `win`'s column list instead
-- of a separate CTE re-joined by line_id afterward, removing that indirection.
-- Verified byte-for-byte identical output against the previous version across
-- every offset, search term, and sort order for an 18k-row account before
-- replacing it in production.
CREATE OR REPLACE FUNCTION public.account_ledger_page(
  p_account_id uuid,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL,
  p_search     text DEFAULT NULL,
  p_entry_type text DEFAULT NULL,
  p_txn_type   text DEFAULT NULL,
  p_sort       text DEFAULT 'date',
  p_sort_dir   text DEFAULT 'asc',
  p_limit      int  DEFAULT 50,
  p_offset     int  DEFAULT 0
)
RETURNS TABLE (
  entry_id            uuid,
  entry_date          date,
  created_at          timestamptz,
  description         text,
  line_memo           text,
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
SET statement_timeout = '25s'
AS $fn$
DECLARE
  v_dir     text := CASE WHEN lower(coalesce(p_sort_dir, 'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  v_order   text;
  v_like    text;
  v_amount  text;
  v_sql     text;
  v_keep_ob boolean := public.account_is_obe(p_account_id);
BEGIN
  v_order := CASE lower(coalesce(p_sort, 'date'))
    WHEN 'amount'    THEN format('(f.debit + f.credit) %s, f.entry_date, f.created_at, f.entry_id, f.line_id', v_dir)
    WHEN 'reference' THEN format('coalesce(f.reference, '''') %s, f.entry_date, f.created_at, f.entry_id, f.line_id', v_dir)
    ELSE format('f.entry_date %1$s, f.created_at %1$s, f.entry_id %1$s, f.line_id %1$s', v_dir)
  END;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_like := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
             jl.memo AS line_memo,
             je.reference,
             je.status,
             je.entry_type,
             je.source_type,
             je.is_system_generated,
             je.reversal_of,
             je.voided_at,
             je.void_reason,
             nullif(btrim(je.cheque_number), '') AS cheque_number,
             jl.debit,
             jl.credit,
             sum(jl.debit)  OVER win_order AS cum_debit,
             sum(jl.credit) OVER win_order AS cum_credit
      FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = $1
        AND je.status = 'posted'
        AND je.voided_at IS NULL
        AND ($10::boolean OR je.entry_type IS DISTINCT FROM 'opening_balance')
        AND ($2::date IS NULL OR je.entry_date >= $2::date)
        AND ($3::date IS NULL OR je.entry_date <= $3::date)
      WINDOW win_order AS (ORDER BY je.entry_date, je.created_at, je.id, jl.id
                            ROWS UNBOUNDED PRECEDING)
    ),
    contra_hits AS (
      SELECT DISTINCT jl2.journal_entry_id AS entry_id
      FROM public.journal_lines jl2
      WHERE $4::text IS NOT NULL
        AND jl2.account_id <> $1
        AND jl2.account_id IN (
              SELECT a.id FROM public.accounts a WHERE a.account_name ILIKE $4 ESCAPE '\'
            )
    ),
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
    filt AS MATERIALIZED (
      SELECT w.* FROM win w
      WHERE ($5::text IS NULL OR coalesce(nullif(w.entry_type, ''), 'manual') = $5::text)
        AND ($6::text IS NULL OR public.ledger_txn_type(w.reference, w.description) = $6::text)
        AND ($4::text IS NULL OR (
              w.description ILIKE $4 ESCAPE '\'
           OR w.line_memo   ILIKE $4 ESCAPE '\'
           OR w.reference   ILIKE $4 ESCAPE '\'
           OR w.cheque_number ILIKE $4 ESCAPE '\'
           OR upper(left(w.entry_id::text, 8)) LIKE upper($4) ESCAPE '\'
           OR ($7::text IS NOT NULL AND (
                   to_char(w.debit,  'FM9999999999999990.00') LIKE $7
                OR to_char(w.credit, 'FM9999999999999990.00') LIKE $7
                OR w.debit::text  LIKE $7
                OR w.credit::text LIKE $7
              ))
           OR w.entry_id IN (SELECT entry_id FROM contra_hits)
           OR w.entry_id IN (SELECT entry_id FROM bank_hits)
        ))
    ),
    tot AS MATERIALIZED (
      SELECT count(*) AS n, coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c FROM filt
    ),
    page AS (
      SELECT f.* FROM filt f ORDER BY %1$s LIMIT $8 OFFSET $9
    )
    SELECT f.entry_id, f.entry_date, f.created_at, f.description, f.line_memo, f.reference, f.status,
           f.entry_type, f.source_type, f.is_system_generated, f.reversal_of, f.voided_at,
           f.void_reason, f.line_id, f.debit, f.credit,
           coalesce(f.cheque_number, bimp.cheque), bimp.payee,
           coalesce(contra.lines, '[]'::jsonb),
           public.ledger_txn_type(f.reference, f.description),
           f.cum_debit, f.cum_credit,
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
          v_amount, greatest(coalesce(p_limit, 50), 1), greatest(coalesce(p_offset, 0), 0),
          v_keep_ob;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.account_ledger_page(uuid, date, date, text, text, text, text, text, int, int) TO authenticated;
