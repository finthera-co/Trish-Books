
-- Add match metadata and match type to bank_feed_transactions
ALTER TABLE public.bank_feed_transactions 
  ADD COLUMN IF NOT EXISTS match_metadata jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS match_type text DEFAULT NULL;

-- Performance indexes for matching engine
CREATE INDEX IF NOT EXISTS idx_journal_entries_source 
  ON public.journal_entries (source_type, source_id) 
  WHERE source_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date 
  ON public.journal_entries (tenant_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_journal_entries_external_ref 
  ON public.journal_entries (reference) 
  WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_lines_account_amounts 
  ON public.journal_lines (account_id, debit, credit);

CREATE INDEX IF NOT EXISTS idx_bank_feed_txn_matching 
  ON public.bank_feed_transactions (reconciliation_id, status, amount, transaction_date);

CREATE INDEX IF NOT EXISTS idx_bank_feed_txn_account 
  ON public.bank_feed_transactions (bank_account_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_dates 
  ON public.fiscal_periods (tenant_id, period_start, period_end, status);
