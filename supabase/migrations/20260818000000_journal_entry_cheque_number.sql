-- ═══════════════════════════════════════════════════════════════════════════
-- Cheque number on a manual journal entry.
--
-- The Account Register has always had a "Cheque No" column, but the only thing
-- that could ever fill it was a bank import (bank_statement_lines.voucher_no).
-- A cheque written and posted by hand — the ordinary case for a payment typed
-- straight into the journal — landed in the register with an em dash. The
-- Create/Edit Journal Entry forms now collect it, so it needs a home on the
-- entry and a path into both account-scoped reads.
--
-- Precedence: a hand-entered cheque number WINS over the bank-import one. If
-- someone typed it on the entry they are correcting or supplementing what the
-- import derived, and the reclass case (import → suspense → reclass JE) is
-- exactly where the imported voucher_no is least trustworthy.
--
-- Both account_ledger_page and account_ledger_lines change their `cheque`
-- source, and the register's free-text search matches the new column too.
-- account_ledger_page keeps the same return type, so it can be REPLACEd;
-- its body is otherwise identical to 20260815000003_journal_line_memo_reads.sql
-- (same lean window, whitelisted sort, narrow cumulative CTE).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS cheque_number text;

-- Free text, but bounded: this is a cheque/voucher number, not a memo field.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.journal_entries'::regclass
      AND conname  = 'journal_entries_cheque_number_len'
  ) THEN
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT journal_entries_cheque_number_len
      CHECK (cheque_number IS NULL OR char_length(cheque_number) BETWEEN 1 AND 50);
  END IF;
END $$;

COMMENT ON COLUMN public.journal_entries.cheque_number IS
  'Cheque / payment instrument number typed on a manual entry. Takes precedence over the bank-import voucher_no in the Account Register.';

-- Register search hits it, and the column is sparse, so keep the index partial.
CREATE INDEX IF NOT EXISTS idx_je_cheque_number
  ON public.journal_entries (tenant_id, cheque_number)
  WHERE cheque_number IS NOT NULL;

-- ── Account-scoped ledger lines (no paging) ────────────────────────────────
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
  cheque              text,
  payee               text,
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
         COALESCE(nullif(btrim(je.cheque_number), ''), bimp.cheque), bimp.payee,
         COALESCE(contra.lines, '[]'::jsonb)
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  LEFT JOIN LATERAL (
    -- cheque number (voucher_no) + payee for a bank-import entry; prefer the
    -- original posting row over a reclass row when both point here.
    SELECT bsl.voucher_no AS cheque, bsl.name AS payee
    FROM public.bank_statement_lines bsl
    WHERE bsl.journal_entry_id = je.id OR bsl.reclass_journal_entry_id = je.id
    ORDER BY (bsl.journal_entry_id = je.id) DESC
    LIMIT 1
  ) bimp ON true
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

GRANT EXECUTE ON FUNCTION public.account_ledger_lines(uuid, date, date) TO authenticated;

-- ── Account Register page ──────────────────────────────────────────────────
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
             nullif(btrim(je.cheque_number), '') AS cheque_number,
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
    tot AS (
      SELECT count(*) AS n, coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c FROM filt
    ),
    page AS (
      SELECT f.* FROM filt f ORDER BY %1$s LIMIT $8 OFFSET $9
    )
    SELECT f.entry_id, f.entry_date, f.created_at, f.description, f.line_memo, f.reference, f.status,
           f.entry_type, f.source_type, f.is_system_generated, f.reversal_of, f.voided_at,
           f.void_reason, f.line_id, f.debit, f.credit,
           -- Hand-entered cheque number wins; the import's voucher_no is the fallback.
           coalesce(f.cheque_number, bimp.cheque), bimp.payee,
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
