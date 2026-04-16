
-- 1. Drop stored total_value from inventory_items (architectural violation)
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS total_value;

-- 2. Drop stored net_book_value from fixed_assets (must be computed as cost - accumulated_depreciation)
ALTER TABLE public.fixed_assets DROP COLUMN IF EXISTS net_book_value;

-- 3. Create stock_movements event table (immutable event log for inventory)
CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL DEFAULT 'adjustment',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  reference_type TEXT,
  reference_id UUID,
  notes TEXT,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: movement_type must be valid
ALTER TABLE public.stock_movements 
  ADD CONSTRAINT chk_movement_type 
  CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'return', 'transfer', 'opening'));

-- Indexes for performance
CREATE INDEX idx_stock_movements_item ON public.stock_movements(item_id);
CREATE INDEX idx_stock_movements_tenant ON public.stock_movements(tenant_id);
CREATE INDEX idx_stock_movements_date ON public.stock_movements(movement_date);
CREATE INDEX idx_stock_movements_ref ON public.stock_movements(reference_type, reference_id);

-- Enable RLS
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can manage stock movements"
  ON public.stock_movements FOR ALL
  TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view own tenant stock movements"
  ON public.stock_movements FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());
