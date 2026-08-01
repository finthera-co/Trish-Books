-- ═══════════════════════════════════════════════════════════════════════════
-- Ledger cheque number + payee, sourced account-scoped (fixes 1000-row cap).
--
-- Ledger.tsx / AccountReport.tsx showed the cheque number and payee via
-- useBankImportRefs(), a TENANT-WIDE `select` on bank_statement_lines with no
-- paging — so PostgREST's 1000-row cap silently dropped most rows and "some
-- cheque numbers were not showing". Move cheque + payee INTO the account-scoped
-- account_ledger_lines RPC (one row per line for the viewed account), so they
-- are always complete and never re-fetch the whole table. A JE from a bank
-- import matches bank_statement_lines on journal_entry_id (original posting) or
-- reclass_journal_entry_id (suspense reclass).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_bsl_reclass_je
  ON public.bank_statement_lines (reclass_journal_entry_id)
  WHERE reclass_journal_entry_id IS NOT NULL;

-- Return type gains two columns, so the function must be dropped first.
DROP FUNCTION IF EXISTS public.account_ledger_lines(uuid, date, date);

CREATE FUNCTION public.account_ledger_lines(
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
         bimp.cheque, bimp.payee,
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
