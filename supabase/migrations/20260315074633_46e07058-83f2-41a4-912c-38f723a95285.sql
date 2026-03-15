
-- Bank Reconciliations
CREATE TABLE public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  beginning_balance numeric NOT NULL DEFAULT 0,
  statement_ending_balance numeric NOT NULL DEFAULT 0,
  cleared_balance numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  statement_ending_date date NOT NULL,
  service_charges numeric DEFAULT 0,
  interest_earned numeric DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'in_progress',
  reconciled_by uuid REFERENCES public.users(id),
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant reconciliations" ON public.bank_reconciliations
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage reconciliations" ON public.bank_reconciliations
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Reconciliation Transactions
CREATE TABLE public.reconciliation_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  journal_line_id uuid NOT NULL REFERENCES public.journal_lines(id),
  cleared boolean NOT NULL DEFAULT false,
  cleared_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant recon transactions" ON public.reconciliation_transactions
  FOR SELECT TO authenticated
  USING (reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE POLICY "Authorized users can manage recon transactions" ON public.reconciliation_transactions
  FOR ALL TO authenticated
  USING (reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE tenant_id = get_user_tenant_id()));

-- Reconciliation Adjustments
CREATE TABLE public.reconciliation_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  amount numeric NOT NULL DEFAULT 0,
  description text,
  adjustment_type text NOT NULL DEFAULT 'charge',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant recon adjustments" ON public.reconciliation_adjustments
  FOR SELECT TO authenticated
  USING (reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE POLICY "Authorized users can manage recon adjustments" ON public.reconciliation_adjustments
  FOR ALL TO authenticated
  USING (reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE tenant_id = get_user_tenant_id()));

-- Reconciliation Logs
CREATE TABLE public.reconciliation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id),
  action text NOT NULL,
  affected_transaction_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant recon logs" ON public.reconciliation_logs
  FOR SELECT TO authenticated
  USING (reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE POLICY "Authorized users can insert recon logs" ON public.reconciliation_logs
  FOR INSERT TO authenticated
  WITH CHECK (reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE tenant_id = get_user_tenant_id()));

-- Trigger for updated_at
CREATE TRIGGER update_bank_reconciliations_updated_at
  BEFORE UPDATE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
