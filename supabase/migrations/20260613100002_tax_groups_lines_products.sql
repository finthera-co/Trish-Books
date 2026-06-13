-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 2: tax groups (compound/stacked), document
-- line tax columns, product default tax linkage.
-- SL driver: VAT base includes SSCL (VAT 18% on line + SSCL 2.5%).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.tax_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_group_id uuid NOT NULL REFERENCES public.tax_groups(id) ON DELETE CASCADE,
  tax_code_id uuid NOT NULL REFERENCES public.tax_codes(id),
  apply_order int NOT NULL,                            -- SSCL 1, VAT 2
  compound_on_previous boolean NOT NULL DEFAULT false, -- true on the VAT member
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_group_id, tax_code_id)
);
CREATE INDEX IF NOT EXISTS idx_tgm_group ON public.tax_group_members(tax_group_id, apply_order);

-- Deferred FK from migration 1
ALTER TABLE public.tenant_tax_profiles
  DROP CONSTRAINT IF EXISTS ttp_default_sales_tax_group_fk;
ALTER TABLE public.tenant_tax_profiles
  ADD CONSTRAINT ttp_default_sales_tax_group_fk
  FOREIGN KEY (default_sales_tax_group_id) REFERENCES public.tax_groups(id);

-- ── Document lines: per-line tax resolution ──────────────────────────
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS tax_group_id uuid REFERENCES public.tax_groups(id),
  ADD COLUMN IF NOT EXISTS tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_amount_line numeric(18,2) NOT NULL DEFAULT 0,
  -- raw line discount so posting can recompute tax deterministically from
  -- qty * unit_price - discount (legacy UI folded discounts into `total`)
  ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_tax_one_of;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_tax_one_of
  CHECK (tax_group_id IS NULL OR tax_code_id IS NULL);

ALTER TABLE public.supplier_bill_lines
  ADD COLUMN IF NOT EXISTS tax_group_id uuid REFERENCES public.tax_groups(id),
  ADD COLUMN IF NOT EXISTS tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_amount_line numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.supplier_bill_lines DROP CONSTRAINT IF EXISTS sbl_tax_one_of;
ALTER TABLE public.supplier_bill_lines ADD CONSTRAINT sbl_tax_one_of
  CHECK (tax_group_id IS NULL OR tax_code_id IS NULL);

-- ── Products: new default tax linkage (legacy products.tax_id is kept
--    untouched but no longer read by new code; backfilled in the
--    legacy-data migration once LEGACY tax codes exist) ───────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_tax_group_id uuid REFERENCES public.tax_groups(id),
  ADD COLUMN IF NOT EXISTS default_tax_code_id uuid REFERENCES public.tax_codes(id);

DROP TRIGGER IF EXISTS trg_tax_groups_updated ON public.tax_groups;
CREATE TRIGGER trg_tax_groups_updated BEFORE UPDATE ON public.tax_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.tax_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tax_groups_select" ON public.tax_groups;
CREATE POLICY "tax_groups_select" ON public.tax_groups FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tax_groups_all" ON public.tax_groups;
CREATE POLICY "tax_groups_all" ON public.tax_groups FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tgm_select" ON public.tax_group_members;
CREATE POLICY "tgm_select" ON public.tax_group_members FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tgm_all" ON public.tax_group_members;
CREATE POLICY "tgm_all" ON public.tax_group_members FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
