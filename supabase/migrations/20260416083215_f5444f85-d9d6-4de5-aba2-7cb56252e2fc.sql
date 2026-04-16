
-- 1. Add UNIQUE constraint on asset_depreciation(asset_id, period) to prevent duplicate postings at DB level
ALTER TABLE public.asset_depreciation
  ADD CONSTRAINT uq_asset_depreciation_asset_period UNIQUE (asset_id, period);

-- 2. Add unique_key column to journal_entries for idempotency
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS unique_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_unique_key
  ON public.journal_entries (unique_key)
  WHERE unique_key IS NOT NULL;
