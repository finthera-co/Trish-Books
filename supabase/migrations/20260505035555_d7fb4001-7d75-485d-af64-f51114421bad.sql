
-- Add weight column to inventory_items for weight-based allocation
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS weight numeric(18,4) DEFAULT 0;

-- Seed missing accounts (1340 Goods in Transit, 2160 Landed Cost Clearing)
INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active)
SELECT t.id, '1340', 'Goods In Transit', 'Asset', 'Current Assets', 'debit', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id = t.id AND a.account_code = '1340');

INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active)
SELECT t.id, '2160', 'Landed Cost Clearing', 'Liability', 'Current Liabilities', 'credit', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id = t.id AND a.account_code = '2160');

-- Landed Cost Vouchers
CREATE TABLE IF NOT EXISTS public.landed_cost_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  voucher_number text NOT NULL,
  voucher_date date NOT NULL DEFAULT CURRENT_DATE,
  allocation_method text NOT NULL DEFAULT 'value' CHECK (allocation_method IN ('value','qty','weight')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  total_charges numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, voucher_number)
);

-- GRN linkage (many-to-many: a voucher can cover multiple GRNs)
CREATE TABLE IF NOT EXISTS public.landed_cost_voucher_grns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  voucher_id uuid NOT NULL REFERENCES public.landed_cost_vouchers(id) ON DELETE CASCADE,
  grn_id uuid NOT NULL REFERENCES public.goods_receipt_notes(id),
  UNIQUE (voucher_id, grn_id)
);

-- Charges (each is a cost line: e.g. Freight 500, Customs 200)
CREATE TABLE IF NOT EXISTS public.landed_cost_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  voucher_id uuid NOT NULL REFERENCES public.landed_cost_vouchers(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  offset_account_id uuid NOT NULL REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allocation rows (created on post)
CREATE TABLE IF NOT EXISTS public.landed_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  voucher_id uuid NOT NULL REFERENCES public.landed_cost_vouchers(id) ON DELETE CASCADE,
  grn_line_id uuid NOT NULL REFERENCES public.grn_lines(id),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  allocated_amount numeric(18,2) NOT NULL,
  basis_value numeric(18,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lcv_tenant ON public.landed_cost_vouchers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lcv_grns_voucher ON public.landed_cost_voucher_grns(voucher_id);
CREATE INDEX IF NOT EXISTS idx_lcc_voucher ON public.landed_cost_charges(voucher_id);
CREATE INDEX IF NOT EXISTS idx_lca_voucher ON public.landed_cost_allocations(voucher_id);

-- RLS
ALTER TABLE public.landed_cost_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landed_cost_voucher_grns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landed_cost_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landed_cost_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY lcv_select ON public.landed_cost_vouchers FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY lcv_insert ON public.landed_cost_vouchers FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lcv_update ON public.landed_cost_vouchers FOR UPDATE USING (tenant_id = get_user_tenant_id() AND status = 'draft');
CREATE POLICY lcv_delete ON public.landed_cost_vouchers FOR DELETE USING (tenant_id = get_user_tenant_id() AND status = 'draft');

CREATE POLICY lcvg_all ON public.landed_cost_voucher_grns FOR ALL USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lcc_all ON public.landed_cost_charges FOR ALL USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lca_select ON public.landed_cost_allocations FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Voucher number generator
CREATE OR REPLACE FUNCTION public.set_lcv_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF NEW.voucher_number IS NULL OR NEW.voucher_number = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM 5) AS int)), 0) + 1
      INTO v_n FROM public.landed_cost_vouchers
      WHERE tenant_id = NEW.tenant_id AND voucher_number ~ '^LCV-[0-9]+$';
    NEW.voucher_number := 'LCV-' || LPAD(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_lcv_number ON public.landed_cost_vouchers;
CREATE TRIGGER trg_set_lcv_number BEFORE INSERT ON public.landed_cost_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.set_lcv_number();

DROP TRIGGER IF EXISTS trg_lcv_updated_at ON public.landed_cost_vouchers;
CREATE TRIGGER trg_lcv_updated_at BEFORE UPDATE ON public.landed_cost_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ────────────────────────────────────────────────────────────────────────────
-- Posting RPC: post_landed_cost_voucher
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_landed_cost_voucher(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_v landed_cost_vouchers%ROWTYPE;
  v_total_charges numeric(18,2) := 0;
  v_total_basis numeric(18,4) := 0;
  v_je uuid;
  v_grn_line RECORD;
  v_charge RECORD;
  v_item inventory_items%ROWTYPE;
  v_alloc numeric(18,2);
  v_dr_total numeric(18,2) := 0;
  v_cr_total numeric(18,2) := 0;
  v_basis numeric(18,4);
  v_allocated_sum numeric(18,2) := 0;
  v_grn_lines_count int := 0;
  v_last_grn_line uuid;
  v_diff numeric(18,2);
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_v FROM public.landed_cost_vouchers WHERE id = p_voucher_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voucher not found'; END IF;
  IF v_v.status <> 'draft' THEN RAISE EXCEPTION 'Only draft vouchers can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_v.voucher_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_v.voucher_date;
  END IF;

  -- Sum charges
  SELECT COALESCE(SUM(amount), 0) INTO v_total_charges
    FROM public.landed_cost_charges WHERE voucher_id = p_voucher_id;
  IF v_total_charges <= 0 THEN RAISE EXCEPTION 'Voucher has no charges'; END IF;

  -- Compute total basis across all linked GRN lines
  IF v_v.allocation_method = 'value' THEN
    SELECT COALESCE(SUM(gl.line_total), 0)
      INTO v_total_basis
      FROM public.grn_lines gl
      JOIN public.landed_cost_voucher_grns g ON g.grn_id = gl.grn_id
      WHERE g.voucher_id = p_voucher_id;
  ELSIF v_v.allocation_method = 'qty' THEN
    SELECT COALESCE(SUM(gl.qty_received), 0)
      INTO v_total_basis
      FROM public.grn_lines gl
      JOIN public.landed_cost_voucher_grns g ON g.grn_id = gl.grn_id
      WHERE g.voucher_id = p_voucher_id;
  ELSE -- weight
    SELECT COALESCE(SUM(gl.qty_received * COALESCE(it.weight,0)), 0)
      INTO v_total_basis
      FROM public.grn_lines gl
      JOIN public.inventory_items it ON it.id = gl.item_id
      JOIN public.landed_cost_voucher_grns g ON g.grn_id = gl.grn_id
      WHERE g.voucher_id = p_voucher_id;
  END IF;

  IF v_total_basis <= 0 THEN
    RAISE EXCEPTION 'Allocation basis total is zero — cannot allocate landed costs (check % values).', v_v.allocation_method;
  END IF;

  -- Create JE header
  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_v.voucher_date,
    'Landed Cost Voucher ' || v_v.voucher_number,
    v_v.voucher_number, 'posted', now(), v_user,
    'landed_cost_voucher', v_v.id, true, 'landed_cost_voucher')
  RETURNING id INTO v_je;

  -- Clear any prior allocations (for re-runs in case of rollback)
  DELETE FROM public.landed_cost_allocations WHERE voucher_id = p_voucher_id;

  -- Iterate GRN lines, allocate proportionally, debit each item's inventory account
  FOR v_grn_line IN
    SELECT gl.id, gl.item_id, gl.qty_received, gl.line_total, gl.warehouse_id, gl.unit_cost AS grn_unit_cost
    FROM public.grn_lines gl
    JOIN public.landed_cost_voucher_grns g ON g.grn_id = gl.grn_id
    WHERE g.voucher_id = p_voucher_id
    ORDER BY gl.created_at
  LOOP
    v_grn_lines_count := v_grn_lines_count + 1;
    v_last_grn_line := v_grn_line.id;

    SELECT * INTO v_item FROM public.inventory_items WHERE id = v_grn_line.item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item missing for GRN line'; END IF;
    IF v_item.account_id IS NULL THEN
      RAISE EXCEPTION 'Item "%" missing inventory account', v_item.item_name;
    END IF;

    IF v_v.allocation_method = 'value' THEN
      v_basis := v_grn_line.line_total;
    ELSIF v_v.allocation_method = 'qty' THEN
      v_basis := v_grn_line.qty_received;
    ELSE
      v_basis := v_grn_line.qty_received * COALESCE(v_item.weight, 0);
    END IF;

    v_alloc := round((v_basis / v_total_basis) * v_total_charges, 2);
    v_allocated_sum := v_allocated_sum + v_alloc;

    INSERT INTO public.landed_cost_allocations(tenant_id, voucher_id, grn_line_id, item_id, allocated_amount, basis_value)
    VALUES (v_tenant, p_voucher_id, v_grn_line.id, v_grn_line.item_id, v_alloc, v_basis);

    IF v_alloc > 0 THEN
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
        VALUES (v_je, v_item.account_id, v_alloc, 0);
      v_dr_total := v_dr_total + v_alloc;

      -- Cost uplift on FIFO lot (most recent lot for that GRN line/item) or WAC recompute
      IF v_item.valuation_method = 'fifo' THEN
        UPDATE public.stock_lots
          SET unit_cost = unit_cost + (v_alloc / NULLIF(qty_received,0))
          WHERE id = (
            SELECT id FROM public.stock_lots
            WHERE item_id = v_grn_line.item_id
              AND source_type = 'grn_line' AND source_id = v_grn_line.id
            ORDER BY created_at DESC LIMIT 1
          );
      ELSE
        -- WAC: increase moving avg by allocated cost across current on-hand
        UPDATE public.inventory_items
          SET unit_cost = CASE
              WHEN COALESCE(quantity_on_hand,0) <= 0 THEN COALESCE(unit_cost,0)
              ELSE round(COALESCE(unit_cost,0) + (v_alloc / quantity_on_hand), 6)
            END
          WHERE id = v_grn_line.item_id;
      END IF;
    END IF;
  END LOOP;

  IF v_grn_lines_count = 0 THEN
    RAISE EXCEPTION 'Voucher must reference at least one GRN with lines';
  END IF;

  -- Rounding correction: any leftover penny goes to last line
  v_diff := round(v_total_charges - v_allocated_sum, 2);
  IF v_diff <> 0 AND v_last_grn_line IS NOT NULL THEN
    UPDATE public.landed_cost_allocations
      SET allocated_amount = allocated_amount + v_diff
      WHERE voucher_id = p_voucher_id AND grn_line_id = v_last_grn_line;
    -- Adjust the corresponding journal line for the last item
    SELECT item_id INTO v_grn_line FROM public.landed_cost_allocations
      WHERE voucher_id = p_voucher_id AND grn_line_id = v_last_grn_line LIMIT 1;
    SELECT * INTO v_item FROM public.inventory_items WHERE id = v_grn_line.item_id;
    IF v_diff > 0 THEN
      UPDATE public.journal_lines
        SET debit = debit + v_diff
        WHERE journal_entry_id = v_je AND account_id = v_item.account_id
          AND ctid = (SELECT ctid FROM public.journal_lines
                      WHERE journal_entry_id = v_je AND account_id = v_item.account_id
                      ORDER BY ctid DESC LIMIT 1);
    ELSE
      UPDATE public.journal_lines
        SET debit = debit + v_diff
        WHERE journal_entry_id = v_je AND account_id = v_item.account_id
          AND ctid = (SELECT ctid FROM public.journal_lines
                      WHERE journal_entry_id = v_je AND account_id = v_item.account_id
                      ORDER BY ctid DESC LIMIT 1);
    END IF;
    v_dr_total := v_dr_total + v_diff;
  END IF;

  -- Credit each charge to its offset account
  FOR v_charge IN
    SELECT * FROM public.landed_cost_charges WHERE voucher_id = p_voucher_id
  LOOP
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
      VALUES (v_je, v_charge.offset_account_id, 0, v_charge.amount);
    v_cr_total := v_cr_total + v_charge.amount;
  END LOOP;

  IF abs(v_dr_total - v_cr_total) > 0.01 THEN
    RAISE EXCEPTION 'Landed cost JE out of balance: Dr=% Cr=%', v_dr_total, v_cr_total;
  END IF;

  UPDATE public.landed_cost_vouchers
    SET status = 'posted', posted_at = now(), journal_entry_id = v_je, total_charges = v_total_charges
    WHERE id = p_voucher_id;

  RETURN jsonb_build_object('ok', true, 'journal_id', v_je, 'total_charges', v_total_charges, 'lines_allocated', v_grn_lines_count);
END $$;
