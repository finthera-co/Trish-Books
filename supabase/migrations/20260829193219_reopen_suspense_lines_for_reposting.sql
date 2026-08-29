-- ═══════════════════════════════════════════════════════════════════════════
-- DATA CORRECTION — reverse eight suspense reclassifications and return the
-- items to the clearing queue so they can be coded again.
--
-- These were cleared through the app on 2026-08-29, before the in-place
-- behaviour landed, so each posted a separate reclassification entry:
--
--   import    Dr 6010 Unrecognized Payments  / Cr <bank>
--   reclass   Dr 2420 Director Current Acct  (+ Dr 8010 Bank Charges)
--                                            / Cr 6010
--
-- Nothing is wrong with the double entry — the money is where it was sent.
-- The CODING is what is being withdrawn: they were posted to 2420 Director
-- Current Account and that is not where they belong, so the accountant wants
-- them back in Suspense Clearing to be re-coded.
--
--   J/E no.   date        amount          landed on
--   B45065F9  2024-11-12  13,001,815.38   2420 + 8010
--   0C7D0F5B  2024-11-12   3,394,815.38   2420 + 8010
--   8CD4D3EB  2024-12-20  13,003,025.64   2420 + 8010
--   7AA14763  2024-12-20   3,395,463.84   2420 + 8010
--   631E64F2  2025-01-28  18,882,025.64   2420 + 8010
--   23C40807  2025-02-03     600,000.00   2420
--   F93D63C3  2025-02-11  10,000,000.00   2420
--   89638848  2025-02-17   5,003,025.64   2420 + 8010
--                         ─────────────
--                         67,280,171.52
--
-- ── The remedy ────────────────────────────────────────────────────────────
--
-- A posted entry is withdrawn by REVERSING it, never by editing or deleting
-- it: the coding that was made and the coding that was withdrawn both stay on
-- the record. The reversal credits 2420 (and 8010) and debits 6010, which puts
-- the money back in the holding account — and 6010 is precisely what Suspense
-- Clearing lists, so the reversal is what reopens the item, not a side effect
-- of it.
--
-- The import entries are NOT touched. They still carry the original
-- Dr 6010 / Cr bank and remain the line's journal_entry_id, which is what the
-- next clearing will re-point.
--
-- Reversals are dated on the reclass entry's OWN date, since every one of
-- those periods is open. Dating them today would leave the year they were
-- posted in overstated and push an equal distortion into the current year.
-- The closed-period fallback is kept for safety even though nothing hits it.
--
-- bank_statement_lines is reset to open — needs_reclassification back to true,
-- suspense_cleared_at / _mode back to NULL, and reclass_journal_entry_id back
-- to NULL because no live reclass entry exists any more. That last is the same
-- thing undo_bank_statement_batch does once it has reversed a reclass, so the
-- reversal chain sees the state it expects. reviewed_by / reviewed_at are left
-- as they are: someone did review these, and that history stands.
--
-- Every period involved is open, so the re-clear will take the in_place path
-- and post no new entry — no unique_key collision with the entries reversed
-- here, which keep 'bank_import_reclass:<line_id>' while they are not voided.
--
-- Scoped to these eight entries by id because this is a coding decision being
-- withdrawn, not a defect to sweep for. Each is still guarded by the same
-- invariants and skipped if it does not hold, so the migration is safe to
-- re-run: an entry already reversed is left alone.
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
    SELECT je.id AS bad_je, je.tenant_id, je.entry_date, je.description,
           je.reference, je.created_by,
           l.id AS line_id, l.journal_entry_id AS import_je,
           CASE WHEN l.debit > 0
                THEN s.bank_import_unrecognized_payment_account_id
                ELSE s.bank_import_unrecognized_deposit_account_id END AS suspense_id,
           round(GREATEST(l.debit, l.credit), 2) AS amount,
           (l.debit > 0) AS is_payment
      FROM public.journal_entries je
      JOIN public.bank_statement_lines l ON l.reclass_journal_entry_id = je.id
      JOIN public.account_settings s     ON s.tenant_id = je.tenant_id
     WHERE je.id IN (
             'f93d63c3-06f4-4b01-bbe8-be31ea0cfb94',
             '89638848-bfbc-44a8-896d-ee76e8180549',
             '23c40807-6c57-465f-bcd4-afb2ecac0ef1',
             '631e64f2-1118-40a9-9ceb-bf24d67adb14',
             '8cd4d3eb-e0bf-4afc-b381-879fc5d92661',
             '7aa14763-7ec8-480a-92ef-1c36562585c6',
             'b45065f9-269e-4344-9c0f-d48283577cfa',
             '0c7d0f5b-2f4e-4f8c-83c1-ae0c18f1488c')
       AND je.source_type = 'bank_import_reclass'
       AND je.status      = 'posted'
       AND je.voided_at  IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv WHERE rv.reversal_of = je.id)
     ORDER BY je.entry_date
  LOOP
    -- The import entry must still be live and still hold the money in the
    -- holding account, on the right side and for the exact amount. If it does
    -- not, the reclass is not a plain withdrawal — it is one of the orphaned
    -- cases 20260829150000 dealt with, and must not be reopened blindly.
    IF NOT EXISTS (
      SELECT 1
        FROM public.journal_entries ije
        JOIN public.journal_lines   jl ON jl.journal_entry_id = ije.id
       WHERE ije.id        = r.import_je
         AND ije.status    = 'posted'
         AND ije.voided_at IS NULL
         AND jl.account_id = r.suspense_id
         AND jl.debit      = CASE WHEN r.is_payment THEN r.amount ELSE 0 END
         AND jl.credit     = CASE WHEN r.is_payment THEN 0 ELSE r.amount END
    ) THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Skipped % - its import entry no longer holds % in the holding account', r.bad_je, r.amount;
      CONTINUE;
    END IF;

    v_date := r.entry_date;
    IF public.fiscal_period_is_closed(r.tenant_id, v_date) THEN
      v_date := CURRENT_DATE;
      IF public.fiscal_period_is_closed(r.tenant_id, v_date) THEN
        v_skipped := v_skipped + 1;
        RAISE WARNING 'Skipped reversal of % - both its own period and today are closed', r.bad_je;
        CONTINUE;
      END IF;
    END IF;

    -- source_type and unique_key stay NULL: idx_je_unique_source and
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

    -- Back into the clearing queue.
    UPDATE public.bank_statement_lines
       SET needs_reclassification   = true,
           suspense_cleared_at      = NULL,
           suspense_cleared_mode    = NULL,
           reclass_journal_entry_id = NULL
     WHERE id = r.line_id;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
    VALUES (r.tenant_id, r.created_by, 'Suspense Reclass Reversed - Line Reopened',
            'journal_entries', r.bad_je,
            jsonb_build_object(
              'reason', 'reclassification withdrawn at the accountant''s request; the item is returned to Suspense Clearing to be re-coded',
              'line_id', r.line_id,
              'import_entry', r.import_je,
              'reversed_entry', r.bad_je,
              'reversal_entry', v_new_je,
              'reversal_date', v_date,
              'amount', r.amount));

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'Suspense reclassifications reversed and reopened: % (skipped: %)', v_fixed, v_skipped;
END $fix$;
