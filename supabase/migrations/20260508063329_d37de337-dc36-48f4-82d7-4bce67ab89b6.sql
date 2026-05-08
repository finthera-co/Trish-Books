
CREATE TABLE IF NOT EXISTS public.boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bom_code text NOT NULL,
  fg_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  version int NOT NULL DEFAULT 1,
  output_qty numeric(18,4) NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  labor_cost_per_unit numeric(18,4) NOT NULL DEFAULT 0,
  overhead_cost_per_unit numeric(18,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bom_code, version)
);

CREATE TABLE IF NOT EXISTS public.bom_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  qty_per_output numeric(18,6) NOT NULL CHECK (qty_per_output > 0),
  scrap_pct numeric(6,4) NOT NULL DEFAULT 0 CHECK (scrap_pct >= 0 AND scrap_pct < 1),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assembly_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ao_number text NOT NULL,
  ao_date date NOT NULL DEFAULT CURRENT_DATE,
  bom_id uuid NOT NULL REFERENCES public.boms(id),
  fg_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  output_qty numeric(18,4) NOT NULL CHECK (output_qty > 0),
  warehouse_id uuid REFERENCES public.warehouses(id),
  component_cost numeric(18,2) NOT NULL DEFAULT 0,
  labor_cost numeric(18,2) NOT NULL DEFAULT 0,
  overhead_cost numeric(18,2) NOT NULL DEFAULT 0,
  total_cost numeric(18,2) NOT NULL DEFAULT 0,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes text,
  journal_entry_id uuid,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ao_number)
);

CREATE TABLE IF NOT EXISTS public.assembly_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  assembly_order_id uuid NOT NULL REFERENCES public.assembly_orders(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  qty_required numeric(18,6) NOT NULL,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  total_cost numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boms_tenant ON public.boms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bom_components_bom ON public.bom_components(bom_id);
CREATE INDEX IF NOT EXISTS idx_ao_tenant ON public.assembly_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ao_lines_ao ON public.assembly_order_lines(assembly_order_id);

ALTER TABLE public.boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assembly_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assembly_order_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_all_boms" ON public.boms FOR ALL
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tenant_all_bom_comp" ON public.bom_components FOR ALL
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tenant_all_ao" ON public.assembly_orders FOR ALL
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tenant_all_ao_lines" ON public.assembly_order_lines FOR ALL
    USING (tenant_id = public.get_user_tenant_id())
    WITH CHECK (tenant_id = public.get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.accounts (tenant_id, account_code, account_name, account_type, account_subtype, is_active)
SELECT t.id, '5110', 'Direct Labor Applied', 'Expense', 'Cost of Goods Sold', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id = t.id AND a.account_code = '5110');

INSERT INTO public.accounts (tenant_id, account_code, account_name, account_type, account_subtype, is_active)
SELECT t.id, '5120', 'Manufacturing Overhead Applied', 'Expense', 'Cost of Goods Sold', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id = t.id AND a.account_code = '5120');

CREATE OR REPLACE FUNCTION public.post_assembly_order(p_ao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ao record; v_comp record; v_fg record;
  v_inv_acct uuid; v_labor_acct uuid; v_oh_acct uuid;
  v_je_id uuid; v_total_comp numeric := 0; v_total numeric := 0; v_unit_cost numeric;
  v_mov_id uuid; v_fifo jsonb; v_cost numeric;
BEGIN
  SELECT * INTO v_ao FROM public.assembly_orders WHERE id = p_ao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assembly order not found'; END IF;
  IF v_ao.status <> 'draft' THEN RAISE EXCEPTION 'Only draft assembly orders can be posted'; END IF;
  SELECT * INTO v_fg FROM public.inventory_items WHERE id = v_ao.fg_item_id;
  SELECT id INTO v_inv_acct FROM public.accounts WHERE tenant_id = v_ao.tenant_id AND account_code = '1200' LIMIT 1;
  IF v_inv_acct IS NULL THEN RAISE EXCEPTION 'Inventory account 1200 not found'; END IF;
  SELECT id INTO v_labor_acct FROM public.accounts WHERE tenant_id = v_ao.tenant_id AND account_code = '5110' LIMIT 1;
  SELECT id INTO v_oh_acct FROM public.accounts WHERE tenant_id = v_ao.tenant_id AND account_code = '5120' LIMIT 1;

  INSERT INTO public.journal_entries (tenant_id, entry_date, description, status, source_type, source_id)
  VALUES (v_ao.tenant_id, v_ao.ao_date, 'Assembly Order ' || v_ao.ao_number, 'posted', 'assembly_order', v_ao.id)
  RETURNING id INTO v_je_id;

  FOR v_comp IN
    SELECT l.*, i.valuation_method, i.unit_cost AS wac_cost, i.quantity_on_hand, i.item_name
      FROM public.assembly_order_lines l
      JOIN public.inventory_items i ON i.id = l.component_item_id
     WHERE l.assembly_order_id = p_ao_id
  LOOP
    IF v_comp.quantity_on_hand < v_comp.qty_required THEN
      RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_comp.item_name, v_comp.quantity_on_hand, v_comp.qty_required;
    END IF;
    INSERT INTO public.stock_movements (tenant_id, item_id, movement_date, movement_type, quantity, reference_type, reference_id, warehouse_id)
    VALUES (v_ao.tenant_id, v_comp.component_item_id, v_ao.ao_date, 'assembly_consume', -v_comp.qty_required, 'assembly_order', v_ao.id, v_ao.warehouse_id)
    RETURNING id INTO v_mov_id;
    IF v_comp.valuation_method = 'fifo' THEN
      v_fifo := public.consume_inventory_fifo(v_comp.component_item_id, v_comp.qty_required, v_mov_id, 'assembly_order', v_ao.id, v_ao.ao_date);
      v_cost := round((v_fifo->>'total_cost')::numeric, 2);
    ELSE
      v_cost := round(v_comp.qty_required * COALESCE(v_comp.wac_cost, 0), 2);
    END IF;
    UPDATE public.inventory_items SET quantity_on_hand = quantity_on_hand - v_comp.qty_required, updated_at = now() WHERE id = v_comp.component_item_id;
    UPDATE public.assembly_order_lines
       SET unit_cost = CASE WHEN v_comp.qty_required > 0 THEN round(v_cost / v_comp.qty_required, 4) ELSE 0 END,
           total_cost = v_cost
     WHERE id = v_comp.id;
    IF v_cost > 0 THEN
      INSERT INTO public.journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, description)
      VALUES (v_ao.tenant_id, v_je_id, v_inv_acct, 0, v_cost, 'Consume ' || v_comp.item_name);
    END IF;
    v_total_comp := v_total_comp + v_cost;
  END LOOP;

  v_total := v_total_comp + COALESCE(v_ao.labor_cost,0) + COALESCE(v_ao.overhead_cost,0);
  v_unit_cost := CASE WHEN v_ao.output_qty > 0 THEN round(v_total / v_ao.output_qty, 4) ELSE 0 END;

  IF COALESCE(v_ao.labor_cost,0) > 0 AND v_labor_acct IS NOT NULL THEN
    INSERT INTO public.journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, description)
    VALUES (v_ao.tenant_id, v_je_id, v_labor_acct, 0, v_ao.labor_cost, 'Direct labor applied');
  END IF;
  IF COALESCE(v_ao.overhead_cost,0) > 0 AND v_oh_acct IS NOT NULL THEN
    INSERT INTO public.journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, description)
    VALUES (v_ao.tenant_id, v_je_id, v_oh_acct, 0, v_ao.overhead_cost, 'Mfg overhead applied');
  END IF;
  IF v_total > 0 THEN
    INSERT INTO public.journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, description)
    VALUES (v_ao.tenant_id, v_je_id, v_inv_acct, v_total, 0, 'Assemble ' || v_fg.item_name);
  END IF;

  INSERT INTO public.stock_movements (tenant_id, item_id, movement_date, movement_type, quantity, reference_type, reference_id, warehouse_id, unit_cost)
  VALUES (v_ao.tenant_id, v_ao.fg_item_id, v_ao.ao_date, 'assembly_receipt', v_ao.output_qty, 'assembly_order', v_ao.id, v_ao.warehouse_id, v_unit_cost)
  RETURNING id INTO v_mov_id;

  IF v_fg.valuation_method = 'fifo' THEN
    INSERT INTO public.stock_lots (tenant_id, item_id, receipt_date, qty_received, qty_remaining, unit_cost, source_type, source_id)
    VALUES (v_ao.tenant_id, v_ao.fg_item_id, v_ao.ao_date, v_ao.output_qty, v_ao.output_qty, v_unit_cost, 'assembly_order', v_ao.id);
  ELSE
    UPDATE public.inventory_items
       SET unit_cost = CASE WHEN (quantity_on_hand + v_ao.output_qty) > 0
         THEN round(((quantity_on_hand * unit_cost) + v_total) / (quantity_on_hand + v_ao.output_qty), 4)
         ELSE v_unit_cost END
     WHERE id = v_ao.fg_item_id;
  END IF;

  UPDATE public.inventory_items SET quantity_on_hand = quantity_on_hand + v_ao.output_qty, updated_at = now() WHERE id = v_ao.fg_item_id;

  UPDATE public.assembly_orders
     SET status='posted', component_cost=v_total_comp, total_cost=v_total, unit_cost=v_unit_cost,
         journal_entry_id=v_je_id, posted_at=now(), posted_by=auth.uid(), updated_at=now()
   WHERE id = p_ao_id;

  RETURN jsonb_build_object('ok', true, 'journal_entry_id', v_je_id, 'total_cost', v_total, 'unit_cost', v_unit_cost);
END;
$$;
