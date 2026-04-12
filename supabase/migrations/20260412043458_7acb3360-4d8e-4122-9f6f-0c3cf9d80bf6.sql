
-- 1. Asset Categories — the accounting rules engine
CREATE TABLE public.asset_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  asset_account_id uuid REFERENCES public.accounts(id),
  accumulated_depreciation_account_id uuid REFERENCES public.accounts(id),
  depreciation_expense_account_id uuid REFERENCES public.accounts(id),
  disposal_gain_account_id uuid REFERENCES public.accounts(id),
  disposal_loss_account_id uuid REFERENCES public.accounts(id),
  depreciation_method text NOT NULL DEFAULT 'straight_line',
  default_useful_life_months integer NOT NULL DEFAULT 60,
  proration_method text NOT NULL DEFAULT 'full_month',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant asset categories"
  ON public.asset_categories FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage asset categories rules"
  ON public.asset_categories FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE TRIGGER update_asset_categories_updated_at
  BEFORE UPDATE ON public.asset_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add category_id to fixed_assets
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.asset_categories(id);

-- 3. Add status to asset_depreciation for schedule-driven posting
ALTER TABLE public.asset_depreciation
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

-- 4. Add transaction_type to asset_subledger
ALTER TABLE public.asset_subledger
  ADD COLUMN IF NOT EXISTS transaction_type text DEFAULT 'acquisition';
