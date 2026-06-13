-- Enforce a single system Opening Balance Equity account (code 3900) per tenant.
-- Guards against duplicate OBE rows under RLS and concurrent provisioning, where
-- the edge function, the useEnsureOBEAccount hook, and ensureOBEAccount in
-- useOpeningBalanceSettings.ts may all race to create it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_obe_per_tenant
  ON public.accounts (tenant_id)
  WHERE is_system = true AND account_code = '3900';
