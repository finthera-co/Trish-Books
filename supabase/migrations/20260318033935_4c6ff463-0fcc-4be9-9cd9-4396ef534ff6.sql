
-- Add missing columns to fixed_assets
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS salvage_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS useful_life_months integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS depreciation_method text NOT NULL DEFAULT 'straight_line',
  ADD COLUMN IF NOT EXISTS start_date date;

-- Update start_date to acquisition_date where null
UPDATE public.fixed_assets SET start_date = acquisition_date WHERE start_date IS NULL AND acquisition_date IS NOT NULL;

-- Asset depreciation records
CREATE TABLE IF NOT EXISTS public.asset_depreciation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period text NOT NULL,
  depreciation_amount numeric NOT NULL DEFAULT 0,
  accumulated_depreciation numeric NOT NULL DEFAULT 0,
  net_book_value numeric NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id, period)
);

ALTER TABLE public.asset_depreciation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant asset depreciation"
  ON public.asset_depreciation FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage asset depreciation"
  ON public.asset_depreciation FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Asset disposals
CREATE TABLE IF NOT EXISTS public.asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  disposal_date date NOT NULL DEFAULT CURRENT_DATE,
  sale_value numeric NOT NULL DEFAULT 0,
  gain_loss numeric NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.asset_disposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant asset disposals"
  ON public.asset_disposals FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage asset disposals"
  ON public.asset_disposals FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());
