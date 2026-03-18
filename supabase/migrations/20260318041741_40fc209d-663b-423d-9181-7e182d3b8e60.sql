
-- Drop old petty cash tables (detach, don't delete journal entries)
DROP TABLE IF EXISTS public.petty_cash_transactions CASCADE;
DROP TABLE IF EXISTS public.petty_cash_accounts CASCADE;

-- 2.1 Petty Cash Account Setup
CREATE TABLE public.petty_cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  account_name TEXT NOT NULL,
  float_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.petty_cash_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant pc accounts" ON public.petty_cash_accounts
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage pc accounts" ON public.petty_cash_accounts
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- 2.2 Petty Cash Vouchers
CREATE TABLE public.petty_cash_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  voucher_number TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  paid_to TEXT,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  petty_cash_account_id UUID NOT NULL REFERENCES public.petty_cash_accounts(id),
  prepared_by UUID REFERENCES public.users(id),
  authorized_by UUID REFERENCES public.users(id),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, voucher_number)
);

ALTER TABLE public.petty_cash_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant pc vouchers" ON public.petty_cash_vouchers
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage pc vouchers" ON public.petty_cash_vouchers
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- 2.3 Voucher Lines
CREATE TABLE public.petty_cash_voucher_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.petty_cash_vouchers(id) ON DELETE CASCADE,
  line_no INT NOT NULL DEFAULT 1,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

ALTER TABLE public.petty_cash_voucher_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant pc voucher lines" ON public.petty_cash_voucher_lines
  FOR SELECT TO authenticated USING (
    voucher_id IN (SELECT id FROM public.petty_cash_vouchers WHERE tenant_id = get_user_tenant_id()) OR is_super_admin()
  );

CREATE POLICY "Authorized users can manage pc voucher lines" ON public.petty_cash_voucher_lines
  FOR ALL TO authenticated USING (
    voucher_id IN (SELECT id FROM public.petty_cash_vouchers WHERE tenant_id = get_user_tenant_id())
  );

-- 2.4 Replenishments (Imprest)
CREATE TABLE public.petty_cash_replenishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  replenishment_number TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  petty_cash_account_id UUID NOT NULL REFERENCES public.petty_cash_accounts(id),
  bank_account_id UUID NOT NULL REFERENCES public.accounts(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, replenishment_number)
);

ALTER TABLE public.petty_cash_replenishments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant pc replenishments" ON public.petty_cash_replenishments
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage pc replenishments" ON public.petty_cash_replenishments
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- Voucher numbering function
CREATE OR REPLACE FUNCTION public.generate_pcv_number(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'PCV-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || LPAD((COALESCE(
    (SELECT COUNT(*)::int + 1 FROM public.petty_cash_vouchers 
     WHERE tenant_id = p_tenant_id 
     AND voucher_number LIKE 'PCV-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-%'),
    1
  ))::text, 4, '0');
$$;

-- Replenishment numbering function
CREATE OR REPLACE FUNCTION public.generate_pcr_number(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'PCR-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || LPAD((COALESCE(
    (SELECT COUNT(*)::int + 1 FROM public.petty_cash_replenishments 
     WHERE tenant_id = p_tenant_id 
     AND replenishment_number LIKE 'PCR-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-%'),
    1
  ))::text, 4, '0');
$$;
