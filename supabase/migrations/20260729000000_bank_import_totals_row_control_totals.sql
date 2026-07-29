-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — control totals must ignore footer TOTAL rows.
--
-- The engine now detects a spreadsheet footer (an amount with no date,
-- description, name, voucher or account type) and blocks it with
-- block_reason = 'totals_row', keeping it OUT of the batch's control totals —
-- a footer is a restatement of the rows above it, never a movement.
--
-- import_bank_statement_post re-derives those totals from the stored lines to
-- prove nothing changed between parse and post, but its filter was only
-- `NOT is_excluded`, so it counted the footer rows the engine had excluded and
-- aborted every import of a sheet with one:
--   CONTROL_TOTAL_MISMATCH: parsed (Dr 1775201566.45, …, n=303)
--                        vs stored (Dr 22304102.72, …, n=300)
--
-- The footer rows are still PERSISTED (block_reason = 'totals_row') so the
-- audit trail shows what was skipped and why — they are only excluded from the
-- reconciliation arithmetic. Every other guard in the RPC is untouched.
--
-- Patched in place off pg_get_functiondef rather than restated, so this cannot
-- silently revert whatever the newest definition of the function is.
-- ═══════════════════════════════════════════════════════════════════════════

DO $mig$
DECLARE
  v_def     TEXT;
  v_patched TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'import_bank_statement_post';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'import_bank_statement_post() not found';
  END IF;

  -- Idempotent: nothing to do if this migration already ran.
  IF position('block_reason IS DISTINCT FROM ''totals_row''' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_patched := replace(v_def,
    'WHERE l.batch_id = p_batch_id AND NOT l.is_excluded;
  IF round(v_sum_debit, 2)',
    'WHERE l.batch_id = p_batch_id AND NOT l.is_excluded
     AND l.block_reason IS DISTINCT FROM ''totals_row'';
  IF round(v_sum_debit, 2)');

  -- Fail loudly rather than leave the guard silently unpatched.
  IF v_patched = v_def THEN
    RAISE EXCEPTION 'control-total block not found in import_bank_statement_post() — patch target changed';
  END IF;

  EXECUTE v_patched;
END $mig$;

-- ── verify_bank_import_batch: same assumption in its "All rows stored" check ──
-- c2 asserted `lines_in_db = row_count + excluded`. Footer rows ARE stored but
-- are no longer part of row_count, so a clean import of a sheet with a footer
-- reported a false failure (303 stored vs 300 expected). Count them explicitly
-- on the expected side — both in the assertion and in the detail string, so the
-- number the user reads matches the verdict.
DO $mig$
DECLARE
  v_def     TEXT;
  v_patched TEXT;
  v_expr    CONSTANT TEXT :=
    '(SELECT count(*) FROM public.bank_statement_lines
             WHERE batch_id = p_batch_id AND block_reason = ''totals_row'')';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'verify_bank_import_batch';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'verify_bank_import_batch() not found';
  END IF;

  IF position('block_reason = ''totals_row''' IN v_def) > 0 THEN
    RETURN;  -- already patched
  END IF;

  v_patched := replace(v_def,
    'c2 := v_lines = v_batch.row_count + v_excluded;',
    'c2 := v_lines = v_batch.row_count + v_excluded + ' || v_expr || ';');

  v_patched := replace(v_patched,
    '''detail'', v_lines || '' line(s) in database, expected '' || (v_batch.row_count + v_excluded)),',
    '''detail'', v_lines || '' line(s) in database, expected '' || (v_batch.row_count + v_excluded + '
      || v_expr || ')),');

  IF v_patched = v_def THEN
    RAISE EXCEPTION 'row-count check not found in verify_bank_import_batch() — patch target changed';
  END IF;

  EXECUTE v_patched;
END $mig$;
