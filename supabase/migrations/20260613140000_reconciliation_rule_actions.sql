-- ═══════════════════════════════════════════════════════════════════════════
-- Bank-feed rule ACTION EXECUTION: extend reconciliation_rules so a rule can
-- auto-post a balanced journal entry for an unmatched bank line that has no
-- ledger counterpart.
--
-- MASTER SWITCH:  action_create_expense
--   When TRUE  AND action_account_id IS NOT NULL  -> the matching engine
--   auto-posts a balanced, posted JE on a rule-only match (RULE_AUTO) and
--   clears the bank line.
--   When FALSE -> behaviour is unchanged (suggest only; no JE).
--
-- action_account_id semantics depend on direction:
--   outflow -> expense/fee account (Dr net)        e.g. bank charges, direct debit
--   inflow  -> income account      (Cr net)        e.g. interest income
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reconciliation_rules
  ADD COLUMN IF NOT EXISTS action_direction text NOT NULL DEFAULT 'outflow'
    CHECK (action_direction IN ('outflow','inflow','either')),
  -- guards which sign a rule may fire on; 'outflow' = expense/fee/direct debit
  ADD COLUMN IF NOT EXISTS tax_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Dr (input VAT) for outflows / Cr for inflows when tax_rate > 0
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate < 1),
  -- e.g. 0.18 for 18% VAT; the bank amount is treated as TAX-INCLUSIVE
  ADD COLUMN IF NOT EXISTS counterparty_name text;
  -- optional memo/payee stamped onto the JE description

COMMENT ON COLUMN public.reconciliation_rules.action_create_expense IS
  'Master switch for rule action execution. When TRUE and action_account_id is set, the reconciliation engine auto-posts a balanced JE (RULE_AUTO) on a rule-only match and clears the bank line. When FALSE, the rule only suggests (no JE).';
COMMENT ON COLUMN public.reconciliation_rules.action_direction IS
  'Sign guard for action execution: outflow (money leaving bank, Dr expense), inflow (money entering bank, Cr income), or either (decide by bank line sign).';
COMMENT ON COLUMN public.reconciliation_rules.tax_rate IS
  'Tax-inclusive rate (0..1). When > 0, the bank amount is split into net + tax; tax posts to tax_account_id.';

-- ─── Idempotency backstop ────────────────────────────────────────────────────
-- Rule JEs set source_type='reconciliation_rule', source_id=<bank_feed_transactions.id>.
-- A re-run on the same bank line must NOT create a duplicate JE. The engine does an
-- explicit pre-check, and this partial unique index enforces it at the DB level.
-- Scoped narrowly to the new source_type (and non-voided rows) so it cannot fail on
-- pre-existing data from other source types. NULL source_ids are distinct, so legacy
-- rule JEs (which never set source_id) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_unique_rule_source
  ON public.journal_entries (source_type, source_id)
  WHERE source_type = 'reconciliation_rule' AND source_id IS NOT NULL AND status <> 'voided';
