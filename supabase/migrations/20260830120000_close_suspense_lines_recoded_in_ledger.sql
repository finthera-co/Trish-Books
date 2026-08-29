-- ═══════════════════════════════════════════════════════════════════════════
-- DATA CORRECTION — close suspense items whose money already reached its
-- final ledger account.
--
-- Suspense Clearing lists bank_statement_lines.needs_reclassification, while
-- the Unrecognized Deposits / Payments registers read journal_lines. Those two
-- only agree while nothing moves the money behind the queue's back. Re-coding
-- an import entry directly in the ledger — the register's change-account, or
-- the Edit Transaction modal — rewrites journal_lines.account_id and never
-- touches bank_statement_lines, so the item leaves the holding account but
-- stays in the clearing queue for ever:
--
--   entry today   Dr 2410 Employee Provident Fund Payable / Cr 1120 Bank
--   queue still   needs_reclassification = true, suspense_cleared_at = NULL
--
-- 20260829150000 corrected the variant of this that had already been cleared a
-- SECOND time (reclass_journal_entry_id set, double-debiting the final
-- account). This one is its quieter sibling: never cleared in the app at all,
-- so nothing is mis-posted — the ledger is correct and complete, only the
-- queue is stale. There is therefore nothing to reverse. The entries are not
-- touched; only the queue is brought into line with them.
--
-- Ceylon Green Life carries 21 such lines, LKR 70,167,998, dated 2024-07-24 to
-- 2025-03-24 — bank charges and transfers re-coded to 1111/8010, 2410 EPF,
-- 1610 Lands, 69000001 Green Creast and others.
--
-- ── Leaving them open is not neutral ──────────────────────────────────────
--
-- Clearing one from the screen would post a second debit to the account that
-- already holds it and an unbacked credit to the holding account — precisely
-- the double-count 20260829150000 had to unwind. clear_suspense_lines()
-- refuses them (LINE_NOT_IN_SUSPENSE, its ROW_COUNT = 1 guard), so the queue
-- shows work that cannot be done and the bank cards overstate what is open.
--
-- ── The test ──────────────────────────────────────────────────────────────
--
-- An open line whose import entry is still posted and unvoided, and which has
-- NO leg at all on either holding account. Not "nets to zero" — a leg that
-- nets out is a partial or offset story worth a human look, whereas no leg is
-- unambiguous: the money went somewhere else and the entry balances without
-- suspense. Multi-leg outcomes are included (several of these were split in
-- the ledger into transfer + bank charge), which is also why resolved_account_id
-- is left NULL: there is no single account to name.
--
-- Marked with its own mode, 'ledger_recoded', so these are never mistaken for
-- items an accountant reclassified through the app.
--
-- Defined by the defect rather than by hardcoded ids, so it is safe to re-run
-- and corrects every tenant.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Admit the new clearing mode ────────────────────────────────────────
ALTER TABLE public.bank_statement_lines
  DROP CONSTRAINT IF EXISTS bsl_suspense_cleared_mode_chk;

ALTER TABLE public.bank_statement_lines
  ADD CONSTRAINT bsl_suspense_cleared_mode_chk
  CHECK (suspense_cleared_mode IS NULL
         OR suspense_cleared_mode IN ('in_place', 'reclass', 'ledger_recoded'));

COMMENT ON COLUMN public.bank_statement_lines.suspense_cleared_mode IS
  'in_place = the original entry''s suspense leg was re-pointed; reclass = a separate reclassification entry was posted (closed period); ledger_recoded = the entry was re-coded directly in the ledger outside the clearing screen, and the queue was reconciled to it.';

-- ── 2. Reconcile the queue to the ledger ──────────────────────────────────
DO $fix$
DECLARE
  v_fixed INTEGER := 0;
BEGIN
  WITH stale AS (
    SELECT l.id, l.tenant_id, l.journal_entry_id, l.txn_date, l.debit, l.credit
      FROM public.bank_statement_lines l
      JOIN public.account_settings s  ON s.tenant_id = l.tenant_id
      JOIN public.journal_entries  je ON je.id = l.journal_entry_id
     WHERE l.needs_reclassification
       AND l.suspense_cleared_at IS NULL
       AND je.status     = 'posted'
       AND je.voided_at IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.journal_lines jl
              WHERE jl.journal_entry_id = l.journal_entry_id
                AND jl.account_id IN (s.bank_import_unrecognized_payment_account_id,
                                      s.bank_import_unrecognized_deposit_account_id))
  ),
  upd AS (
    UPDATE public.bank_statement_lines l
       SET needs_reclassification = false,
           suspense_cleared_at    = now(),
           suspense_cleared_mode  = 'ledger_recoded'
      FROM stale
     WHERE l.id = stale.id
    RETURNING l.id, l.tenant_id, l.journal_entry_id, l.txn_date, l.debit, l.credit
  )
  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  SELECT u.tenant_id, NULL, 'Suspense Line Closed - Recoded In Ledger',
         'bank_statement_lines', u.id,
         jsonb_build_object(
           'reason', 'the import entry no longer holds this amount in a suspense account; it was re-coded directly in the ledger, so the item was already in its final account',
           'journal_entry_id', u.journal_entry_id,
           'txn_date', u.txn_date,
           'amount', u.debit + u.credit,
           'landed_on', (SELECT jsonb_agg(a.account_code || ' ' || a.account_name ORDER BY a.account_code)
                           FROM public.journal_lines jl
                           JOIN public.accounts a ON a.id = jl.account_id
                          WHERE jl.journal_entry_id = u.journal_entry_id))
    FROM upd u;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'Suspense lines closed as already-recoded: %', v_fixed;
END $fix$;
