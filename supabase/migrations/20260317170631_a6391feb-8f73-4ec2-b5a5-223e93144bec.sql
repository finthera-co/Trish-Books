
-- Add opening balance fields to accounts table
ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS opening_balance_type text NOT NULL DEFAULT 'debit',
ADD COLUMN IF NOT EXISTS normal_balance text NOT NULL DEFAULT 'debit',
ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

-- Add opening_balance_status to system_settings if not exists (will use setting_key)
-- We'll use system_settings for: opening_balance_date, opening_balance_status, obe_closed

-- Add unique constraint on system_settings if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_tenant_key_unique'
  ) THEN
    ALTER TABLE public.system_settings 
    ADD CONSTRAINT system_settings_tenant_key_unique UNIQUE (tenant_id, setting_key);
  END IF;
END $$;
