-- ═══════════════════════════════════════════════════════════════════════════
-- DATA CORRECTION — reverse suspense reclassifications that had nothing to
-- reverse.
--
-- Under the old clearing behaviour (superseded by 20260829140000), clearing a
-- suspense item posted a SECOND entry: Dr final account / Cr suspense. That is
-- only correct while the ORIGINAL import entry still holds the money in the
-- suspense account. If the original was re-coded directly in the ledger — via
-- the register's change-account or the Edit Transaction modal, neither of which
-- touches bank_statement_lines — the item stayed in the clearing queue and was
-- cleared again, leaving:
--
--   original  Dr <final account> / Cr <bank>     (correct on its own)
--   reclass   Dr <final account> / Cr 6010       (a second, unbacked debit)
--
-- so the final account is debited twice and the suspense account carries a
-- credit with no matching debit behind it.
--
-- Three lines on Ceylon Green Life are in this state, LKR 74,995,000:
--   2024-09-05  35,000,000  69000001 Green Creast
--   2025-01-21  20,000,000  1610 Lands
--   2025-03-25  19,995,000  69000001 Green Creast
--
-- ── The remedy ────────────────────────────────────────────────────────────
--
-- The original entries are already correct, so they are not touched. It is the
-- reclass entries that are wholly erroneous, and a posted entry is corrected by
-- REVERSING it, never by editing or deleting it — the error and its correction
-- both stay on the record.
--
-- The reversal is dated on the erroneous entry's OWN date, not today, because
-- both fiscal periods are open. Dating it today would leave FY2024-25 overstated
-- by the full amount and push an equal distortion into FY2026-27. Only when the
-- original period is closed does the correction belong in the current period.
--
-- bank_statement_lines is deliberately left alone. The lines ARE cleared — the
-- original entries carry the final coding — and reclass_journal_entry_id must
-- keep pointing at the reversed entry so undo_bank_statement_batch's reversal
-- chain still finds both it and its reversal.
--
-- Defined by the DEFECT rather than by hardcoded ids, so it corrects every
-- instance and is safe to re-run: an entry that already has a reversal is
-- skipped.
-- ═══════════════════════════════════════════════════════════════════════════

DO $fix$
DECLARE
  r         RECORD;
  v_new_je  UUID;
  v_fixed   INTEGER := 0;
  v_skipped INTEGER := 0;
  v_date    DATE;
BEGIN
  FOR r IN
    SELECT l.id AS line_id, l.tenant_id, l.journal_entry_id AS orig_je,
           l.reclass_journal_entry_id AS bad_je,
           je.entry_date, je.description, je.reference, je.created_by,
           CASE WHEN l.debit > 0
                THEN s.bank_import_unrecognized_payment_account_id
                ELSE s.bank_import_unrecognized_deposit_account_id END AS suspense_id
      FROM public.bank_statement_lines l
      JOIN public.journal_entries je ON je.id = l.reclass_journal_entry_id
      JOIN public.account_settings s ON s.tenant_id = l.tenant_id
     WHERE l.reclass_journal_entry_id IS NOT NULL
       AND je.source_type = 'bank_import_reclass'
       AND je.status      = 'posted'
       AND je.voided_at  IS NULL
       -- not already corrected
       AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv WHERE rv.reversal_of = je.id)
  LOOP
    -- The defect: the ORIGINAL import entry holds nothing in the directional
    -- suspense account, so the reclass had no balance to reverse.
    CONTINUE WHEN (
      SELECT COALESCE(sum(jl.debit) - sum(jl.credit), 0)
        FROM public.journal_lines jl
       WHERE jl.journal_entry_id = r.orig_je
         AND jl.account_id = r.suspense_id
    ) <> 0;

    -- Correct the year the error was made in when that period is still open;
    -- otherwise the correction belongs in the current period.
    v_date := r.entry_date;
    IF public.fiscal_period_is_closed(r.tenant_id, v_date) THEN
      v_date := CURRENT_DATE;
      IF public.fiscal_period_is_closed(r.tenant_id, v_date) THEN
        v_skipped := v_skipped + 1;
        RAISE WARNING 'Skipped reversal of % - both its own period and today are closed', r.bad_je;
        CONTINUE;
      END IF;
    END IF;

    -- source_type and unique_key are left NULL: idx_je_unique_source and
    -- idx_journal_entries_unique_key are unique over the live rows, and the
    -- entry being reversed still holds those keys.
    INSERT INTO public.journal_entries
      (tenant_id, entry_date, description, reference, status, entry_type,
       reversal_of, is_system_generated, created_by, posted_at)
    VALUES
      (r.tenant_id, v_date,
       'Reversal of: ' || r.description,
       'REV-' || COALESCE(NULLIF(btrim(r.reference), ''), left(r.bad_je::text, 8)),
       'posted', 'reversal', r.bad_je, true, r.created_by, now())
    RETURNING id INTO v_new_je;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    SELECT v_new_je, jl.account_id, jl.credit, jl.debit,
           CASE WHEN jl.memo IS NOT NULL THEN 'Reversal of: ' || jl.memo END
      FROM public.journal_lines jl
     WHERE jl.journal_entry_id = r.bad_je;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
    VALUES (r.tenant_id, r.created_by, 'Suspense Reclass Reversed', 'journal_entries', r.bad_je,
            jsonb_build_object(
              'reason', 'reclassification had no suspense balance to reverse; the original import entry was re-coded in the ledger',
              'line_id', r.line_id,
              'reversed_entry', r.bad_je,
              'reversal_entry', v_new_je,
              'reversal_date', v_date));

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'Orphaned suspense reclassifications reversed: % (skipped: %)', v_fixed, v_skipped;
END $fix$;
