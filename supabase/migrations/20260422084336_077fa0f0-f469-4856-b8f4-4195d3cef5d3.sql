-- Enable trigram extension for fast ILIKE / partial matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for case-insensitive partial search
CREATE INDEX IF NOT EXISTS idx_accounts_code_trgm
  ON public.accounts USING gin (account_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_accounts_name_trgm
  ON public.accounts USING gin (account_name gin_trgm_ops);

-- Composite index for the common tenant + active filter
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_active
  ON public.accounts (tenant_id, is_active);
