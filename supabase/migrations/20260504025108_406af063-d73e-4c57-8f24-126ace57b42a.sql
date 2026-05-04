
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS inventory_adjustment_approval_threshold numeric(18,2) NOT NULL DEFAULT 10000;

INSERT INTO public.accounts (tenant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active)
SELECT t.id, '5200', 'Inventory Adjustments', 'Expense', 'Operating Expense', 'debit', true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts a WHERE a.tenant_id = t.id AND a.account_code = '5200'
);

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  adjustment_number text,
  adjustment_date date NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id uuid REFERENCES public.warehouses(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('count','writeoff','writeup','damage','loss','found')),
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','posted','rejected','cancelled')),
  total_value numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, adjustment_number)
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_tenant ON public.stock_adjustments(tenant_id, adjustment_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_adj_status ON public.stock_adjustments(tenant_id, status);

CREATE TABLE IF NOT EXISTS public.stock_adjustment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  adjustment_id uuid NOT NULL REFERENCES public.stock_adjustments(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  qty_delta numeric(18,4) NOT NULL,
  unit_cost numeric(18,6) NOT NULL DEFAULT 0,
  line_value numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_delta <> 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_lines_adj ON public.stock_adjustment_lines(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_lines_item ON public.stock_adjustment_lines(item_id);

CREATE OR REPLACE FUNCTION public.set_adjustment_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF NEW.adjustment_number IS NULL OR NEW.adjustment_number = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(adjustment_number FROM 5) AS int)), 0) + 1
      INTO v_n FROM public.stock_adjustments
      WHERE tenant_id = NEW.tenant_id AND adjustment_number ~ '^ADJ-[0-9]+$';
    NEW.adjustment_number := 'ADJ-' || LPAD(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_adjustment_number ON public.stock_adjustments;
CREATE TRIGGER trg_set_adjustment_number
BEFORE INSERT ON public.stock_adjustments
FOR EACH ROW EXECUTE FUNCTION public.set_adjustment_number();

DROP TRIGGER IF EXISTS trg_stock_adj_updated ON public.stock_adjustments;
CREATE TRIGGER trg_stock_adj_updated
BEFORE UPDATE ON public.stock_adjustments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustment_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_adj_tenant_select" ON public.stock_adjustments;
CREATE POLICY "stock_adj_tenant_select" ON public.stock_adjustments
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "stock_adj_tenant_write" ON public.stock_adjustments;
CREATE POLICY "stock_adj_tenant_write" ON public.stock_adjustments
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "stock_adj_lines_tenant_select" ON public.stock_adjustment_lines;
CREATE POLICY "stock_adj_lines_tenant_select" ON public.stock_adjustment_lines
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "stock_adj_lines_tenant_write" ON public.stock_adjustment_lines;
CREATE POLICY "stock_adj_lines_tenant_write" ON public.stock_adjustment_lines
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.post_stock_adjustment(p_adjustment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_adj stock_adjustments%ROWTYPE;
  v_line RECORD;
  v_item inventory_items%ROWTYPE;
  v_je uuid;
  v_inv_acct uuid; v_adj_acct uuid; v_default_adj uuid;
  v_total_dr numeric(18,2) := 0;
  v_total_cr numeric(18,2) := 0;
  v_qty_abs numeric(18,4);
  v_lot_cost numeric(18,6);
  v_warehouse uuid;
  v_lot_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id = p_adjustment_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF v_adj.status NOT IN ('draft','pending_approval') THEN
    RAISE EXCEPTION 'Adjustment % is not in a postable state (status=%)', v_adj.adjustment_number, v_adj.status;
  END IF;
  IF public.is_period_closed(v_tenant, v_adj.adjustment_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_adj.adjustment_date;
  END IF;

  SELECT id INTO v_default_adj FROM public.accounts
   WHERE tenant_id = v_tenant AND account_code = '5200' LIMIT 1;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_adj.adjustment_date,
    'Stock Adjustment ' || v_adj.adjustment_number || ' - ' || COALESCE(v_adj.reason,''),
    v_adj.adjustment_number, 'posted', now(), v_user,
    'stock_adjustment', v_adj.id, true, 'stock_adjustment')
  RETURNING id INTO v_je;

  FOR v_line IN
    SELECT * FROM public.stock_adjustment_lines WHERE adjustment_id = p_adjustment_id ORDER BY created_at
  LOOP
    SELECT * INTO v_item FROM public.inventory_items WHERE id = v_line.item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found for line'; END IF;

    v_inv_acct := v_item.account_id;
    v_adj_acct := COALESCE(v_item.adjustment_account_id, v_default_adj);
    IF v_inv_acct IS NULL THEN
      RAISE EXCEPTION 'Item "%" missing inventory account', v_item.item_name;
    END IF;
    IF v_adj_acct IS NULL THEN
      RAISE EXCEPTION 'Item "%" missing adjustment account and default 5200 not configured', v_item.item_name;
    END IF;

    v_warehouse := COALESCE(v_line.warehouse_id, v_adj.warehouse_id);
    v_qty_abs := abs(v_line.qty_delta);

    INSERT INTO public.stock_movements(
      tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, notes, movement_date
    ) VALUES (
      v_tenant, v_line.item_id, v_warehouse,
      CASE WHEN v_line.qty_delta < 0 THEN 'adjustment_out' ELSE 'adjustment_in' END,
      v_line.qty_delta, v_line.unit_cost,
      'stock_adjustment', v_adj.id, v_line.notes, v_adj.adjustment_date
    );

    IF v_line.qty_delta < 0 THEN
      IF v_item.valuation_method = 'fifo' THEN
        SELECT public.consume_inventory_fifo(v_line.item_id, v_qty_abs, 'stock_adjustment', v_adj.id)
          INTO v_lot_cost;
      ELSE
        v_lot_cost := round(v_qty_abs * COALESCE(v_item.unit_cost,0), 2);
      END IF;

      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
        VALUES (v_je, v_adj_acct, v_lot_cost, 0);
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
        VALUES (v_je, v_inv_acct, 0, v_lot_cost);
      v_total_dr := v_total_dr + v_lot_cost;
      v_total_cr := v_total_cr + v_lot_cost;
    ELSE
      v_lot_cost := round(v_qty_abs * COALESCE(v_line.unit_cost,0), 2);
      IF v_item.valuation_method = 'fifo' THEN
        INSERT INTO public.stock_lots(
          tenant_id, item_id, warehouse_id, lot_number, qty_received, qty_remaining,
          unit_cost, receipt_date, source_type, source_id
        ) VALUES (
          v_tenant, v_line.item_id, v_warehouse,
          public.generate_lot_number(v_tenant, v_line.item_id),
          v_qty_abs, v_qty_abs, v_line.unit_cost, v_adj.adjustment_date,
          'stock_adjustment', v_adj.id
        ) RETURNING id INTO v_lot_id;
      END IF;
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
        VALUES (v_je, v_inv_acct, v_lot_cost, 0);
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
        VALUES (v_je, v_adj_acct, 0, v_lot_cost);
      v_total_dr := v_total_dr + v_lot_cost;
      v_total_cr := v_total_cr + v_lot_cost;

      IF v_item.valuation_method = 'wac' THEN
        UPDATE public.inventory_items SET
          unit_cost = CASE
            WHEN COALESCE(quantity_on_hand,0) + v_qty_abs <= 0 THEN v_line.unit_cost
            ELSE round(((COALESCE(quantity_on_hand,0) * COALESCE(unit_cost,0)) + (v_qty_abs * v_line.unit_cost))
                       / (COALESCE(quantity_on_hand,0) + v_qty_abs), 6)
          END
        WHERE id = v_line.item_id;
      END IF;
    END IF;
  END LOOP;

  IF abs(v_total_dr - v_total_cr) > 0.005 THEN
    RAISE EXCEPTION 'Adjustment JE out of balance: Dr=% Cr=%', v_total_dr, v_total_cr;
  END IF;

  UPDATE public.stock_adjustments
    SET status = 'posted', total_value = v_total_dr, journal_entry_id = v_je, updated_at = now()
    WHERE id = p_adjustment_id;

  RETURN jsonb_build_object('ok', true, 'journal_id', v_je, 'total_value', v_total_dr);
END $$;

CREATE OR REPLACE FUNCTION public.submit_stock_adjustment(p_adjustment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_adj stock_adjustments%ROWTYPE;
  v_total numeric(18,2) := 0;
  v_threshold numeric(18,2);
  v_lines_count int;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id = p_adjustment_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF v_adj.status <> 'draft' THEN RAISE EXCEPTION 'Only draft adjustments can be submitted'; END IF;

  SELECT COUNT(*), COALESCE(SUM(abs(qty_delta) * unit_cost),0)
    INTO v_lines_count, v_total
    FROM public.stock_adjustment_lines WHERE adjustment_id = p_adjustment_id;
  IF v_lines_count = 0 THEN RAISE EXCEPTION 'Adjustment must have at least one line'; END IF;

  SELECT COALESCE(inventory_adjustment_approval_threshold, 10000) INTO v_threshold
    FROM public.account_settings WHERE tenant_id = v_tenant LIMIT 1;
  v_threshold := COALESCE(v_threshold, 10000);

  UPDATE public.stock_adjustments
    SET total_value = v_total,
        submitted_by = v_user,
        submitted_at = now()
    WHERE id = p_adjustment_id;

  IF v_total <= v_threshold THEN
    UPDATE public.stock_adjustments
      SET approved_by = v_user, approved_at = now()
      WHERE id = p_adjustment_id;
    RETURN public.post_stock_adjustment(p_adjustment_id);
  ELSE
    UPDATE public.stock_adjustments SET status = 'pending_approval' WHERE id = p_adjustment_id;
    RETURN jsonb_build_object('ok', true, 'status', 'pending_approval', 'total_value', v_total, 'threshold', v_threshold);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_stock_adjustment(p_adjustment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_tenant uuid; v_adj stock_adjustments%ROWTYPE;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_primary_admin()) THEN
    RAISE EXCEPTION 'Only Primary or Super Admin can approve stock adjustments';
  END IF;

  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id = p_adjustment_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF v_adj.status <> 'pending_approval' THEN RAISE EXCEPTION 'Adjustment not pending approval'; END IF;

  UPDATE public.stock_adjustments
    SET approved_by = v_user, approved_at = now()
    WHERE id = p_adjustment_id;

  RETURN public.post_stock_adjustment(p_adjustment_id);
END $$;

CREATE OR REPLACE FUNCTION public.reject_stock_adjustment(p_adjustment_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_tenant uuid;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_super_admin() OR public.is_primary_admin()) THEN
    RAISE EXCEPTION 'Only Primary or Super Admin can reject';
  END IF;
  UPDATE public.stock_adjustments
    SET status = 'rejected', rejection_reason = p_reason, approved_by = v_user, approved_at = now()
    WHERE id = p_adjustment_id AND tenant_id = v_tenant AND status = 'pending_approval';
  RETURN jsonb_build_object('ok', true);
END $$;
