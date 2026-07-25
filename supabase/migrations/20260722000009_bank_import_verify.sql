-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — post-import verification.
--
-- verify_bank_import_batch(batch_id) independently re-reads the DATABASE and
-- confirms the import actually landed: the statement lines are stored, a
-- journal entry exists for every postable line, the entries balance, the posted
-- value reconciles to the parsed control totals, and the cash-flow rows synced.
-- Returns a per-check pass/fail report plus an overall `ok`, so the UI can show
-- "everything is recorded" or point at the exact discrepancy. Read-only.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.verify_bank_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id   UUID;
  v_batch       public.bank_statement_batches;
  v_lines       INTEGER;   v_postable INTEGER;
  v_excluded    INTEGER;   v_blocked  INTEGER;
  v_suspense    INTEGER;   v_ledger   INTEGER;
  v_je          INTEGER;   v_jl       INTEGER;
  v_sum_dr      NUMERIC;   v_sum_cr   NUMERIC;
  v_line_dr     NUMERIC;   v_line_cr  NUMERIC;
  v_tx          INTEGER;
  v_missing_je  INTEGER;
  v_checks      JSONB := '[]'::jsonb;
  v_ok          BOOLEAN := true;
  -- one boolean per check, ANDed into v_ok
  c1 BOOLEAN; c2 BOOLEAN; c3 BOOLEAN; c4 BOOLEAN; c5 BOOLEAN; c6 BOOLEAN; c7 BOOLEAN;
BEGIN
  SELECT u.tenant_id INTO v_tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_batch FROM public.bank_statement_batches
   WHERE id = p_batch_id AND tenant_id = v_tenant_id;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NOT is_excluded AND block_reason IS NULL),
         count(*) FILTER (WHERE is_excluded),
         count(*) FILTER (WHERE block_reason IS NOT NULL),
         count(*) FILTER (WHERE resolution_tier = 3),
         count(*) FILTER (WHERE resolution_tier IN (1, 2)),
         count(*) FILTER (WHERE NOT is_excluded AND block_reason IS NULL AND journal_entry_id IS NULL)
    INTO v_lines, v_postable, v_excluded, v_blocked, v_suspense, v_ledger, v_missing_je
    FROM public.bank_statement_lines WHERE batch_id = p_batch_id;

  SELECT count(DISTINCT je.id), count(jl.*),
         COALESCE(sum(jl.debit), 0), COALESCE(sum(jl.credit), 0)
    INTO v_je, v_jl, v_sum_dr, v_sum_cr
    FROM public.bank_statement_lines l
    JOIN public.journal_entries je ON je.id = l.journal_entry_id
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
   WHERE l.batch_id = p_batch_id;

  -- Only POSTABLE lines reconcile against the posted value; blocked (corrupt)
  -- lines are held unposted by design and excluded here.
  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO v_line_dr, v_line_cr
    FROM public.bank_statement_lines
   WHERE batch_id = p_batch_id AND NOT is_excluded AND block_reason IS NULL;

  SELECT count(*) INTO v_tx FROM public.transactions
   WHERE source_type = 'journal_entry'
     AND source_id IN (SELECT journal_entry_id FROM public.bank_statement_lines
                        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL);

  -- ── Checks ────────────────────────────────────────────────────────────────
  c1 := v_batch.status = 'posted';
  c2 := v_lines = v_batch.row_count + v_excluded;
  c3 := v_missing_je = 0;
  c4 := v_je = (v_ledger + v_suspense) OR v_batch.status <> 'posted';
  c5 := v_sum_dr = v_sum_cr;
  c6 := round(v_sum_dr, 2) = round(v_line_dr + v_line_cr, 2);
  c7 := v_tx > 0 OR (v_ledger + v_suspense) = 0 OR v_batch.posting_mode = 'draft';
  v_ok := c1 AND c2 AND c3 AND c4 AND c5 AND c6 AND c7;

  v_checks := jsonb_build_array(
    jsonb_build_object('name', 'Batch posted', 'ok', c1,
      'detail', 'status = ' || v_batch.status),
    jsonb_build_object('name', 'All rows stored', 'ok', c2,
      'detail', v_lines || ' line(s) in database, expected ' || (v_batch.row_count + v_excluded)),
    jsonb_build_object('name', 'Every postable line has a journal entry', 'ok', c3,
      'detail', CASE WHEN v_missing_je = 0 THEN 'all ' || v_postable || ' postable line(s) posted'
                     ELSE v_missing_je || ' line(s) missing a journal entry' END),
    jsonb_build_object('name', 'Journal entries recorded', 'ok', c4,
      'detail', v_je || ' journal entr(ies) for ' || (v_ledger + v_suspense) || ' postable line(s)'),
    jsonb_build_object('name', 'Entries balance (Dr = Cr)', 'ok', c5,
      'detail', 'debits ' || to_char(v_sum_dr, 'FM999,999,999.00') || ' = credits ' || to_char(v_sum_cr, 'FM999,999,999.00')),
    jsonb_build_object('name', 'Posted value reconciles to the statement', 'ok', c6,
      'detail', 'posted ' || to_char(v_sum_dr, 'FM999,999,999.00') || ' vs statement ' || to_char(v_line_dr + v_line_cr, 'FM999,999,999.00')),
    jsonb_build_object('name', 'Cash-flow rows synced', 'ok', c7,
      'detail', v_tx || ' cash-flow row(s) recorded')
  );

  RETURN jsonb_build_object(
    'ok', v_ok,
    'batch_id', p_batch_id,
    'status', v_batch.status,
    'counts', jsonb_build_object(
      'rows_expected', v_batch.row_count,
      'lines_in_db', v_lines,
      'excluded', v_excluded,
      'blocked', v_blocked,
      'posted_to_ledger', v_ledger,
      'posted_to_suspense', v_suspense,
      'journal_entries', v_je,
      'journal_lines', v_jl,
      'transactions', v_tx),
    'totals', jsonb_build_object(
      'debit', v_sum_dr, 'credit', v_sum_cr, 'balanced', v_sum_dr = v_sum_cr),
    'checks', v_checks,
    'verified_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_bank_import_batch(UUID) TO authenticated;
