
-- Bank Feed Transactions table (imported bank statement lines)
CREATE TABLE public.bank_feed_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reconciliation_id uuid REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  transaction_date date NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  reference_number text,
  bank_balance numeric,
  status text NOT NULL DEFAULT 'unmatched',
  matched_journal_line_id uuid REFERENCES public.journal_lines(id),
  match_confidence numeric,
  is_duplicate boolean NOT NULL DEFAULT false,
  duplicate_of uuid REFERENCES public.bank_feed_transactions(id),
  import_batch text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_feed_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant bank feed transactions"
  ON public.bank_feed_transactions FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage bank feed transactions"
  ON public.bank_feed_transactions FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Reconciliation Rules table
CREATE TABLE public.reconciliation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  condition_field text NOT NULL DEFAULT 'description',
  condition_operator text NOT NULL DEFAULT 'contains',
  condition_value text NOT NULL,
  condition_amount_min numeric,
  condition_amount_max numeric,
  action_type text NOT NULL DEFAULT 'auto_match',
  action_account_id uuid REFERENCES public.accounts(id),
  action_create_expense boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant reconciliation rules"
  ON public.reconciliation_rules FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage reconciliation rules"
  ON public.reconciliation_rules FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Add index for performance
CREATE INDEX idx_bank_feed_txns_account ON public.bank_feed_transactions(bank_account_id, transaction_date);
CREATE INDEX idx_bank_feed_txns_status ON public.bank_feed_transactions(status);
CREATE INDEX idx_bank_feed_txns_reconciliation ON public.bank_feed_transactions(reconciliation_id);
