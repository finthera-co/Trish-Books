-- ============================================================================
-- INVENTORY MODULE PHASE 1 (corrected normal_balance handling)
-- ============================================================================

-- 1. EXTEND inventory_items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS item_code              text,
  ADD COLUMN IF NOT EXISTS category                text,
  ADD COLUMN IF NOT EXISTS sub_category            text,
  ADD COLUMN IF NOT EXISTS uom_primary             text DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS uom_secondary           text,
  ADD COLUMN IF NOT EXISTS uom_conversion_factor   numeric(18,6) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS valuation_method        text NOT NULL DEFAULT 'weighted_average',
  ADD COLUMN IF NOT EXISTS reorder_level           numeric(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_quantity        numeric(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock_level         numeric(18,4),
  ADD COLUMN IF NOT EXISTS standard_cost           numeric(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_price     numeric(18,4),
  ADD COLUMN IF NOT EXISTS selling_price           numeric(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_id                  uuid,
  ADD COLUMN IF NOT EXISTS cogs_account_id         uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS purchase_account_id     uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS purchase_return_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS sales_return_account_id   uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS adjustment_account_id     uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS is_active               boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes                   text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_items_valuation_method_chk') THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_valuation_method_chk
      CHECK (valuation_method IN ('weighted_average','fifo','lifo'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_tenant_item_code_uniq
  ON public.inventory_items(tenant_id, item_code) WHERE item_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_item_code(p_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'ITM-' || LPAD((COALESCE(
    (SELECT COUNT(*)::int + 1 FROM public.inventory_items WHERE tenant_id=p_tenant_id),1))::text,5,'0');
$$;

CREATE OR REPLACE FUNCTION public.set_inventory_item_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.item_code IS NULL OR NEW.item_code='' THEN
    NEW.item_code := public.generate_item_code(NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_inventory_item_code ON public.inventory_items;
CREATE TRIGGER trg_set_inventory_item_code BEFORE INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_item_code();

CREATE OR REPLACE FUNCTION public.validate_inventory_item_mappings()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.is_active THEN
    IF NEW.account_id IS NULL THEN
      RAISE EXCEPTION 'Item must be linked to an Inventory Asset Account in the Chart of Accounts before it can be activated.';
    END IF;
    IF NEW.cogs_account_id IS NULL THEN
      RAISE EXCEPTION 'Item must be linked to a Cost of Goods Sold (COGS) account before it can be activated.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_inventory_item_mappings ON public.inventory_items;
CREATE TRIGGER trg_validate_inventory_item_mappings BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_item_mappings();

-- 2. SEED STANDARD INVENTORY COA ACCOUNTS (correct normal_balance per type)
CREATE OR REPLACE FUNCTION public.seed_inventory_coa_accounts(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_specs jsonb := '[
    {"code":"1300","name":"Inventory / Stock","type":"Asset","subtype":"Inventory","contra":false,"nb":"debit"},
    {"code":"2150","name":"Goods Received Not Invoiced","type":"Liability","subtype":"Accrued Liability","contra":false,"nb":"credit"},
    {"code":"5000","name":"Cost of Goods Sold","type":"Cost of Goods Sold","subtype":"COGS","contra":false,"nb":"debit"},
    {"code":"5100","name":"Purchase Price Variance","type":"Expense","subtype":"Operating Expense","contra":false,"nb":"debit"},
    {"code":"5200","name":"Inventory Write-Down","type":"Expense","subtype":"Operating Expense","contra":false,"nb":"debit"},
    {"code":"5210","name":"Inventory Write-Off","type":"Expense","subtype":"Operating Expense","contra":false,"nb":"debit"},
    {"code":"4200","name":"Sales Returns & Allowances","type":"Income","subtype":"Sales","contra":true,"nb":"debit"},
    {"code":"5300","name":"Purchase Returns","type":"Expense","subtype":"Operating Expense","contra":true,"nb":"credit"}
  ]'::jsonb;
  v_spec jsonb;
BEGIN
  FOR v_spec IN SELECT * FROM jsonb_array_elements(v_specs)
  LOOP
    INSERT INTO public.accounts(
      tenant_id, account_code, account_name, account_type, account_subtype,
      is_active, is_system, opening_balance, opening_balance_type, normal_balance,
      is_contra
    )
    SELECT p_tenant_id,
           v_spec->>'code',
           v_spec->>'name',
           v_spec->>'type',
           v_spec->>'subtype',
           true, true, 0,
           v_spec->>'nb',
           v_spec->>'nb',
           (v_spec->>'contra')::boolean
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND account_code=v_spec->>'code');
  END LOOP;
END $$;

-- 3. PURCHASE ORDERS
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  po_number text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partial','received','closed','cancelled')),
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'LKR',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, po_number)
);
CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  description text,
  qty_ordered numeric(18,4) NOT NULL CHECK (qty_ordered > 0),
  qty_received numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
  tax_id uuid,
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON public.purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_item ON public.purchase_order_lines(item_id);

CREATE OR REPLACE FUNCTION public.generate_po_number(p_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'PO-' || LPAD((COALESCE((SELECT COUNT(*)::int+1 FROM public.purchase_orders WHERE tenant_id=p_tenant_id),1))::text,5,'0');
$$;
CREATE OR REPLACE FUNCTION public.set_po_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number='' THEN NEW.po_number := public.generate_po_number(NEW.tenant_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_po_number ON public.purchase_orders;
CREATE TRIGGER trg_set_po_number BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_po_number();

-- 4. GRN
CREATE TABLE IF NOT EXISTS public.goods_receipt_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  grn_number text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  po_id uuid REFERENCES public.purchase_orders(id),
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  total_value numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  notes text,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, grn_number)
);
CREATE TABLE IF NOT EXISTS public.grn_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  grn_id uuid NOT NULL REFERENCES public.goods_receipt_notes(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES public.purchase_order_lines(id),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  qty_received numeric(18,4) NOT NULL CHECK (qty_received > 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  qty_billed numeric(18,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grn_lines_grn ON public.grn_lines(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_item ON public.grn_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line ON public.grn_lines(po_line_id);

CREATE OR REPLACE FUNCTION public.generate_grn_number(p_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'GRN-' || LPAD((COALESCE((SELECT COUNT(*)::int+1 FROM public.goods_receipt_notes WHERE tenant_id=p_tenant_id),1))::text,5,'0');
$$;
CREATE OR REPLACE FUNCTION public.set_grn_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.grn_number IS NULL OR NEW.grn_number='' THEN NEW.grn_number := public.generate_grn_number(NEW.tenant_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_grn_number ON public.goods_receipt_notes;
CREATE TRIGGER trg_set_grn_number BEFORE INSERT ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_grn_number();

-- 5. SUPPLIER BILLS
CREATE TABLE IF NOT EXISTS public.supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bill_number text NOT NULL,
  vendor_ref text,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid','cancelled','reversed')),
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  notes text,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bill_number)
);
CREATE TABLE IF NOT EXISTS public.supplier_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bill_id uuid NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  grn_line_id uuid REFERENCES public.grn_lines(id),
  item_id uuid REFERENCES public.inventory_items(id),
  account_id uuid REFERENCES public.accounts(id),
  description text,
  qty numeric(18,4) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sbl_bill ON public.supplier_bill_lines(bill_id);
CREATE INDEX IF NOT EXISTS idx_sbl_grnline ON public.supplier_bill_lines(grn_line_id);

CREATE OR REPLACE FUNCTION public.generate_bill_number(p_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'BILL-' || LPAD((COALESCE((SELECT COUNT(*)::int+1 FROM public.supplier_bills WHERE tenant_id=p_tenant_id),1))::text,5,'0');
$$;
CREATE OR REPLACE FUNCTION public.set_bill_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.bill_number IS NULL OR NEW.bill_number='' THEN NEW.bill_number := public.generate_bill_number(NEW.tenant_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_bill_number ON public.supplier_bills;
CREATE TRIGGER trg_set_bill_number BEFORE INSERT ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.set_bill_number();

-- 6. updated_at triggers
DROP TRIGGER IF EXISTS trg_po_updated_at ON public.purchase_orders;
CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_grn_updated_at ON public.goods_receipt_notes;
CREATE TRIGGER trg_grn_updated_at BEFORE UPDATE ON public.goods_receipt_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_bill_updated_at ON public.supplier_bills;
CREATE TRIGGER trg_bill_updated_at BEFORE UPDATE ON public.supplier_bills FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. period helper
CREATE OR REPLACE FUNCTION public.is_period_closed(p_tenant_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.fiscal_periods
    WHERE tenant_id=p_tenant_id AND status='closed' AND p_date BETWEEN period_start AND period_end);
$$;

-- 8. POST GRN
CREATE OR REPLACE FUNCTION public.post_grn(p_grn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_grn goods_receipt_notes%ROWTYPE;
  v_grni uuid; v_je uuid;
  v_total numeric(18,2):=0;
  v_line RECORD; v_item inventory_items%ROWTYPE;
  v_old_qty numeric; v_new_qty numeric; v_new_avg numeric;
  v_lines_count int:=0;
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
      'grn', v_grn.id, 'GRN '||v_grn.grn_number, v_grn.receipt_date);

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

-- 9. POST SUPPLIER BILL
CREATE OR REPLACE FUNCTION public.post_supplier_bill(p_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_bill supplier_bills%ROWTYPE;
  v_grni uuid; v_ap uuid; v_ppv uuid;
  v_je uuid;
  v_line RECORD; v_grnline grn_lines%ROWTYPE;
  v_grn_value numeric(18,2); v_bill_value numeric(18,2); v_variance numeric(18,2);
  v_total numeric(18,2):=0; v_lines_count int:=0;
  v_dr_total numeric(18,2):=0;
  v_settings RECORD;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_bill FROM public.supplier_bills WHERE id=p_bill_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.status<>'draft' THEN RAISE EXCEPTION 'Only draft bills can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_bill.bill_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_bill.bill_date;
  END IF;

  SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  SELECT id INTO v_ppv  FROM public.accounts WHERE tenant_id=v_tenant AND account_code='5100' LIMIT 1;
  SELECT * INTO v_settings FROM public.account_settings WHERE tenant_id=v_tenant LIMIT 1;
  v_ap := v_settings.ap_account_id;
  IF v_ap IS NULL THEN
    SELECT id INTO v_ap FROM public.accounts
    WHERE tenant_id=v_tenant AND account_type='Liability' AND lower(account_subtype) LIKE '%payable%' AND is_active LIMIT 1;
  END IF;
  IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts Payable not configured. Set it in Account Mapping.'; END IF;
  IF v_grni IS NULL THEN
    PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_bill.bill_date, 'Supplier Bill '||v_bill.bill_number, v_bill.bill_number,
    'posted', now(), v_user, 'supplier_bill', v_bill.id, true, 'supplier_bill')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.supplier_bill_lines WHERE bill_id=p_bill_id ORDER BY created_at LOOP
    v_lines_count := v_lines_count + 1;
    v_bill_value := round(v_line.qty * v_line.unit_cost, 2);
    v_total := v_total + v_bill_value;

    IF v_line.grn_line_id IS NOT NULL THEN
      SELECT * INTO v_grnline FROM public.grn_lines WHERE id=v_line.grn_line_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'GRN line not found for line %', v_lines_count; END IF;
      IF v_grnline.tenant_id<>v_tenant THEN RAISE EXCEPTION 'GRN line tenant mismatch'; END IF;
      IF (v_grnline.qty_billed + v_line.qty) > v_grnline.qty_received + 0.0001 THEN
        RAISE EXCEPTION 'Three-way match failed line %: bill qty (%) + already billed (%) exceeds GRN received (%)',
          v_lines_count, v_line.qty, v_grnline.qty_billed, v_grnline.qty_received;
      END IF;

      v_grn_value := round(v_line.qty * v_grnline.unit_cost, 2);
      v_variance  := round(v_bill_value - v_grn_value, 2);

      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_grni, v_grn_value, 0);
      v_dr_total := v_dr_total + v_grn_value;

      IF v_variance <> 0 THEN
        IF v_ppv IS NULL THEN RAISE EXCEPTION 'PPV account (5100) not configured'; END IF;
        IF v_variance > 0 THEN
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_ppv, v_variance, 0);
          v_dr_total := v_dr_total + v_variance;
        ELSE
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_ppv, 0, -v_variance);
          v_dr_total := v_dr_total + v_variance; -- v_variance negative
        END IF;
      END IF;

      UPDATE public.grn_lines SET qty_billed = qty_billed + v_line.qty WHERE id = v_grnline.id;
    ELSE
      IF v_line.account_id IS NULL THEN RAISE EXCEPTION 'Line % requires GRN link or account_id', v_lines_count; END IF;
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_line.account_id, v_bill_value, 0);
      v_dr_total := v_dr_total + v_bill_value;
    END IF;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'Bill must have at least one line'; END IF;

  IF v_bill.tax_amount > 0 AND v_settings.tax_payable_account_id IS NOT NULL THEN
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_settings.tax_payable_account_id, v_bill.tax_amount, 0);
    v_dr_total := v_dr_total + v_bill.tax_amount;
  END IF;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_ap, 0, v_bill.total_amount);

  IF abs(v_dr_total - v_bill.total_amount) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry out of balance. Debits=% AP credit=%. Check tax/PPV configuration.', v_dr_total, v_bill.total_amount;
  END IF;

  UPDATE public.supplier_bills SET status='posted', posted_at=now(), journal_entry_id=v_je WHERE id=p_bill_id;

  RETURN jsonb_build_object('ok',true,'bill_id',p_bill_id,'journal_entry_id',v_je,'total',v_bill.total_amount);
END $$;

-- 10. RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grn_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bill_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_select" ON public.purchase_orders FOR SELECT USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "po_insert" ON public.purchase_orders FOR INSERT WITH CHECK (tenant_id=public.get_user_tenant_id());
CREATE POLICY "po_update" ON public.purchase_orders FOR UPDATE USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "po_delete" ON public.purchase_orders FOR DELETE USING (tenant_id=public.get_user_tenant_id() AND status IN ('draft','cancelled'));

CREATE POLICY "pol_select" ON public.purchase_order_lines FOR SELECT USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "pol_insert" ON public.purchase_order_lines FOR INSERT WITH CHECK (tenant_id=public.get_user_tenant_id());
CREATE POLICY "pol_update" ON public.purchase_order_lines FOR UPDATE USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "pol_delete" ON public.purchase_order_lines FOR DELETE USING (tenant_id=public.get_user_tenant_id());

CREATE POLICY "grn_select" ON public.goods_receipt_notes FOR SELECT USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "grn_insert" ON public.goods_receipt_notes FOR INSERT WITH CHECK (tenant_id=public.get_user_tenant_id());
CREATE POLICY "grn_update" ON public.goods_receipt_notes FOR UPDATE USING (tenant_id=public.get_user_tenant_id() AND status='draft');
CREATE POLICY "grn_delete" ON public.goods_receipt_notes FOR DELETE USING (tenant_id=public.get_user_tenant_id() AND status='draft');

CREATE POLICY "grnl_select" ON public.grn_lines FOR SELECT USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "grnl_insert" ON public.grn_lines FOR INSERT WITH CHECK (tenant_id=public.get_user_tenant_id());
CREATE POLICY "grnl_update" ON public.grn_lines FOR UPDATE USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "grnl_delete" ON public.grn_lines FOR DELETE USING (tenant_id=public.get_user_tenant_id());

CREATE POLICY "bill_select" ON public.supplier_bills FOR SELECT USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "bill_insert" ON public.supplier_bills FOR INSERT WITH CHECK (tenant_id=public.get_user_tenant_id());
CREATE POLICY "bill_update" ON public.supplier_bills FOR UPDATE USING (tenant_id=public.get_user_tenant_id() AND status='draft');
CREATE POLICY "bill_delete" ON public.supplier_bills FOR DELETE USING (tenant_id=public.get_user_tenant_id() AND status='draft');

CREATE POLICY "bl_select" ON public.supplier_bill_lines FOR SELECT USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "bl_insert" ON public.supplier_bill_lines FOR INSERT WITH CHECK (tenant_id=public.get_user_tenant_id());
CREATE POLICY "bl_update" ON public.supplier_bill_lines FOR UPDATE USING (tenant_id=public.get_user_tenant_id());
CREATE POLICY "bl_delete" ON public.supplier_bill_lines FOR DELETE USING (tenant_id=public.get_user_tenant_id());

-- 11. Block edits to posted documents
CREATE OR REPLACE FUNCTION public.block_posted_grn_edits()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.status='posted' THEN
    RAISE EXCEPTION 'Cannot delete posted GRN %. Reverse it instead.', OLD.grn_number;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='posted' AND NEW.status='posted' THEN
    IF NEW.grn_number IS DISTINCT FROM OLD.grn_number
       OR NEW.total_value IS DISTINCT FROM OLD.total_value
       OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
      RAISE EXCEPTION 'Posted GRN % is immutable.', OLD.grn_number;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_block_posted_grn ON public.goods_receipt_notes;
CREATE TRIGGER trg_block_posted_grn BEFORE UPDATE OR DELETE ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_grn_edits();

CREATE OR REPLACE FUNCTION public.block_posted_bill_edits()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.status IN ('posted','paid') THEN
    RAISE EXCEPTION 'Cannot delete posted bill %. Reverse it instead.', OLD.bill_number;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('posted','paid') THEN
    IF NEW.bill_number IS DISTINCT FROM OLD.bill_number
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.bill_date IS DISTINCT FROM OLD.bill_date
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
      RAISE EXCEPTION 'Posted bill % is immutable.', OLD.bill_number;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_block_posted_bill ON public.supplier_bills;
CREATE TRIGGER trg_block_posted_bill BEFORE UPDATE OR DELETE ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_bill_edits();

-- 12. Seed COA for existing tenants
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT id FROM public.tenants LOOP
    PERFORM public.seed_inventory_coa_accounts(r.id);
  END LOOP;
END $$;