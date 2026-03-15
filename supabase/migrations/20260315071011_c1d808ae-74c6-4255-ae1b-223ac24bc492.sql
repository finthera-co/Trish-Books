
-- Payment Vouchers table
CREATE TABLE public.payment_vouchers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_number TEXT NOT NULL,
  account_number TEXT,
  cheque_number TEXT,
  payee_id UUID REFERENCES public.customers(id),
  payment_account_id UUID REFERENCES public.accounts(id) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  reference_number TEXT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  memo TEXT,
  bills_attached INTEGER DEFAULT 0,
  approved_by TEXT,
  accountant TEXT,
  checked_by TEXT,
  made_by TEXT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  status TEXT NOT NULL DEFAULT 'draft',
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, voucher_number)
);

-- Payment Voucher Lines table
CREATE TABLE public.payment_voucher_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id UUID NOT NULL REFERENCES public.payment_vouchers(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  description TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payment_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_voucher_lines ENABLE ROW LEVEL SECURITY;

-- RLS for payment_vouchers
CREATE POLICY "Users can view own tenant payment vouchers"
  ON public.payment_vouchers FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage payment vouchers"
  ON public.payment_vouchers FOR ALL
  TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- RLS for payment_voucher_lines
CREATE POLICY "Users can view own tenant payment voucher lines"
  ON public.payment_voucher_lines FOR SELECT
  TO authenticated
  USING (voucher_id IN (SELECT id FROM public.payment_vouchers WHERE tenant_id = get_user_tenant_id()) OR is_super_admin());

CREATE POLICY "Authorized users can manage payment voucher lines"
  ON public.payment_voucher_lines FOR ALL
  TO authenticated
  USING (voucher_id IN (SELECT id FROM public.payment_vouchers WHERE tenant_id = get_user_tenant_id()));

-- Auto-update updated_at
CREATE TRIGGER update_payment_vouchers_updated_at
  BEFORE UPDATE ON public.payment_vouchers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sequence function for voucher numbers
CREATE OR REPLACE FUNCTION public.generate_voucher_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'PV-' || LPAD((COALESCE(
    (SELECT COUNT(*)::int + 1 FROM public.payment_vouchers WHERE tenant_id = p_tenant_id),
    1
  ))::text, 5, '0');
$$;
