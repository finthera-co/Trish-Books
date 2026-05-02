-- 0. Drop legacy constraint FIRST
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_valuation_method_chk;

-- 1. Patch validation trigger to only fire on relevant changes
CREATE OR REPLACE FUNCTION public.validate_inventory_item_mappings()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.cogs_account_id IS DISTINCT FROM OLD.cogs_account_id THEN
    IF NEW.is_active THEN
      IF NEW.account_id IS NULL THEN
        RAISE EXCEPTION 'Item must be linked to an Inventory Asset Account in the Chart of Accounts before it can be activated.';
      END IF;
      IF NEW.cogs_account_id IS NULL THEN
        RAISE EXCEPTION 'Item must be linked to a Cost of Goods Sold (COGS) account before it can be activated.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 2. Normalize legacy values
UPDATE public.inventory_items SET valuation_method = 'wac'
  WHERE valuation_method IS NULL OR valuation_method NOT IN ('wac','fifo');

ALTER TABLE public.inventory_items ALTER COLUMN valuation_method SET DEFAULT 'wac';
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_valuation_method_chk CHECK (valuation_method IN ('wac','fifo'));

-- 3. stock_lots
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  lot_number TEXT NOT NULL,
  receipt_date DATE NOT NULL,
  qty_received NUMERIC(18,4) NOT NULL CHECK (qty_received > 0),
  qty_remaining NUMERIC(18,4) NOT NULL CHECK (qty_remaining >= 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost >= 0),
  source_type TEXT NOT NULL DEFAULT 'grn',
  source_id UUID,
  notes TEXT,
  is_exhausted BOOLEAN GENERATED ALWAYS AS (qty_remaining = 0) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_tenant_item ON public.stock_lots(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_fifo_pick ON public.stock_lots(item_id, receipt_date, created_at) WHERE qty_remaining > 0;

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_stock_lots" ON public.stock_lots;
CREATE POLICY "tenant_select_stock_lots" ON public.stock_lots FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tenant_modify_stock_lots" ON public.stock_lots;
CREATE POLICY "tenant_modify_stock_lots" ON public.stock_lots FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP TRIGGER IF EXISTS trg_stock_lots_updated ON public.stock_lots;
CREATE TRIGGER trg_stock_lots_updated BEFORE UPDATE ON public.stock_lots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. stock_lot_consumptions
CREATE TABLE IF NOT EXISTS public.stock_lot_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  movement_id UUID REFERENCES public.stock_movements(id) ON DELETE SET NULL,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  qty_consumed NUMERIC(18,4) NOT NULL CHECK (qty_consumed > 0),
  unit_cost NUMERIC(18,6) NOT NULL,
  consumption_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_type TEXT,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lot_consumptions_lot ON public.stock_lot_consumptions(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_consumptions_item ON public.stock_lot_consumptions(item_id);

ALTER TABLE public.stock_lot_consumptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_lot_cons" ON public.stock_lot_consumptions;
CREATE POLICY "tenant_select_lot_cons" ON public.stock_lot_consumptions FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "tenant_modify_lot_cons" ON public.stock_lot_consumptions;
CREATE POLICY "tenant_modify_lot_cons" ON public.stock_lot_consumptions FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- 5. Lot number generator
CREATE OR REPLACE FUNCTION public.generate_lot_number(p_tenant_id uuid, p_item_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'LOT-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-' ||
    LPAD((COALESCE((SELECT COUNT(*)+1 FROM public.stock_lots
      WHERE tenant_id = p_tenant_id AND item_id = p_item_id
        AND created_at::date = CURRENT_DATE), 1))::text, 4, '0');
$$;

-- 6. FIFO consumption helper
CREATE OR REPLACE FUNCTION public.consume_inventory_fifo(
  p_item_id uuid, p_quantity numeric, p_movement_id uuid,
  p_reference_type text DEFAULT NULL, p_reference_id uuid DEFAULT NULL,
  p_consumption_date date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_lot RECORD; v_remaining numeric := p_quantity; v_take numeric; v_total_cost numeric := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'consume_inventory_fifo: quantity must be > 0'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.inventory_items WHERE id = p_item_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;

  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost FROM public.stock_lots
    WHERE item_id = p_item_id AND qty_remaining > 0
    ORDER BY receipt_date ASC, created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_lot.qty_remaining);
    INSERT INTO public.stock_lot_consumptions(
      tenant_id, lot_id, movement_id, item_id, qty_consumed, unit_cost,
      consumption_date, reference_type, reference_id
    ) VALUES (v_tenant, v_lot.id, p_movement_id, p_item_id, v_take, v_lot.unit_cost,
      p_consumption_date, p_reference_type, p_reference_id);
    UPDATE public.stock_lots SET qty_remaining = qty_remaining - v_take, updated_at = now() WHERE id = v_lot.id;
    v_total_cost := v_total_cost + (v_take * v_lot.unit_cost);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN RAISE EXCEPTION 'Insufficient FIFO lots for item %: short %', p_item_id, v_remaining; END IF;

  RETURN jsonb_build_object('ok', true, 'qty_consumed', p_quantity,
    'total_cost', round(v_total_cost, 2), 'avg_unit_cost', round(v_total_cost / p_quantity, 6));
END $$;

-- 7. Updated post_grn — adds FIFO lot creation
CREATE OR REPLACE FUNCTION public.post_grn(p_grn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_grn goods_receipt_notes%ROWTYPE;
  v_grni uuid; v_je uuid; v_total numeric(18,2):=0;
  v_line RECORD; v_item inventory_items%ROWTYPE;
  v_old_qty numeric; v_new_qty numeric; v_new_avg numeric;
  v_lines_count int:=0; v_mov_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_grn FROM public.goods_receipt_notes WHERE id=p_grn_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF v_grn.status<>'draft' THEN RAISE EXCEPTION 'Only draft GRNs can be posted (current: %)', v_grn.status; END IF;
  IF public.is_period_closed(v_tenant, v_grn.receipt_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_grn.receipt_date;
  END IF;

  SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' AND is_active LIMIT 1;
  IF v_grni IS NULL THEN
    PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  END IF;
  IF v_grni IS NULL THEN RAISE EXCEPTION 'GRNI account (2150) not found'; END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_grn.receipt_date, 'Goods Receipt '||v_grn.grn_number, v_grn.grn_number,
    'posted', now(), v_user, 'grn', v_grn.id, true, 'grn')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.grn_lines WHERE grn_id=p_grn_id ORDER BY created_at LOOP
    v_lines_count := v_lines_count+1;
    SELECT * INTO v_item FROM public.inventory_items WHERE id=v_line.item_id AND tenant_id=v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
    IF NOT v_item.is_active THEN RAISE EXCEPTION 'Item % is inactive', v_item.item_name; END IF;
    IF v_item.account_id IS NULL THEN RAISE EXCEPTION 'Item % has no Inventory Asset account', v_item.item_name; END IF;

    INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, notes, movement_date)
    VALUES (v_tenant, v_line.item_id, 'purchase', v_line.qty_received, v_line.unit_cost,
      'grn', v_grn.id, 'GRN '||v_grn.grn_number, v_grn.receipt_date)
    RETURNING id INTO v_mov_id;

    SELECT COALESCE(SUM(quantity),0) INTO v_new_qty FROM public.stock_movements WHERE item_id=v_line.item_id;
    v_old_qty := v_new_qty - v_line.qty_received;
    IF v_old_qty <= 0 THEN
      v_new_avg := v_line.unit_cost;
    ELSE
      v_new_avg := round(((v_old_qty * COALESCE(v_item.unit_cost,0)) + (v_line.qty_received * v_line.unit_cost)) / v_new_qty, 6);
    END IF;

    UPDATE public.inventory_items
    SET unit_cost=v_new_avg, quantity_on_hand=v_new_qty, last_purchase_price=v_line.unit_cost, updated_at=now()
    WHERE id=v_line.item_id;

    IF v_item.valuation_method = 'fifo' THEN
      INSERT INTO public.stock_lots(
        tenant_id, item_id, lot_number, receipt_date, qty_received, qty_remaining,
        unit_cost, source_type, source_id, notes
      ) VALUES (
        v_tenant, v_line.item_id, public.generate_lot_number(v_tenant, v_line.item_id),
        v_grn.receipt_date, v_line.qty_received, v_line.qty_received,
        v_line.unit_cost, 'grn', v_grn.id, 'GRN '||v_grn.grn_number
      );
    END IF;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_item.account_id, v_line.line_total, 0);

    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE public.purchase_order_lines SET qty_received = qty_received + v_line.qty_received WHERE id = v_line.po_line_id;
    END IF;
    v_total := v_total + v_line.line_total;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'GRN must have at least one line'; END IF;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_grni, 0, v_total);

  UPDATE public.goods_receipt_notes
  SET status='posted', posted_at=now(), journal_entry_id=v_je, total_value=v_total
  WHERE id=p_grn_id;

  IF v_grn.po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po
    SET status = CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.purchase_order_lines l WHERE l.po_id=po.id AND l.qty_received < l.qty_ordered)
      THEN 'received' ELSE 'partial' END
    WHERE po.id = v_grn.po_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'grn_id',p_grn_id,'journal_entry_id',v_je,'total',v_total);
END $$;

-- 8. Inventory valuation report
CREATE OR REPLACE FUNCTION public.inventory_valuation_report(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(
  item_id uuid, item_code text, item_name text, valuation_method text,
  qty_on_hand numeric, unit_cost numeric, fifo_value numeric, wac_value numeric, reported_value numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH tid AS (SELECT COALESCE(p_tenant_id, public.get_user_tenant_id()) AS tenant_id),
  fifo AS (
    SELECT sl.item_id, COALESCE(SUM(sl.qty_remaining * sl.unit_cost), 0) AS fifo_value
    FROM public.stock_lots sl, tid
    WHERE sl.tenant_id = tid.tenant_id GROUP BY sl.item_id
  )
  SELECT i.id, i.item_code, i.item_name, i.valuation_method,
    i.quantity_on_hand, i.unit_cost,
    COALESCE(f.fifo_value, 0)::numeric,
    round(i.quantity_on_hand * i.unit_cost, 2)::numeric,
    CASE WHEN i.valuation_method = 'fifo' THEN round(COALESCE(f.fifo_value, 0), 2)
      ELSE round(i.quantity_on_hand * i.unit_cost, 2) END::numeric
  FROM public.inventory_items i
  CROSS JOIN tid
  LEFT JOIN fifo f ON f.item_id = i.id
  WHERE i.tenant_id = tid.tenant_id AND i.is_active
  ORDER BY i.item_name;
$$;

-- 9. Backfill synthetic opening lot for FIFO items already holding stock
INSERT INTO public.stock_lots (tenant_id, item_id, lot_number, receipt_date,
  qty_received, qty_remaining, unit_cost, source_type, notes)
SELECT i.tenant_id, i.id,
  'LOT-OPENING-' || substr(i.id::text, 1, 8),
  CURRENT_DATE, i.quantity_on_hand, i.quantity_on_hand,
  COALESCE(i.unit_cost, 0), 'opening', 'Backfilled opening lot for FIFO conversion'
FROM public.inventory_items i
WHERE i.valuation_method = 'fifo' AND i.quantity_on_hand > 0
  AND NOT EXISTS (SELECT 1 FROM public.stock_lots sl WHERE sl.item_id = i.id);