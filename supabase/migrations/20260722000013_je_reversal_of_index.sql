-- ═══════════════════════════════════════════════════════════════════════════
-- Index journal_entries.reversal_of.
--
-- Deleting a journal entry triggers the FK check "does anything reverse me?"
-- (SELECT 1 FROM journal_entries WHERE <id> = reversal_of FOR KEY SHARE). With
-- no index that is a full table scan PER deleted row, so undoing a large bank
-- import (tens of thousands of entries) hit the statement timeout. The undo
-- also walks the reversal chain via a recursive CTE on this column. Partial
-- (non-null) because the vast majority of entries are not reversals.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_je_reversal_of
  ON public.journal_entries (reversal_of)
  WHERE reversal_of IS NOT NULL;
