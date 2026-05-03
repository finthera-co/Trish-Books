
-- Warehouses master
CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  address text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouses_tenant_all" ON public.warehouses
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE TRIGGER warehouses_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add warehouse_id columns
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id);
ALTER TABLE public.stock_lots      ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id);
ALTER TABLE public.grn_lines       ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON public.stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_warehouse ON public.stock_lots(warehouse_id);

-- Seed default warehouse + 1310 In-Transit per tenant + backfill
DO $$
DECLARE t record; v_wh uuid;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    INSERT INTO public.warehouses (tenant_id, code, name, is_default)
    VALUES (t.id, 'MAIN', 'Main Warehouse', true)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    SELECT id INTO v_wh FROM public.warehouses WHERE tenant_id = t.id AND code = 'MAIN';

    UPDATE public.stock_movements SET warehouse_id = v_wh WHERE tenant_id = t.id AND warehouse_id IS NULL;
    UPDATE public.stock_lots      SET warehouse_id = v_wh WHERE tenant_id = t.id AND warehouse_id IS NULL;
    UPDATE public.grn_lines gl    SET warehouse_id = v_wh
      WHERE warehouse_id IS NULL AND EXISTS (
        SELECT 1 FROM public.goods_receipt_notes g WHERE g.id = gl.grn_id AND g.tenant_id = t.id);

    INSERT INTO public.accounts (tenant_id, account_code, account_name, account_type, account_subtype, is_active)
    VALUES (t.id, '1310', 'Inventory In-Transit', 'Asset', 'Current Asset', true)
    ON CONFLICT (tenant_id, account_code) DO NOTHING;
  END LOOP;
END $$;

-- Stock transfers
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  transfer_number text NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  out_journal_entry_id uuid REFERENCES public.journal_entries(id),
  in_journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, transfer_number),
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  total_cost numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_transfers_tenant" ON public.stock_transfers
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "stock_transfer_lines_tenant" ON public.stock_transfer_lines
  FOR ALL TO authenticated
  USING (transfer_id IN (SELECT id FROM public.stock_transfers WHERE tenant_id IN
    (SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid())))
  WITH CHECK (transfer_id IN (SELECT id FROM public.stock_transfers WHERE tenant_id IN
    (SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid())));

CREATE TRIGGER stock_transfers_updated_at
  BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-numbering ST-XXXXX
CREATE OR REPLACE FUNCTION public.set_transfer_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF NEW.transfer_number IS NULL OR NEW.transfer_number = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_number FROM 4) AS int)), 0) + 1
      INTO v_n FROM public.stock_transfers
      WHERE tenant_id = NEW.tenant_id AND transfer_number ~ '^ST-[0-9]+$';
    NEW.transfer_number := 'ST-' || LPAD(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER stock_transfers_autonumber
  BEFORE INSERT ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_transfer_number();

-- Posting RPC
CREATE OR REPLACE FUNCTION public.post_stock_transfer(p_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tr record; v_line record;
  v_intransit uuid;
  v_je_out uuid; v_je_in uuid;
  v_user uuid := auth.uid();
  v_method text; v_unit numeric; v_item_inv_acct uuid;
  v_cogs numeric;
  v_lot record; v_take numeric; v_remaining numeric;
BEGIN
  SELECT * INTO v_tr FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_tr.status NOT IN ('draft','in_transit') THEN
    RAISE EXCEPTION 'Transfer already %', v_tr.status;
  END IF;

  SELECT id INTO v_intransit FROM public.accounts
    WHERE tenant_id = v_tr.tenant_id AND account_code = '1310' LIMIT 1;
  IF v_intransit IS NULL THEN RAISE EXCEPTION 'Account 1310 In-Transit not found'; END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, source_type, source_id, created_by, status)
  VALUES (v_tr.tenant_id, v_tr.transfer_date, 'Stock Transfer Out ' || v_tr.transfer_number,
          'stock_transfer_out', v_tr.id, v_user, 'posted')
  RETURNING id INTO v_je_out;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = v_tr.id LOOP
    SELECT valuation_method, unit_cost, account_id INTO v_method, v_unit, v_item_inv_acct
      FROM public.inventory_items WHERE id = v_line.item_id;

    IF v_method = 'fifo' THEN
      v_cogs := 0; v_remaining := v_line.quantity;
      FOR v_lot IN
        SELECT id, qty_remaining, unit_cost FROM public.stock_lots
        WHERE item_id = v_line.item_id AND warehouse_id = v_tr.from_warehouse_id AND qty_remaining > 0
        ORDER BY receipt_date ASC, created_at ASC FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_lot.qty_remaining);
        UPDATE public.stock_lots SET qty_remaining = qty_remaining - v_take WHERE id = v_lot.id;
        v_cogs := v_cogs + (v_take * v_lot.unit_cost);
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining > 0 THEN RAISE EXCEPTION 'Insufficient FIFO stock at source warehouse'; END IF;
      v_unit := v_cogs / v_line.quantity;
    END IF;

    UPDATE public.stock_transfer_lines
      SET unit_cost = v_unit, total_cost = round(v_unit * v_line.quantity, 2)
      WHERE id = v_line.id;

    INSERT INTO public.stock_movements(tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost, reference_type, reference_id, movement_date)
    VALUES (v_tr.tenant_id, v_line.item_id, v_tr.from_warehouse_id, 'transfer',
            -v_line.quantity, v_unit, round(v_unit * v_line.quantity, 2),
            'stock_transfer', v_tr.id, v_tr.transfer_date);

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_out, v_intransit, round(v_unit * v_line.quantity, 2), 0, 'Transfer out ' || v_tr.transfer_number),
      (v_je_out, v_item_inv_acct, 0, round(v_unit * v_line.quantity, 2), 'Transfer out ' || v_tr.transfer_number);
  END LOOP;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, source_type, source_id, created_by, status)
  VALUES (v_tr.tenant_id, v_tr.transfer_date, 'Stock Transfer In ' || v_tr.transfer_number,
          'stock_transfer_in', v_tr.id, v_user, 'posted')
  RETURNING id INTO v_je_in;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = v_tr.id LOOP
    SELECT valuation_method, account_id INTO v_method, v_item_inv_acct
      FROM public.inventory_items WHERE id = v_line.item_id;

    INSERT INTO public.stock_movements(tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost, reference_type, reference_id, movement_date)
    VALUES (v_tr.tenant_id, v_line.item_id, v_tr.to_warehouse_id, 'transfer',
            v_line.quantity, v_line.unit_cost, v_line.total_cost,
            'stock_transfer', v_tr.id, v_tr.transfer_date);

    IF v_method = 'fifo' THEN
      INSERT INTO public.stock_lots(tenant_id, item_id, warehouse_id, receipt_date, qty_received, qty_remaining, unit_cost, source_type, source_id)
      VALUES (v_tr.tenant_id, v_line.item_id, v_tr.to_warehouse_id, v_tr.transfer_date,
              v_line.quantity, v_line.quantity, v_line.unit_cost, 'stock_transfer', v_tr.id);
    END IF;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_in, v_item_inv_acct, v_line.total_cost, 0, 'Transfer in ' || v_tr.transfer_number),
      (v_je_in, v_intransit, 0, v_line.total_cost, 'Transfer in ' || v_tr.transfer_number);
  END LOOP;

  UPDATE public.stock_transfers
    SET status = 'posted', out_journal_entry_id = v_je_out, in_journal_entry_id = v_je_in, posted_at = now()
    WHERE id = v_tr.id;

  RETURN v_tr.id;
END $$;
