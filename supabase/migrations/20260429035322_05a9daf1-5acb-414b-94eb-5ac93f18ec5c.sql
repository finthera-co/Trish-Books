-- ═══════════════════════════════════════════════════════════════════
-- INVENTORY ↔ ACCOUNTING INTEGRATION
-- ═══════════════════════════════════════════════════════════════════

-- 1. Extend products as unified item master
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid NULL REFERENCES public.inventory_items(id),
  ADD COLUMN IF NOT EXISTS expense_account_id uuid NULL REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS asset_account_id uuid NULL REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS is_tracked boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_type_chk') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_type_chk CHECK (type IN ('service','non_inventory','inventory'));
  END IF;
END $$;

-- Coherence trigger: tracked iff inventory; require linkage; services must not link inventory
CREATE OR REPLACE FUNCTION public.validate_product_inventory_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type = 'inventory' THEN
    NEW.is_tracked := true;
    IF NEW.inventory_item_id IS NULL THEN
      RAISE EXCEPTION 'Inventory product "%" requires inventory_item_id', NEW.name;
    END IF;
  ELSE
    NEW.is_tracked := false;
    IF NEW.type = 'service' AND NEW.inventory_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Service product "%" must not have inventory_item_id', NEW.name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_product_inventory_link ON public.products;
CREATE TRIGGER trg_validate_product_inventory_link
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.validate_product_inventory_link();

-- 2. Snapshot inventory_item_id on invoice line at creation time
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid NULL REFERENCES public.inventory_items(id);

CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_inventory()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_inv uuid; v_tracked boolean;
BEGIN
  IF NEW.inventory_item_id IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT inventory_item_id, is_tracked INTO v_inv, v_tracked
    FROM products WHERE id = NEW.product_id;
    IF v_tracked THEN NEW.inventory_item_id := v_inv; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_snapshot_invoice_item_inventory ON public.invoice_items;
CREATE TRIGGER trg_snapshot_invoice_item_inventory
BEFORE INSERT ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_item_inventory();

-- 3. Idempotency guard: one stock movement per (reference_type, reference_id, item_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_ref_item
  ON public.stock_movements (reference_type, reference_id, item_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- 4. Receive Inventory RPC: atomic stock movement + moving-average update + GL posting
CREATE OR REPLACE FUNCTION public.receive_inventory(
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_payment_account_id uuid,        -- credit side: AP or Cash/Bank account
  p_receipt_date date DEFAULT CURRENT_DATE,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
  v_item inventory_items%ROWTYPE;
  v_asset_account uuid;
  v_credit_account accounts%ROWTYPE;
  v_old_qty numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_total numeric;
  v_je_id uuid;
  v_mov_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN RAISE EXCEPTION 'Unit cost must be >= 0'; END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_inventory_item_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found in tenant'; END IF;

  v_asset_account := v_item.account_id;
  IF v_asset_account IS NULL THEN
    RAISE EXCEPTION 'Inventory item "%" has no asset account configured', v_item.item_name;
  END IF;

  SELECT * INTO v_credit_account FROM accounts
  WHERE id = p_payment_account_id AND tenant_id = v_tenant_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment/AP account invalid or inactive'; END IF;
  IF v_credit_account.account_type NOT IN ('Asset','Liability') THEN
    RAISE EXCEPTION 'Receipt credit account must be Cash/Bank (Asset) or AP (Liability)';
  END IF;

  v_total := round(p_quantity * p_unit_cost, 2);

  -- Compute new moving average from current on-hand (derived from movements)
  SELECT COALESCE(SUM(quantity), 0) INTO v_old_qty
  FROM stock_movements WHERE item_id = p_inventory_item_id;
  v_new_qty := v_old_qty + p_quantity;

  IF v_old_qty <= 0 THEN
    v_new_avg := p_unit_cost;
  ELSE
    v_new_avg := round(((v_old_qty * COALESCE(v_item.unit_cost,0)) + (p_quantity * p_unit_cost)) / v_new_qty, 6);
  END IF;

  -- Stock movement (positive qty = receipt)
  INSERT INTO stock_movements (
    tenant_id, item_id, movement_type, quantity, unit_cost,
    reference_type, reference_id, notes, movement_date
  ) VALUES (
    v_tenant_id, p_inventory_item_id, 'purchase', p_quantity, p_unit_cost,
    'inventory_receipt', gen_random_uuid(), p_notes, p_receipt_date
  ) RETURNING id INTO v_mov_id;

  -- Update moving average + qty cache
  UPDATE inventory_items
  SET unit_cost = v_new_avg,
      quantity_on_hand = v_new_qty,
      updated_at = now()
  WHERE id = p_inventory_item_id;

  -- GL: Dr Inventory / Cr AP or Cash
  INSERT INTO journal_entries (
    tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type
  ) VALUES (
    v_tenant_id, p_receipt_date,
    'Inventory receipt: ' || v_item.item_name || ' x ' || p_quantity,
    COALESCE(p_reference, 'RCV-' || to_char(now(),'YYYYMMDDHH24MISS')),
    'posted', now(), v_user_id, 'inventory_receipt', v_mov_id, true, 'inventory_receipt'
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES
    (v_je_id, v_asset_account, v_total, 0),
    (v_je_id, p_payment_account_id, 0, v_total);

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_mov_id,
    'journal_id', v_je_id,
    'new_avg_cost', v_new_avg,
    'new_qty', v_new_qty,
    'total', v_total
  );
END $$;

GRANT EXECUTE ON FUNCTION public.receive_inventory(uuid,numeric,numeric,uuid,date,text,text) TO authenticated;

-- 5. Sync inventory_items.quantity_on_hand from stock_movements as a safety net
CREATE OR REPLACE FUNCTION public.sync_inventory_qty_on_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_qty numeric;
BEGIN
  v_item := COALESCE(NEW.item_id, OLD.item_id);
  SELECT COALESCE(SUM(quantity),0) INTO v_qty FROM stock_movements WHERE item_id = v_item;
  UPDATE inventory_items SET quantity_on_hand = v_qty, updated_at = now() WHERE id = v_item;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_sync_inventory_qty ON public.stock_movements;
CREATE TRIGGER trg_sync_inventory_qty
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.sync_inventory_qty_on_movement();