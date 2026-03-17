
-- Add debit/credit columns to opening_balances (replacing single balance column)
ALTER TABLE public.opening_balances 
  ADD COLUMN IF NOT EXISTS debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit numeric NOT NULL DEFAULT 0;

-- Migrate existing balance data to debit/credit
UPDATE public.opening_balances SET debit = balance WHERE balance > 0;
UPDATE public.opening_balances SET credit = ABS(balance) WHERE balance < 0;

-- Add unique constraint for per-period per-account entries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opening_balances_account_period_unique'
  ) THEN
    ALTER TABLE public.opening_balances 
      ADD CONSTRAINT opening_balances_account_period_unique UNIQUE (account_id, fiscal_period_id);
  END IF;
END $$;

-- Add index for fast period lookups
CREATE INDEX IF NOT EXISTS idx_opening_balances_period ON public.opening_balances(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_opening_balances_tenant_period ON public.opening_balances(tenant_id, fiscal_period_id);
