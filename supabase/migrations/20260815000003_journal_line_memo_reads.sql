-- ═══════════════════════════════════════════════════════════════════════════
-- Per-line descriptions reach the reads that show them.
--
-- journal_lines.memo has existed since the GL report foundation, and
-- gl_report_transactions already resolves it (own memo → -MULTIPLE- → entry
-- description). Nothing wrote it on a manual entry, because the create and edit
-- forms only ever collected one description for the whole entry. They now
-- collect one per line, so the two other read paths have to carry it:
--
--   • je_lines_json — the expanded row under an entry in the Journal Entries
--     list. Also switched to seq order: it was ordered by account_code, which
--     is alphabetical rather than the order the lines were entered and posted
--     in. Harmless while every line shared one description; actively confusing
--     once each line has its own.
--
--   • account_ledger_page — the Account Register's Memo column, which showed
--     the entry description on every line of the entry. It now returns the
--     line's own memo alongside it (the client falls back to the entry
--     description, the same rule the GL applies) and the free-text search
--     matches it.
--
-- account_ledger_page's return type changes, so it is dropped and recreated
-- rather than replaced. The body is otherwise identical to
-- 20260807000003_account_ledger_page_lean_window.sql — same lean-window plan,
-- same whitelisted sort interpolation, same narrow cumulative-sum CTE. The one
-- added column rides along in `win`, which already scans journal_lines.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Entry list: lines for one entry ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.je_lines_json(p_entry_id uuid)
RETURNS TABLE (total_debit numeric, total_credit numeric, lines jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(jl.debit), 0),
    COALESCE(SUM(jl.credit), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',         jl.id,
          'account_id', jl.account_id,
          'debit',      jl.debit,
          'credit',     jl.credit,
          'memo',       jl.memo,
          'seq',        jl.seq,
          'accounts',   jsonb_build_object(
            'account_code', a.account_code,
            'account_name', a.account_name
          )
        )
        -- seq, not account_code: the order the lines were entered and posted in
        -- is the order their descriptions have to be read in.
        ORDER BY jl.seq
      ),
      '[]'::jsonb
    )
  FROM public.journal_lines jl
  LEFT JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = p_entry_id;
$$;

-- ── Account Register page ──────────────────────────────────────────────────
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
             jl.memo AS line_memo,
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
    -- Cumulative sums in LEDGER order over the whole window, before any
    -- filtering: row N's running balance does not depend on what the user
    -- searched for or how the grid is sorted. Narrow on purpose — only the
    -- sort keys and the amounts go through the window.
    cum AS (
      SELECT n.line_id,
             sum(n.debit)  OVER w AS cum_debit,
             sum(n.credit) OVER w AS cum_credit
      FROM (SELECT line_id, entry_id, entry_date, created_at, debit, credit FROM win) n
      WINDOW w AS (ORDER BY n.entry_date, n.created_at, n.entry_id, n.line_id
                   ROWS UNBOUNDED PRECEDING)
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
      SELECT w.* FROM win w
      WHERE ($5::text IS NULL OR coalesce(nullif(w.entry_type, ''), 'manual') = $5::text)
        AND ($6::text IS NULL OR public.ledger_txn_type(w.reference, w.description) = $6::text)
        AND ($4::text IS NULL OR (
              w.description ILIKE $4 ESCAPE '\'
           OR w.line_memo   ILIKE $4 ESCAPE '\'
           OR w.reference   ILIKE $4 ESCAPE '\'
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
    tot AS (
      SELECT count(*) AS n, coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c FROM filt
    ),
    page AS (
      SELECT f.* FROM filt f ORDER BY %1$s LIMIT $8 OFFSET $9
    )
    SELECT f.entry_id, f.entry_date, f.created_at, f.description, f.line_memo, f.reference, f.status,
           f.entry_type, f.source_type, f.is_system_generated, f.reversal_of, f.voided_at,
           f.void_reason, f.line_id, f.debit, f.credit,
           bimp.cheque, bimp.payee,
           coalesce(contra.lines, '[]'::jsonb),
           public.ledger_txn_type(f.reference, f.description),
           c.cum_debit, c.cum_credit,
           tot.n, tot.d, tot.c
    FROM page f
    CROSS JOIN tot
    JOIN cum c ON c.line_id = f.line_id
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
