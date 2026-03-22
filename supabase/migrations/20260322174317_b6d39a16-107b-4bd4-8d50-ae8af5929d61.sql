
-- Add created_from column to accounts (tracks if account was created from OBE screen)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS created_from text DEFAULT NULL;

-- Add obe_batch_id column to journal_entries (tracks OBE batch grouping)
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS obe_batch_id text DEFAULT NULL;
