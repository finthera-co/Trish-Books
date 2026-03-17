
-- Vendors table (mirrors customers for AP sub-ledger)
CREATE TABLE public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant vendors"
  ON public.vendors FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage vendors"
  ON public.vendors FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Inventory items table
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  quantity_on_hand NUMERIC NOT NULL DEFAULT 0,
  total_value NUMERIC GENERATED ALWAYS AS (unit_cost * quantity_on_hand) STORED,
  account_id UUID REFERENCES public.accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant inventory items"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage inventory items"
  ON public.inventory_items FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Fixed assets table
CREATE TABLE public.fixed_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_name TEXT NOT NULL,
  description TEXT,
  acquisition_date DATE,
  cost NUMERIC NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC NOT NULL DEFAULT 0,
  net_book_value NUMERIC GENERATED ALWAYS AS (cost - accumulated_depreciation) STORED,
  asset_account_id UUID REFERENCES public.accounts(id),
  depreciation_account_id UUID REFERENCES public.accounts(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant fixed assets"
  ON public.fixed_assets FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage fixed assets"
  ON public.fixed_assets FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Opening balance sub-ledger details (polymorphic: links account OBs to entities)
CREATE TABLE public.opening_balance_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'customer', 'vendor', 'inventory_item', 'fixed_asset'
  entity_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, entity_type, entity_id)
);

ALTER TABLE public.opening_balance_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant OB details"
  ON public.opening_balance_details FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage OB details"
  ON public.opening_balance_details FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Add requires_subledger and opening_balance_enabled to accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS opening_balance_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_subledger BOOLEAN NOT NULL DEFAULT false;

-- Indexes for performance
CREATE INDEX idx_ob_details_account ON public.opening_balance_details(account_id);
CREATE INDEX idx_ob_details_entity ON public.opening_balance_details(entity_type, entity_id);
CREATE INDEX idx_vendors_tenant ON public.vendors(tenant_id);
CREATE INDEX idx_inventory_items_tenant ON public.inventory_items(tenant_id);
CREATE INDEX idx_fixed_assets_tenant ON public.fixed_assets(tenant_id);
