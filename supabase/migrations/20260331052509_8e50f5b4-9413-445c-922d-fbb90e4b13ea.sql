
-- Add credit_limit and payment_terms to customers
ALTER TABLE public.customers 
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'net_30';

-- Add journal_entry_id to invoices for GL linking
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS ar_account_id uuid REFERENCES public.accounts(id);

-- Add journal_entry_id to payments_received for GL linking
ALTER TABLE public.payments_received
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS ar_account_id uuid REFERENCES public.accounts(id);

-- AR Credit Notes table
CREATE TABLE IF NOT EXISTS public.ar_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  credit_note_number text NOT NULL,
  credit_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  ar_account_id uuid REFERENCES public.accounts(id),
  revenue_account_id uuid REFERENCES public.accounts(id),
  invoice_id uuid REFERENCES public.invoices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ar_credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage ar_credit_notes"
  ON public.ar_credit_notes FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view own tenant ar_credit_notes"
  ON public.ar_credit_notes FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());
