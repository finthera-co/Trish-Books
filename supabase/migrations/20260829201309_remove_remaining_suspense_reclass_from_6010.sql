-- ═══════════════════════════════════════════════════════════════════════════
-- DATA CORRECTION — clear the remaining suspense reclassification entries out
-- of 6010 Unrecognized Payments.
--
-- Nine rows are left cluttering the 6010 ledger after 20260829194615. They are
-- not all the same shape, and treating them alike would be wrong, so this
-- migration splits them by what the ledger actually says.
--
-- ── Group A: seven live reclassifications, LKR 382,180.00 ─────────────────
--
--   J/E no.   date        amount      coded to
--   B0AD4DD7  2024-03-07    1,000.00  49000004 Deelecta
--   E746059B  2024-05-30  200,030.00  49000004 Deelecta + 8010
--   99DCC294  2024-06-03    6,530.00  6500 Agriculture Expenses + 8010
--   BF35B32E  2024-06-07   12,530.00  2440 Salary & Wages Payable + 8010
--   05CE7101  2024-09-02   37,030.00  6280 Staff Welfare + 8010
--   3A876E3C  2024-09-11   60,030.00  7010 Advertising Expenses + 8010
--   DB3009BC  2024-09-29   65,030.00  7040 Promotional Expenses + 8010
--
-- Each is Dr <final account> / Cr 6010, and each import entry STILL holds the
-- matching Dr 6010 — verified leg by leg, on the exact amount. Deleting the
-- reclassification therefore does exactly what reversing it and deleting both
-- halves did last time: the credit leaves 6010, the import entry's debit
-- stands alone again, and the item is open in Suspense Clearing to be
-- re-coded. Posting a reversal purely to delete it in the same breath would
-- add two more rows to the ledger the accountant is trying to clear.
--
-- The coding being withdrawn is the whole point, so these DO move balances -
-- out of Deelecta, Staff Welfare, Advertising and the rest, and back into
-- 6010 where the item is once again unrecognized. The bank is not touched:
-- the bank leg lives on the import entry, which is left exactly as it is.
--
-- ── Group B: one already-reversed pair, LKR 19,995,000.00 ─────────────────
--
--   175108FC  2025-03-25  19,995,000.00  69000001 Green Creast
--   D9902C9E  2025-03-25  reversal of the above (20260829150000)
--
-- This one is NOT reopened. Its import entry D924913A reads
-- Dr 69000001 Green Creast / Cr 1100 Peoples Bank - it carries no 6010 leg at
-- all, because the money was re-coded directly in the ledger and never went
-- back through the clearing screen. That is precisely why 20260829150000 had
-- to reverse the reclassification: it was debiting Green Creast a second time.
-- Returning this line to the queue would invite that double-count to be made
-- again. The money is already in its final account, so the line stays cleared
-- and is re-marked 'ledger_recoded' - the mode 20260830120000 defined for
-- exactly this state. The pair nets to zero, so removing both halves moves
-- nothing.
--
-- ── What replaces the audit trail ─────────────────────────────────────────
--
-- Deleting a posted entry destroys the record of it. Every header and line is
-- therefore snapshotted into audit_logs as jsonb BEFORE the delete, so what
-- was posted, when, by whom and against which accounts stays recoverable.
--
-- Safe to re-run: once deleted, both loops select nothing.
-- ═══════════════════════════════════════════════════════════════════════════

DO $fix$
DECLARE
  r          RECORD;
  v_reopened INTEGER := 0;
  v_closed   INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_bank     INTEGER;
  v_net      NUMERIC;
  v_snapshot JSONB;
BEGIN
  -- ── Group A: withdraw the coding, return the item to the queue ──────────
  FOR r IN
    SELECT je.id AS reclass_je, je.tenant_id, je.entry_date, je.description,
           je.created_by,
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
             'b0ad4dd7-f71d-457c-afaf-0bc0e6c5e6ad',
             'e746059b-ba00-4abe-92f2-b72eb27a2c73',
             '99dcc294-a50b-445f-a1e8-5f32115cab27',
             'bf35b32e-c6a5-487d-bccf-8f35cc60f351',
             '05ce7101-dec3-4c51-b528-fa70d9017503',
             '3a876e3c-ea5a-4fa4-8585-d8362acd4abe',
             'db3009bc-4cfb-41dc-ad96-63aca4e98371')
       AND je.source_type = 'bank_import_reclass'
       AND je.status      = 'posted'
       AND je.voided_at  IS NULL
       -- A reversed entry belongs to group B's treatment, not this one.
       AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv WHERE rv.reversal_of = je.id)
     ORDER BY je.entry_date
  LOOP
    -- Guard 1: the import entry must still be live and still hold the money in
    -- the holding account, on the right side and for the exact amount. Without
    -- that debit standing behind it, deleting the credit would leave 6010
    -- holding an item the ledger has already coded elsewhere.
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
      RAISE WARNING 'Skipped % - its import entry no longer holds % in the holding account', r.reclass_je, r.amount;
      CONTINUE;
    END IF;

    -- Guard 2: the entry being deleted must carry no bank or cash leg, so the
    -- promise that the bank is untouched is structural, not a matter of trust.
    SELECT count(*) INTO v_bank
      FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.journal_entry_id = r.reclass_je
       AND a.account_subtype IN ('Bank', 'Cash on Hand');
    IF v_bank > 0 THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Skipped % - it carries a bank leg', r.reclass_je;
      CONTINUE;
    END IF;

    SELECT to_jsonb(je) - 'tenant_id' || jsonb_build_object(
             'lines', (SELECT jsonb_agg(jsonb_build_object(
                                'account_code', a.account_code,
                                'account_name', a.account_name,
                                'debit', jl.debit,
                                'credit', jl.credit,
                                'memo', jl.memo) ORDER BY a.account_code)
                         FROM public.journal_lines jl
                         JOIN public.accounts a ON a.id = jl.account_id
                        WHERE jl.journal_entry_id = je.id))
      INTO v_snapshot
      FROM public.journal_entries je WHERE je.id = r.reclass_je;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
    VALUES (r.tenant_id, r.created_by, 'Suspense Reclass Deleted - Line Reopened',
            'journal_entries', r.reclass_je,
            jsonb_build_object(
              'reason', 'reclassification withdrawn at the accountant''s request and removed from the ledger; the import entry still holds the amount in suspense, so the item returns to Suspense Clearing to be re-coded',
              'reclass_entry', r.reclass_je,
              'import_entry', r.import_je,
              'line_id', r.line_id,
              'entry_date', r.entry_date,
              'amount', r.amount,
              'deleted_entry', v_snapshot));

    -- Release the FK before the entry goes, and reopen the queue item.
    UPDATE public.bank_statement_lines
       SET needs_reclassification   = true,
           suspense_cleared_at      = NULL,
           suspense_cleared_mode    = NULL,
           reclass_journal_entry_id = NULL
     WHERE id = r.line_id;

    DELETE FROM public.journal_entries WHERE id = r.reclass_je;   -- lines cascade

    v_reopened := v_reopened + 1;
  END LOOP;

  -- ── Group B: remove a self-cancelling pair, leave the line cleared ───────
  FOR r IN
    SELECT je.id AS reclass_je, rv.id AS reversal_je, je.tenant_id,
           je.entry_date, je.created_by,
           l.id AS line_id, l.journal_entry_id AS import_je,
           CASE WHEN l.debit > 0
                THEN s.bank_import_unrecognized_payment_account_id
                ELSE s.bank_import_unrecognized_deposit_account_id END AS suspense_id,
           round(GREATEST(l.debit, l.credit), 2) AS amount
      FROM public.journal_entries je
      JOIN public.journal_entries rv     ON rv.reversal_of = je.id
      JOIN public.bank_statement_lines l ON l.reclass_journal_entry_id = je.id
      JOIN public.account_settings s     ON s.tenant_id = je.tenant_id
     WHERE je.id = '175108fc-0025-432d-88e5-fdb34e633fd6'
       AND je.source_type = 'bank_import_reclass'
  LOOP
    -- Guard 1: the pair must cancel on every account it touches.
    SELECT COALESCE(sum(abs(net)), 0) INTO v_net
      FROM (SELECT jl.account_id, sum(jl.debit) - sum(jl.credit) AS net
              FROM public.journal_lines jl
             WHERE jl.journal_entry_id IN (r.reclass_je, r.reversal_je)
             GROUP BY jl.account_id) q;
    IF v_net <> 0 THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Skipped % - the pair does not net to zero (residual %)', r.reclass_je, v_net;
      CONTINUE;
    END IF;

    -- Guard 2: no bank or cash leg.
    SELECT count(*) INTO v_bank
      FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.journal_entry_id IN (r.reclass_je, r.reversal_je)
       AND a.account_subtype IN ('Bank', 'Cash on Hand');
    IF v_bank > 0 THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Skipped % - it carries a bank leg', r.reclass_je;
      CONTINUE;
    END IF;

    -- Guard 3: this treatment is only correct because the import entry holds
    -- NO suspense leg - the money was re-coded in the ledger and is already in
    -- its final account. If it did hold one, the line would be reopenable and
    -- belongs in group A instead.
    IF EXISTS (
      SELECT 1 FROM public.journal_lines jl
       WHERE jl.journal_entry_id = r.import_je
         AND jl.account_id       = r.suspense_id
    ) THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Skipped % - its import entry still holds a suspense leg', r.reclass_je;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(e ORDER BY e->>'entry_date') INTO v_snapshot
      FROM (
        SELECT to_jsonb(je) - 'tenant_id' || jsonb_build_object(
                 'lines', (SELECT jsonb_agg(jsonb_build_object(
                                    'account_code', a.account_code,
                                    'account_name', a.account_name,
                                    'debit', jl.debit,
                                    'credit', jl.credit,
                                    'memo', jl.memo) ORDER BY a.account_code)
                             FROM public.journal_lines jl
                             JOIN public.accounts a ON a.id = jl.account_id
                            WHERE jl.journal_entry_id = je.id)) AS e
          FROM public.journal_entries je
         WHERE je.id IN (r.reclass_je, r.reversal_je)) s;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
    VALUES (r.tenant_id, r.created_by, 'Suspense Reclass Pair Deleted',
            'journal_entries', r.reclass_je,
            jsonb_build_object(
              'reason', 'reclassification and its reversal cancel each other on every account; both removed from the ledger. The line stays cleared: its import entry was re-coded directly in the ledger and already holds the money in its final account.',
              'reclass_entry', r.reclass_je,
              'reversal_entry', r.reversal_je,
              'import_entry', r.import_je,
              'line_id', r.line_id,
              'entry_date', r.entry_date,
              'amount', r.amount,
              'deleted_entries', v_snapshot));

    -- The line remains cleared. Only the pointer to the deleted entry goes,
    -- and the mode is corrected to what actually happened.
    UPDATE public.bank_statement_lines
       SET reclass_journal_entry_id = NULL,
           suspense_cleared_mode    = 'ledger_recoded',
           suspense_cleared_at      = COALESCE(suspense_cleared_at, now()),
           needs_reclassification   = false
     WHERE id = r.line_id;

    DELETE FROM public.journal_entries WHERE id = r.reversal_je;  -- references the reclass
    DELETE FROM public.journal_entries WHERE id = r.reclass_je;

    v_closed := v_closed + 1;
  END LOOP;

  RAISE NOTICE 'Reclassifications deleted and reopened: %; self-cancelling pairs deleted: % (skipped: %)',
               v_reopened, v_closed, v_skipped;
END $fix$;
