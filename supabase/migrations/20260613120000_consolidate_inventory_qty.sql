-- ============================================================================
-- Consolidate inventory_items.quantity_on_hand to a SINGLE source of truth.
--
-- Problem: qoh was maintained by THREE contradictory writers at once:
--   1. trg_sync_inventory_qty (20260429)  — absolute recompute  (SUM movements)
--   2. trg_apply_stock_movement (20260605) — incremental delta   (qoh ± NEW.qty)
--   3. manual UPDATE ... SET quantity_on_hand in receive_inventory / post_grn /
--      post_assembly_order (two writes).
--
-- Fix (hybrid model):
--   * Keep ONE incremental trigger (trg_apply_stock_movement) as the sole writer.
--   * Repurpose the absolute logic into an on-demand reconcile RPC (integrity
--     backstop), drop the absolute trigger.
--   * Strip ALL manual quantity_on_hand writes from posting functions; they own
--     unit_cost / WAC only.
--   * One-time reconcile to correct existing drift.
-- ============================================================================

BEGIN;

-- ── 1a. Drop the redundant absolute-recompute trigger ───────────────────────
DROP TRIGGER IF EXISTS trg_sync_inventory_qty ON public.stock_movements;

-- ── 1b. Repurpose recompute logic as an on-demand reconcile RPC ─────────────
DROP FUNCTION IF EXISTS public.sync_inventory_qty_on_movement() CASCADE;

CREATE OR REPLACE FUNCTION public.reconcile_inventory_qty(p_item_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_fixed int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  WITH sums AS (
    SELECT sm.item_id, COALESCE(SUM(sm.quantity),0) AS total
    FROM public.stock_movements sm
    WHERE sm.tenant_id = v_tenant AND (p_item_id IS NULL OR sm.item_id = p_item_id)
    GROUP BY sm.item_id
  ),
  targets AS (
    SELECT i.id AS item_id, COALESCE(s.total,0) AS total
    FROM public.inventory_items i
    LEFT JOIN sums s ON s.item_id = i.id
    WHERE i.tenant_id = v_tenant AND (p_item_id IS NULL OR i.id = p_item_id)
  ),
  upd AS (
    UPDATE public.inventory_items i
       SET quantity_on_hand = t.total, updated_at = now()
      FROM targets t
     WHERE i.id = t.item_id AND i.quantity_on_hand IS DISTINCT FROM t.total
    RETURNING i.id
  )
  SELECT count(*) INTO v_fixed FROM upd;
  RETURN jsonb_build_object('ok', true, 'items_corrected', v_fixed);
END $$;

GRANT EXECUTE ON FUNCTION public.reconcile_inventory_qty(uuid) TO authenticated;
COMMENT ON FUNCTION public.reconcile_inventory_qty(uuid) IS
  'Integrity backstop: recompute quantity_on_hand = SUM(stock_movements.quantity). '
  'Pass an item id for one item, NULL for the whole tenant. The incremental trigger '
  'maintains qoh in real time; this corrects out-of-band drift. Safe to run on a schedule.';

-- ── 1c. receive_inventory — recreate WITHOUT the quantity_on_hand write ──────
CREATE OR REPLACE FUNCTION public.receive_inventory(
  p_inventory_item_id uuid, p_quantity numeric, p_unit_cost numeric,
  p_payment_account_id uuid, p_receipt_date date DEFAULT CURRENT_DATE,
  p_reference text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid; v_tenant_id uuid; v_item inventory_items%ROWTYPE;
  v_asset_account uuid; v_credit_account accounts%ROWTYPE;
  v_old_qty numeric; v_new_qty numeric; v_new_avg numeric; v_total numeric;
  v_je_id uuid; v_mov_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN RAISE EXCEPTION 'Unit cost must be >= 0'; END IF;

  SELECT * INTO v_item FROM inventory_items WHERE id = p_inventory_item_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found in tenant'; END IF;
  v_asset_account := v_item.account_id;
  IF v_asset_account IS NULL THEN RAISE EXCEPTION 'Inventory item "%" has no asset account configured', v_item.item_name; END IF;

  SELECT * INTO v_credit_account FROM accounts WHERE id = p_payment_account_id AND tenant_id = v_tenant_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment/AP account invalid or inactive'; END IF;
  IF v_credit_account.account_type NOT IN ('Asset','Liability') THEN
    RAISE EXCEPTION 'Receipt credit account must be Cash/Bank (Asset) or AP (Liability)'; END IF;

  v_total := round(p_quantity * p_unit_cost, 2);
  SELECT COALESCE(SUM(quantity),0) INTO v_old_qty FROM stock_movements WHERE item_id = p_inventory_item_id;
  v_new_qty := v_old_qty + p_quantity;
  IF v_old_qty <= 0 THEN v_new_avg := p_unit_cost;
  ELSE v_new_avg := round(((v_old_qty*COALESCE(v_item.unit_cost,0))+(p_quantity*p_unit_cost))/v_new_qty,6); END IF;

  INSERT INTO stock_movements (tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,movement_date)
  VALUES (v_tenant_id,p_inventory_item_id,'purchase',p_quantity,p_unit_cost,'inventory_receipt',gen_random_uuid(),p_notes,p_receipt_date)
  RETURNING id INTO v_mov_id;

  -- unit_cost ONLY; quantity_on_hand maintained by trg_apply_stock_movement
  UPDATE inventory_items SET unit_cost = v_new_avg, updated_at = now() WHERE id = p_inventory_item_id;

  INSERT INTO journal_entries (tenant_id,entry_date,description,reference,status,posted_at,created_by,source_type,source_id,is_system_generated,entry_type)
  VALUES (v_tenant_id,p_receipt_date,'Inventory receipt: '||v_item.item_name||' x '||p_quantity,
    COALESCE(p_reference,'RCV-'||to_char(now(),'YYYYMMDDHH24MISS')),'posted',now(),v_user_id,'inventory_receipt',v_mov_id,true,'inventory_receipt')
  RETURNING id INTO v_je_id;
  INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES
    (v_je_id,v_asset_account,v_total,0),(v_je_id,p_payment_account_id,0,v_total);

  RETURN jsonb_build_object('ok',true,'movement_id',v_mov_id,'journal_id',v_je_id,'new_avg_cost',v_new_avg,'new_qty',v_new_qty,'total',v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.receive_inventory(uuid,numeric,numeric,uuid,date,text,text) TO authenticated;

-- ── 1d. post_grn (account_settings-aware, live 20260611 body) — WITHOUT qoh ──
CREATE OR REPLACE FUNCTION public.post_grn(p_grn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_grn goods_receipt_notes%ROWTYPE; v_grni uuid; v_je uuid;
  v_line RECORD; v_item inventory_items%ROWTYPE; v_total numeric(18,2):=0; v_lines_count int:=0;
  v_new_qty numeric(18,4); v_old_qty numeric(18,4); v_new_avg numeric(18,6); v_settings RECORD;
BEGIN
  SELECT id,tenant_id INTO v_user,v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_grn FROM public.goods_receipt_notes WHERE id=p_grn_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF v_grn.status<>'draft' THEN RAISE EXCEPTION 'Only draft GRNs can be posted'; END IF;
  IF public.is_period_closed(v_tenant,v_grn.receipt_date) THEN RAISE EXCEPTION 'Accounting period for % is closed.',v_grn.receipt_date; END IF;

  SELECT * INTO v_settings FROM public.account_settings WHERE tenant_id=v_tenant LIMIT 1;
  v_grni := v_settings.grni_clearing_account_id;
  IF v_grni IS NULL THEN SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' AND is_active=true LIMIT 1; END IF;
  IF v_grni IS NULL THEN PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1; END IF;
  IF v_grni IS NULL THEN RAISE EXCEPTION 'GRNI Clearing account not configured. Set it in Settings → Account Mapping.'; END IF;

  INSERT INTO public.journal_entries(tenant_id,entry_date,description,reference,status,posted_at,created_by,source_type,source_id,is_system_generated,entry_type)
  VALUES (v_tenant,v_grn.receipt_date,'Goods Receipt '||v_grn.grn_number,v_grn.grn_number,'posted',now(),v_user,'grn',v_grn.id,true,'grn')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.grn_lines WHERE grn_id=p_grn_id ORDER BY created_at LOOP
    v_lines_count := v_lines_count+1;
    SELECT * INTO v_item FROM public.inventory_items WHERE id=v_line.item_id AND tenant_id=v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
    IF NOT v_item.is_active THEN RAISE EXCEPTION 'Item % is inactive', v_item.item_name; END IF;
    IF v_item.account_id IS NULL THEN RAISE EXCEPTION 'Item % has no Inventory Asset account', v_item.item_name; END IF;

    INSERT INTO public.stock_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,movement_date)
    VALUES (v_tenant,v_line.item_id,'purchase',v_line.qty_received,v_line.unit_cost,'grn',v_grn.id,'GRN '||v_grn.grn_number,v_grn.receipt_date);

    SELECT COALESCE(SUM(quantity),0) INTO v_new_qty FROM public.stock_movements WHERE item_id=v_line.item_id;
    v_old_qty := v_new_qty - v_line.qty_received;
    IF v_old_qty <= 0 THEN v_new_avg := v_line.unit_cost;
    ELSE v_new_avg := round(((v_old_qty*COALESCE(v_item.unit_cost,0))+(v_line.qty_received*v_line.unit_cost))/v_new_qty,6); END IF;

    -- unit_cost + last_purchase_price ONLY (NOT quantity_on_hand)
    UPDATE public.inventory_items SET unit_cost=v_new_avg, last_purchase_price=v_line.unit_cost, updated_at=now() WHERE id=v_line.item_id;

    IF v_item.valuation_method = 'fifo' THEN
      INSERT INTO public.stock_lots(tenant_id,item_id,lot_number,receipt_date,qty_received,qty_remaining,unit_cost,source_type,source_id,notes)
      VALUES (v_tenant,v_line.item_id,public.generate_lot_number(v_tenant,v_line.item_id),v_grn.receipt_date,v_line.qty_received,v_line.qty_received,v_line.unit_cost,'grn',v_grn.id,'GRN '||v_grn.grn_number);
    END IF;

    INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit) VALUES (v_je,v_item.account_id,v_line.line_total,0);
    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE public.purchase_order_lines SET qty_received=qty_received+v_line.qty_received WHERE id=v_line.po_line_id; END IF;
    v_total := v_total + v_line.line_total;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'GRN must have at least one line'; END IF;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit) VALUES (v_je,v_grni,0,v_total);
  UPDATE public.goods_receipt_notes SET status='posted',posted_at=now(),journal_entry_id=v_je,total_value=v_total WHERE id=p_grn_id;
  IF v_grn.po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po SET status = CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.purchase_order_lines l WHERE l.po_id=po.id AND l.qty_received < l.qty_ordered) THEN 'received' ELSE 'partial' END
    WHERE po.id=v_grn.po_id; END IF;
  RETURN jsonb_build_object('ok',true,'grn_id',p_grn_id,'journal_entry_id',v_je,'total',v_total);
END $$;

-- ── 1e. post_assembly_order — recreate WITHOUT both qoh writes ───────────────
-- Critical sequencing: FG WAC must NOT read quantity_on_hand after the component
-- consume movements have already decremented it in-transaction. Capture the FG's
-- pre-receipt on-hand from SUM(stock_movements) into v_fg_old_qty before inserting
-- the FG receipt movement, and compute WAC from that variable.
CREATE OR REPLACE FUNCTION public.post_assembly_order(p_ao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ao record; v_comp record; v_fg record;
  v_inv_acct uuid; v_labor_acct uuid; v_oh_acct uuid;
  v_je_id uuid; v_total_comp numeric := 0; v_total numeric := 0; v_unit_cost numeric;
  v_mov_id uuid; v_fifo jsonb; v_cost numeric;
  v_fg_old_qty numeric;   -- pre-receipt on-hand for WAC (NOT read from the column)
BEGIN
  SELECT * INTO v_ao FROM public.assembly_orders WHERE id = p_ao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assembly order not found'; END IF;
  IF v_ao.status <> 'draft' THEN RAISE EXCEPTION 'Only draft assembly orders can be posted'; END IF;
  SELECT * INTO v_fg FROM public.inventory_items WHERE id = v_ao.fg_item_id;
  SELECT id INTO v_inv_acct FROM public.accounts WHERE tenant_id=v_ao.tenant_id AND account_code='1200' LIMIT 1;
  IF v_inv_acct IS NULL THEN RAISE EXCEPTION 'Inventory account 1200 not found'; END IF;
  SELECT id INTO v_labor_acct FROM public.accounts WHERE tenant_id=v_ao.tenant_id AND account_code='5110' LIMIT 1;
  SELECT id INTO v_oh_acct FROM public.accounts WHERE tenant_id=v_ao.tenant_id AND account_code='5120' LIMIT 1;

  INSERT INTO public.journal_entries (tenant_id,entry_date,description,status,source_type,source_id)
  VALUES (v_ao.tenant_id,v_ao.ao_date,'Assembly Order '||v_ao.ao_number,'posted','assembly_order',v_ao.id)
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
    INSERT INTO public.stock_movements (tenant_id,item_id,movement_date,movement_type,quantity,reference_type,reference_id,warehouse_id)
    VALUES (v_ao.tenant_id,v_comp.component_item_id,v_ao.ao_date,'assembly_consume',-v_comp.qty_required,'assembly_order',v_ao.id,v_ao.warehouse_id)
    RETURNING id INTO v_mov_id;
    IF v_comp.valuation_method = 'fifo' THEN
      v_fifo := public.consume_inventory_fifo(v_comp.component_item_id,v_comp.qty_required,v_mov_id,'assembly_order',v_ao.id,v_ao.ao_date);
      v_cost := round((v_fifo->>'total_cost')::numeric,2);
    ELSE
      v_cost := round(v_comp.qty_required * COALESCE(v_comp.wac_cost,0),2);
    END IF;
    -- NO manual quantity_on_hand write; the -qty movement + trigger handle it.
    UPDATE public.assembly_order_lines
       SET unit_cost = CASE WHEN v_comp.qty_required>0 THEN round(v_cost/v_comp.qty_required,4) ELSE 0 END,
           total_cost = v_cost
     WHERE id = v_comp.id;
    IF v_cost > 0 THEN
      INSERT INTO public.journal_lines (tenant_id,journal_entry_id,account_id,debit,credit,description)
      VALUES (v_ao.tenant_id,v_je_id,v_inv_acct,0,v_cost,'Consume '||v_comp.item_name);
    END IF;
    v_total_comp := v_total_comp + v_cost;
  END LOOP;

  v_total := v_total_comp + COALESCE(v_ao.labor_cost,0) + COALESCE(v_ao.overhead_cost,0);
  v_unit_cost := CASE WHEN v_ao.output_qty>0 THEN round(v_total/v_ao.output_qty,4) ELSE 0 END;

  IF COALESCE(v_ao.labor_cost,0)>0 AND v_labor_acct IS NOT NULL THEN
    INSERT INTO public.journal_lines (tenant_id,journal_entry_id,account_id,debit,credit,description)
    VALUES (v_ao.tenant_id,v_je_id,v_labor_acct,0,v_ao.labor_cost,'Direct labor applied'); END IF;
  IF COALESCE(v_ao.overhead_cost,0)>0 AND v_oh_acct IS NOT NULL THEN
    INSERT INTO public.journal_lines (tenant_id,journal_entry_id,account_id,debit,credit,description)
    VALUES (v_ao.tenant_id,v_je_id,v_oh_acct,0,v_ao.overhead_cost,'Mfg overhead applied'); END IF;
  IF v_total>0 THEN
    INSERT INTO public.journal_lines (tenant_id,journal_entry_id,account_id,debit,credit,description)
    VALUES (v_ao.tenant_id,v_je_id,v_inv_acct,v_total,0,'Assemble '||v_fg.item_name); END IF;

  -- Capture FG pre-receipt on-hand from the movement ledger (reflects component
  -- consumes already applied, but NOT the about-to-be-inserted FG receipt).
  SELECT COALESCE(SUM(quantity),0) INTO v_fg_old_qty FROM public.stock_movements WHERE item_id = v_ao.fg_item_id;

  INSERT INTO public.stock_movements (tenant_id,item_id,movement_date,movement_type,quantity,reference_type,reference_id,warehouse_id,unit_cost)
  VALUES (v_ao.tenant_id,v_ao.fg_item_id,v_ao.ao_date,'assembly_receipt',v_ao.output_qty,'assembly_order',v_ao.id,v_ao.warehouse_id,v_unit_cost)
  RETURNING id INTO v_mov_id;

  IF v_fg.valuation_method = 'fifo' THEN
    INSERT INTO public.stock_lots (tenant_id,item_id,receipt_date,qty_received,qty_remaining,unit_cost,source_type,source_id)
    VALUES (v_ao.tenant_id,v_ao.fg_item_id,v_ao.ao_date,v_ao.output_qty,v_ao.output_qty,v_unit_cost,'assembly_order',v_ao.id);
  ELSE
    -- WAC from captured pre-receipt qty (NOT the column); unit_cost ONLY.
    UPDATE public.inventory_items
       SET unit_cost = CASE WHEN (v_fg_old_qty + v_ao.output_qty) > 0
         THEN round(((v_fg_old_qty * COALESCE(unit_cost,0)) + v_total) / (v_fg_old_qty + v_ao.output_qty), 4)
         ELSE v_unit_cost END,
           updated_at = now()
     WHERE id = v_ao.fg_item_id;
  END IF;
  -- NO manual quantity_on_hand += output_qty; the +output_qty movement + trigger handle it.

  UPDATE public.assembly_orders
     SET status='posted', component_cost=v_total_comp, total_cost=v_total, unit_cost=v_unit_cost,
         journal_entry_id=v_je_id, posted_at=now(), posted_by=auth.uid(), updated_at=now()
   WHERE id = p_ao_id;

  RETURN jsonb_build_object('ok',true,'journal_entry_id',v_je_id,'total_cost',v_total,'unit_cost',v_unit_cost);
END $$;

-- ── 1g. One-time reconcile (maintenance pass, all tenants) ──────────────────
UPDATE public.inventory_items i
   SET quantity_on_hand = COALESCE(s.total,0), updated_at = now()
  FROM (SELECT item_id, SUM(quantity) AS total FROM public.stock_movements GROUP BY item_id) s
 WHERE i.id = s.item_id AND i.quantity_on_hand IS DISTINCT FROM COALESCE(s.total,0);

UPDATE public.inventory_items i
   SET quantity_on_hand = 0, updated_at = now()
 WHERE NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.item_id = i.id)
   AND i.quantity_on_hand IS DISTINCT FROM 0;

COMMIT;
