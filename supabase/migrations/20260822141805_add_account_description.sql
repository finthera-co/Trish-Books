-- Account Context Menu (Phase 3): "Edit Account" gains a free-text description
-- field. No backfill needed — every existing account simply has none yet.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS description text;
