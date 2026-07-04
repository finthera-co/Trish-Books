-- ─────────────────────────────────────────────────────────────────────────────
-- Customer deposits / advance receipts (unapplied cash)
--
-- Money received before an invoice exists is a liability (Customer Advances).
--   Record:  Dr Bank            / Cr Customer Advances
--   Apply:   Dr Customer Advances / Cr Accounts Receivable  (settles an invoice)
-- The unapplied balance = amount − applied_amount sits as a per-customer liability.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS customer_advance_account_id UUID REFERENCES public.accounts(id);
COMMENT ON COLUMN public.account_settings.customer_advance_account_id IS
  'Liability account credited when a customer pays in advance (Customer Advances / Unearned).';

CREATE TABLE IF NOT EXISTS public.customer_deposits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  deposit_date      DATE NOT NULL DEFAULT current_date,
  amount            NUMERIC NOT NULL CHECK (amount > 0),
  applied_amount    NUMERIC NOT NULL DEFAULT 0 CHECK (applied_amount >= 0),
  bank_account_id   UUID REFERENCES public.accounts(id),
  advance_account_id UUID REFERENCES public.accounts(id),
  payment_method    TEXT,
  reference         TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'unapplied' CHECK (status IN ('unapplied','partially_applied','applied')),
  journal_entry_id  UUID REFERENCES public.journal_entries(id),
  created_by        UUID REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_deposits_cust ON public.customer_deposits (tenant_id, customer_id, status);

CREATE TABLE IF NOT EXISTS public.deposit_applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  deposit_id        UUID NOT NULL REFERENCES public.customer_deposits(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount            NUMERIC NOT NULL CHECK (amount > 0),
  applied_date      DATE NOT NULL DEFAULT current_date,
  journal_entry_id  UUID REFERENCES public.journal_entries(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_apps_deposit ON public.deposit_applications (deposit_id);
CREATE INDEX IF NOT EXISTS idx_deposit_apps_invoice ON public.deposit_applications (invoice_id);

ALTER TABLE public.customer_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_deposits_rw ON public.customer_deposits;
CREATE POLICY customer_deposits_rw ON public.customer_deposits
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS deposit_applications_rw ON public.deposit_applications;
CREATE POLICY deposit_applications_rw ON public.deposit_applications
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_deposits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposit_applications TO authenticated;
