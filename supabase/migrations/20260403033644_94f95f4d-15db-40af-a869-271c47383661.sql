-- Add is_control_account flag
ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS is_control_account boolean NOT NULL DEFAULT false;

-- Auto-mark existing control accounts based on subtype
UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'customer'
WHERE lower(account_subtype) = 'accounts receivable';

UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'vendor'
WHERE lower(account_subtype) = 'accounts payable';

UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'inventory'
WHERE lower(account_subtype) = 'inventory';

UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'fixed_asset'
WHERE lower(account_subtype) IN ('fixed assets', 'furniture & equipment', 'vehicles', 'buildings');

-- Create index for quick control account lookups
CREATE INDEX IF NOT EXISTS idx_accounts_control ON public.accounts (is_control_account) WHERE is_control_account = true;