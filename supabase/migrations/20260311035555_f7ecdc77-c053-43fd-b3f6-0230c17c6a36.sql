
-- Create account_categories table
CREATE TABLE public.account_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_type text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant account categories"
  ON public.account_categories FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage account categories"
  ON public.account_categories FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- Add category_id and is_active to accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.account_categories(id),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Unique constraint on account_code per tenant
CREATE UNIQUE INDEX IF NOT EXISTS accounts_tenant_code_unique ON public.accounts(tenant_id, account_code);
