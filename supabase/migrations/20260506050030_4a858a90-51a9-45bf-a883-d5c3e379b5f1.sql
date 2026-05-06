
-- ============================================================
-- PHASE 4: Sales-side Inventory & Returns
-- ============================================================

-- ── Delivery Notes ──────────────────────────────────────────
CREATE TABLE public.delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dn_number text NOT NULL,
  customer_id uuid,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  dispatch_date date NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id uuid REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  total_cogs numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, dn_number)
);

CREATE TABLE public.delivery_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dn_id uuid NOT NULL REFERENCES public.delivery_notes(id) ON DELETE CASCADE,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,6) NOT NULL DEFAULT 0,
  line_cost numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_note_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY dn_tenant ON public.delivery_notes FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY dnl_tenant ON public.delivery_note_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Numbering trigger
CREATE OR REPLACE FUNCTION public.set_dn_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_n int;
BEGIN
  IF NEW.dn_number IS NULL OR NEW.dn_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(dn_number,'\D','','g'),'')::int),0)+1
    INTO v_n FROM public.delivery_notes WHERE tenant_id = NEW.tenant_id;
    NEW.dn_number := 'DN-' || LPAD(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_set_dn_number BEFORE INSERT ON public.delivery_notes
FOR EACH ROW EXECUTE FUNCTION public.set_dn_number();

-- Block edit after post
CREATE OR REPLACE FUNCTION public.block_posted_dn_edits()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' AND TG_OP = 'UPDATE' AND NEW.status = 'posted' THEN
    IF NEW.dispatch_date <> OLD.dispatch_date OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'Cannot edit a posted delivery note';
    END IF;
  END IF;
  IF OLD.status = 'posted' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cannot delete a posted delivery note';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_block_posted_dn BEFORE UPDATE OR DELETE ON public.delivery_notes
FOR EACH ROW EXECUTE FUNCTION public.block_posted_dn_edits();

-- ── Sales Returns ───────────────────────────────────────────
CREATE TABLE public.sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sr_number text NOT NULL,
  customer_id uuid,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id uuid REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_cogs numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  reason text,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, sr_number)
);

CREATE TABLE public.sales_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sr_id uuid NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price numeric(18,6) NOT NULL DEFAULT 0,
  unit_cost numeric(18,6) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  line_cost numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sr_tenant ON public.sales_returns FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY srl_tenant ON public.sales_return_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.set_sr_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_n int;
BEGIN
  IF NEW.sr_number IS NULL OR NEW.sr_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(sr_number,'\D','','g'),'')::int),0)+1
    INTO v_n FROM public.sales_returns WHERE tenant_id = NEW.tenant_id;
    NEW.sr_number := 'SR-' || LPAD(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_set_sr_number BEFORE INSERT ON public.sales_returns
FOR EACH ROW EXECUTE FUNCTION public.set_sr_number();

-- ── Purchase Returns ────────────────────────────────────────
CREATE TABLE public.purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pr_number text NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id),
  grn_id uuid REFERENCES public.goods_receipt_notes(id) ON DELETE SET NULL,
  bill_id uuid REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id uuid REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  reason text,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, pr_number)
);

CREATE TABLE public.purchase_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pr_id uuid NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,6) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_tenant ON public.purchase_returns FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY prl_tenant ON public.purchase_return_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.set_pr_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_n int;
BEGIN
  IF NEW.pr_number IS NULL OR NEW.pr_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(pr_number,'\D','','g'),'')::int),0)+1
    INTO v_n FROM public.purchase_returns WHERE tenant_id = NEW.tenant_id;
    NEW.pr_number := 'PR-' || LPAD(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_set_pr_number BEFORE INSERT ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.set_pr_number();

-- ============================================================
-- POSTING RPCs
-- ============================================================

-- ── post_delivery_note: Dr COGS / Cr Inventory ──────────────
CREATE OR REPLACE FUNCTION public.post_delivery_note(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_dn delivery_notes%ROWTYPE;
  v_line RECORD; v_item inventory_items%ROWTYPE;
  v_je uuid; v_total numeric(18,2):=0; v_mov_id uuid;
  v_cost numeric(18,2); v_fifo jsonb; v_lines int:=0;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_dn FROM public.delivery_notes WHERE id=p_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery Note not found'; END IF;
  IF v_dn.status<>'draft' THEN RAISE EXCEPTION 'Only draft DNs can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_dn.dispatch_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed', v_dn.dispatch_date;
  END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_dn.dispatch_date, 'Delivery Note '||v_dn.dn_number, v_dn.dn_number,
    'posted', now(), v_user, 'delivery_note', v_dn.id, true, 'delivery_note')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.delivery_note_lines WHERE dn_id=p_id ORDER BY created_at LOOP
    v_lines := v_lines + 1;
    SELECT * INTO v_item FROM public.inventory_items WHERE id=v_line.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
    IF v_item.account_id IS NULL THEN RAISE EXCEPTION 'Item % missing Inventory account', v_item.item_name; END IF;
    IF v_item.cogs_account_id IS NULL THEN RAISE EXCEPTION 'Item % missing COGS account', v_item.item_name; END IF;
    IF v_item.quantity_on_hand < v_line.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_item.item_name, v_item.quantity_on_hand, v_line.qty;
    END IF;

    INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, notes, movement_date, warehouse_id)
    VALUES (v_tenant, v_line.item_id, 'sale', -v_line.qty, 0,
      'delivery_note', v_dn.id, 'DN '||v_dn.dn_number, v_dn.dispatch_date, v_line.warehouse_id)
    RETURNING id INTO v_mov_id;

    IF v_item.valuation_method = 'fifo' THEN
      v_fifo := public.consume_inventory_fifo(v_line.item_id, v_line.qty, v_mov_id, 'delivery_note', v_dn.id, v_dn.dispatch_date);
      v_cost := round((v_fifo->>'total_cost')::numeric, 2);
    ELSE
      v_cost := round(v_line.qty * COALESCE(v_item.unit_cost,0), 2);
    END IF;

    UPDATE public.stock_movements SET unit_cost = round(v_cost / v_line.qty, 6), total_cost = v_cost WHERE id = v_mov_id;
    UPDATE public.delivery_note_lines SET unit_cost = round(v_cost / v_line.qty, 6), line_cost = v_cost WHERE id = v_line.id;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_item.cogs_account_id, v_cost, 0),
           (v_je, v_item.account_id, 0, v_cost);
    v_total := v_total + v_cost;
  END LOOP;

  IF v_lines = 0 THEN RAISE EXCEPTION 'Delivery Note must have at least one line'; END IF;

  UPDATE public.delivery_notes
  SET status='posted', posted_at=now(), journal_entry_id=v_je, total_cogs=v_total
  WHERE id=p_id;

  RETURN jsonb_build_object('ok',true,'dn_id',p_id,'journal_entry_id',v_je,'total_cogs',v_total);
END $$;

-- ── post_sales_return: Restock + reverse COGS ───────────────
CREATE OR REPLACE FUNCTION public.post_sales_return(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_sr sales_returns%ROWTYPE;
  v_line RECORD; v_item inventory_items%ROWTYPE;
  v_je uuid; v_revenue numeric(18,2):=0; v_cogs numeric(18,2):=0;
  v_ar uuid; v_sr_acct uuid; v_lines int:=0;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_sr FROM public.sales_returns WHERE id=p_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales Return not found'; END IF;
  IF v_sr.status<>'draft' THEN RAISE EXCEPTION 'Only draft Sales Returns can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_sr.return_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed', v_sr.return_date;
  END IF;

  -- AR account (use original invoice's AR or default)
  IF v_sr.invoice_id IS NOT NULL THEN
    SELECT ar_account_id INTO v_ar FROM public.invoices WHERE id = v_sr.invoice_id;
  END IF;
  IF v_ar IS NULL THEN
    SELECT id INTO v_ar FROM public.accounts WHERE tenant_id=v_tenant AND account_code='1200' AND is_active LIMIT 1;
  END IF;
  IF v_ar IS NULL THEN RAISE EXCEPTION 'AR account not found'; END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_sr.return_date, 'Sales Return '||v_sr.sr_number, v_sr.sr_number,
    'posted', now(), v_user, 'sales_return', v_sr.id, true, 'sales_return')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.sales_return_lines WHERE sr_id=p_id ORDER BY created_at LOOP
    v_lines := v_lines + 1;
    SELECT * INTO v_item FROM public.inventory_items WHERE id=v_line.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;

    -- Restock at original cost (use line.unit_cost, fallback to current WAC)
    DECLARE
      v_unit_cost numeric(18,6) := COALESCE(NULLIF(v_line.unit_cost,0), v_item.unit_cost);
      v_line_cost numeric(18,2) := round(v_line.qty * v_unit_cost, 2);
      v_mov_id uuid;
    BEGIN
      INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, total_cost,
        reference_type, reference_id, notes, movement_date, warehouse_id)
      VALUES (v_tenant, v_line.item_id, 'return', v_line.qty, v_unit_cost, v_line_cost,
        'sales_return', v_sr.id, 'SR '||v_sr.sr_number, v_sr.return_date, v_line.warehouse_id)
      RETURNING id INTO v_mov_id;

      IF v_item.valuation_method = 'fifo' THEN
        INSERT INTO public.stock_lots(tenant_id, item_id, lot_number, receipt_date,
          qty_received, qty_remaining, unit_cost, source_type, source_id, notes, warehouse_id)
        VALUES (v_tenant, v_line.item_id, public.generate_lot_number(v_tenant, v_line.item_id),
          v_sr.return_date, v_line.qty, v_line.qty, v_unit_cost,
          'sales_return', v_sr.id, 'SR '||v_sr.sr_number, v_line.warehouse_id);
      END IF;

      UPDATE public.sales_return_lines SET unit_cost=v_unit_cost, line_cost=v_line_cost,
        line_total = round(v_line.qty * v_line.unit_price, 2) WHERE id = v_line.id;

      v_cogs := v_cogs + v_line_cost;
      v_revenue := v_revenue + round(v_line.qty * v_line.unit_price, 2);

      -- Restock JE: Dr Inventory / Cr COGS
      IF v_item.account_id IS NULL OR v_item.cogs_account_id IS NULL THEN
        RAISE EXCEPTION 'Item % missing Inventory or COGS account', v_item.item_name;
      END IF;
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
      VALUES (v_je, v_item.account_id, v_line_cost, 0),
             (v_je, v_item.cogs_account_id, 0, v_line_cost);
    END;
  END LOOP;

  IF v_lines = 0 THEN RAISE EXCEPTION 'Sales Return must have at least one line'; END IF;

  -- Revenue side: Dr Sales Returns / Cr AR
  IF v_revenue > 0 THEN
    SELECT id INTO v_sr_acct FROM public.accounts
    WHERE tenant_id=v_tenant AND account_code='4900' AND is_active LIMIT 1;
    IF v_sr_acct IS NULL THEN
      INSERT INTO public.accounts(tenant_id, account_code, account_name, account_type, account_subtype, is_active, is_contra)
      VALUES (v_tenant, '4900', 'Sales Returns & Allowances', 'Income', 'Sales Returns', true, true)
      RETURNING id INTO v_sr_acct;
    END IF;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_sr_acct, v_revenue, 0),
           (v_je, v_ar, 0, v_revenue);
  END IF;

  UPDATE public.sales_returns
  SET status='posted', posted_at=now(), journal_entry_id=v_je,
      total_amount=v_revenue, total_cogs=v_cogs
  WHERE id=p_id;

  RETURN jsonb_build_object('ok',true,'sr_id',p_id,'journal_entry_id',v_je,
    'total_amount',v_revenue,'total_cogs',v_cogs);
END $$;

-- ── post_purchase_return: Reduce stock + Cr Inventory ───────
CREATE OR REPLACE FUNCTION public.post_purchase_return(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_pr purchase_returns%ROWTYPE;
  v_line RECORD; v_item inventory_items%ROWTYPE;
  v_je uuid; v_total numeric(18,2):=0; v_lines int:=0;
  v_ap uuid; v_offset uuid; v_mov_id uuid; v_cost numeric(18,2); v_fifo jsonb;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_pr FROM public.purchase_returns WHERE id=p_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase Return not found'; END IF;
  IF v_pr.status<>'draft' THEN RAISE EXCEPTION 'Only draft Purchase Returns can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_pr.return_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed', v_pr.return_date;
  END IF;

  -- Offset: AP if linked to bill, else GRNI clearing
  IF v_pr.bill_id IS NOT NULL THEN
    SELECT id INTO v_offset FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2100' AND is_active LIMIT 1;
  ELSE
    SELECT id INTO v_offset FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' AND is_active LIMIT 1;
  END IF;
  IF v_offset IS NULL THEN RAISE EXCEPTION 'Offset account (AP 2100 or GRNI 2150) not found'; END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_pr.return_date, 'Purchase Return '||v_pr.pr_number, v_pr.pr_number,
    'posted', now(), v_user, 'purchase_return', v_pr.id, true, 'purchase_return')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.purchase_return_lines WHERE pr_id=p_id ORDER BY created_at LOOP
    v_lines := v_lines + 1;
    SELECT * INTO v_item FROM public.inventory_items WHERE id=v_line.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
    IF v_item.account_id IS NULL THEN RAISE EXCEPTION 'Item % missing Inventory account', v_item.item_name; END IF;
    IF v_item.quantity_on_hand < v_line.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_item.item_name, v_item.quantity_on_hand, v_line.qty;
    END IF;

    INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, notes, movement_date, warehouse_id)
    VALUES (v_tenant, v_line.item_id, 'return', -v_line.qty, 0,
      'purchase_return', v_pr.id, 'PR '||v_pr.pr_number, v_pr.return_date, v_line.warehouse_id)
    RETURNING id INTO v_mov_id;

    IF v_item.valuation_method = 'fifo' THEN
      v_fifo := public.consume_inventory_fifo(v_line.item_id, v_line.qty, v_mov_id, 'purchase_return', v_pr.id, v_pr.return_date);
      v_cost := round((v_fifo->>'total_cost')::numeric, 2);
    ELSE
      v_cost := round(v_line.qty * COALESCE(NULLIF(v_line.unit_cost,0), v_item.unit_cost), 2);
    END IF;

    UPDATE public.stock_movements SET unit_cost = round(v_cost / v_line.qty, 6), total_cost = v_cost WHERE id = v_mov_id;
    UPDATE public.purchase_return_lines SET unit_cost = round(v_cost / v_line.qty, 6), line_total = v_cost WHERE id = v_line.id;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_offset, v_cost, 0),
           (v_je, v_item.account_id, 0, v_cost);
    v_total := v_total + v_cost;
  END LOOP;

  IF v_lines = 0 THEN RAISE EXCEPTION 'Purchase Return must have at least one line'; END IF;

  UPDATE public.purchase_returns
  SET status='posted', posted_at=now(), journal_entry_id=v_je, total_amount=v_total
  WHERE id=p_id;

  RETURN jsonb_build_object('ok',true,'pr_id',p_id,'journal_entry_id',v_je,'total',v_total);
END $$;
