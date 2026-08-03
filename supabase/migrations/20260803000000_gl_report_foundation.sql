-- General Ledger report foundation: deterministic line order, line memo, adjusting flag, indexes.
-- Additive and idempotent throughout.

-- ── 1.1 Deterministic line ordering ─────────────────────────────────────────
-- journal_lines has no sequence, no line_no, no created_at; id is a random uuid.
-- A running-balance column computed over a non-deterministic row order is not an
-- auditable artifact. bigserial is assigned per-row by the sequence, so it is
-- correct under multi-row INSERT (every posting path in this codebase inserts
-- lines as a single multi-row statement), concurrency, and COPY alike — unlike a
-- MAX()+1 trigger, which cannot see sibling rows of the same statement.
ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS seq bigserial;

COMMENT ON COLUMN public.journal_lines.seq
  IS 'Monotonic insertion sequence. Sole deterministic intra-entry line order. '
     'Assigned by the sequence default — correct under multi-row INSERT, concurrency and COPY, '
     'unlike a MAX()+1 trigger. Never reuse, never update.';

CREATE INDEX IF NOT EXISTS idx_jl_entry_seq
  ON public.journal_lines (journal_entry_id, seq);

-- ── 1.2 Line-level memo ─────────────────────────────────────────────────────
ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS memo text;

COMMENT ON COLUMN public.journal_lines.memo
  IS 'Optional per-line narration. Falls back to journal_entries.description in reports. '
     'When a line has no memo and its entry has >= 2 distinct line memos, the General Ledger '
     'renders -MULTIPLE- (QuickBooks parity).';

-- ── 1.3 Adjusting-entry flag ────────────────────────────────────────────────
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS is_adjusting boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.journal_entries.is_adjusting
  IS 'Adjusting-entry flag. Renders as the check glyph in the Adj column of the General Ledger.';

-- Meaning-preserving backfill ONLY. Never infer this from source_type: guessing which
-- historical entries were adjustments is fabricating audit metadata.
UPDATE public.journal_entries
SET is_adjusting = true
WHERE entry_type = 'adjustment' AND is_adjusting = false;

-- ── 1.4 Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_je_tenant_date_live
  ON public.journal_entries (tenant_id, entry_date)
  WHERE status = 'posted' AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jl_account_entry
  ON public.journal_lines (account_id, journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_parent
  ON public.accounts (tenant_id, parent_account_id, account_code);
