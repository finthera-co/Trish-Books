
-- Add subledger_type to accounts
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS subledger_type text DEFAULT 'none';

-- Add opening_balance to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;

-- Add opening_balance to vendors
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;

-- AR Sub-ledger (journal line → customer)
CREATE TABLE IF NOT EXISTS public.ar_subledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_line_id uuid NOT NULL REFERENCES public.journal_lines(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ar_subledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can manage ar_subledger" ON public.ar_subledger FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can view own tenant ar_subledger" ON public.ar_subledger FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- AP Sub-ledger (journal line → vendor)
CREATE TABLE IF NOT EXISTS public.ap_subledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_line_id uuid NOT NULL REFERENCES public.journal_lines(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ap_subledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can manage ap_subledger" ON public.ap_subledger FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can view own tenant ap_subledger" ON public.ap_subledger FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Inventory Sub-ledger (journal line → inventory item)
CREATE TABLE IF NOT EXISTS public.inventory_subledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_line_id uuid NOT NULL REFERENCES public.journal_lines(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  qty numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_subledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can manage inventory_subledger" ON public.inventory_subledger FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can view own tenant inventory_subledger" ON public.inventory_subledger FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Asset Sub-ledger (journal line → fixed asset)
CREATE TABLE IF NOT EXISTS public.asset_subledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_line_id uuid NOT NULL REFERENCES public.journal_lines(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.asset_subledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can manage asset_subledger" ON public.asset_subledger FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can view own tenant asset_subledger" ON public.asset_subledger FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());
