-- ═══════════════════════════════════════════════════════════════════════════
-- DATA CORRECTION — delete the eight suspense reclassification entries and
-- their reversals outright, so the ledger shows neither.
--
-- 20260829193219 withdrew eight reclassifications by REVERSING them, which is
-- the ordinary treatment: the coding made and the coding withdrawn both stay
-- visible. That leaves sixteen rows in the ledger — a debit and an equal
-- credit on 2420 Director Current Account, 8010 Bank Charges and 6010
-- Unrecognized Payments, same date, same amount — which reads as duplicate
-- clutter on accounts whose balance they no longer affect.
--
-- The accountant has asked for both halves gone. That is sound only because
-- of what these particular pairs are: each reclass and its reversal sum to
-- ZERO on every account they touch, so removing the pair moves no balance
-- anywhere. Deleting one half alone, or any entry not in such a pair, would
-- restate the accounts and is refused by the guard below.
--
--   J/E no.   date        amount          reversal
--   B45065F9  2024-11-12  13,001,815.38   0A807EB6
--   0C7D0F5B  2024-11-12   3,394,815.38   23CEEB1B
--   8CD4D3EB  2024-12-20  13,003,025.64   AD5ED578
--   7AA14763  2024-12-20   3,395,463.84   4F790B25
--   631E64F2  2025-01-28  18,882,025.64   5F06A614
--   23C40807  2025-02-03     600,000.00   1711E517
--   F93D63C3  2025-02-11  10,000,000.00   F016C271
--   89638848  2025-02-17   5,003,025.64   6B058122
--                         ─────────────
--                         67,280,171.52
--
-- ── The bank is not touched ───────────────────────────────────────────────
--
-- No bank or cash leg is involved at all. The bank side of these transactions
-- lives on the IMPORT entries (Dr 6010 / Cr bank), which are untouched and
-- still hold the money in suspense — the eight items are open in Suspense
-- Clearing, waiting to be re-coded. The guard below refuses any pair that
-- carries a leg on a Bank or Cash on Hand account, so this cannot
-- silently move a bank balance even if the data is not what is expected.
--
-- ── What replaces the audit trail ─────────────────────────────────────────
--
-- Deleting a posted entry destroys the record of it, which is why reversal is
-- normally the only correction. Every header and every line of all sixteen
-- entries is therefore written into audit_logs as jsonb BEFORE the delete, so
-- what was posted, when, by whom and against which accounts remains
-- recoverable from the audit trail even though the rows are gone.
--
-- Safe to re-run: once the entries are deleted the loop selects nothing.
-- ═══════════════════════════════════════════════════════════════════════════

DO $fix$
DECLARE
  r          RECORD;
  v_deleted  INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_net      NUMERIC;
  v_bank     INTEGER;
  v_refs     INTEGER;
  v_snapshot JSONB;
BEGIN
  FOR r IN
    SELECT je.id AS reclass_je, rv.id AS reversal_je, je.tenant_id,
           je.entry_date, je.description, je.created_by
      FROM public.journal_entries je
      JOIN public.journal_entries rv ON rv.reversal_of = je.id
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
     ORDER BY je.entry_date
  LOOP
    -- Guard 1: the pair must be self-cancelling on EVERY account it touches.
    -- Anything else would restate a balance when removed.
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

    -- Guard 2: no leg on a bank or cash account. Belt and braces - a
    -- self-cancelling pair moves no balance anyway - but it makes the promise
    -- that the bank is untouched structural rather than a matter of trust.
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

    -- Guard 3: nothing may still point at either entry.
    SELECT count(*) INTO v_refs
      FROM public.bank_statement_lines l
     WHERE l.reclass_journal_entry_id IN (r.reclass_je, r.reversal_je)
        OR l.journal_entry_id         IN (r.reclass_je, r.reversal_je);
    IF v_refs > 0 THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Skipped % - a bank statement line still references it', r.reclass_je;
      CONTINUE;
    END IF;

    -- Preserve the whole of both entries before the rows cease to exist.
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
              'reason', 'reclassification and its reversal cancel each other on every account; both removed from the ledger at the accountant''s request',
              'reclass_entry', r.reclass_je,
              'reversal_entry', r.reversal_je,
              'entry_date', r.entry_date,
              'deleted_entries', v_snapshot));

    -- The reversal first: it references the reclass through reversal_of.
    -- journal_lines go with them, ON DELETE CASCADE.
    DELETE FROM public.journal_entries WHERE id = r.reversal_je;
    DELETE FROM public.journal_entries WHERE id = r.reclass_je;

    v_deleted := v_deleted + 1;
  END LOOP;

  RAISE NOTICE 'Suspense reclass/reversal pairs deleted: % (skipped: %)', v_deleted, v_skipped;
END $fix$;
