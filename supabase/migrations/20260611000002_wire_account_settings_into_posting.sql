-- ── Fix 1: post_grn — read GRNI from account_settings first ──────────────────
-- Current code: SELECT id FROM accounts WHERE account_code = '2150'
-- New pattern: check account_settings.grni_clearing_account_id, fall back to code.

CREATE OR REPLACE FUNCTION public.post_grn(p_grn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_grn goods_receipt_notes%ROWTYPE;
  v_grni uuid;
  v_je uuid;
  v_line RECORD; v_item inventory_items%ROWTYPE;
  v_total numeric(18,2):=0; v_lines_count int:=0;
  v_new_qty numeric(18,4); v_old_qty numeric(18,4); v_new_avg numeric(18,6);
  v_settings RECORD;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_grn FROM public.goods_receipt_notes WHERE id=p_grn_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF v_grn.status<>'draft' THEN RAISE EXCEPTION 'Only draft GRNs can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_grn.receipt_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_grn.receipt_date;
  END IF;

  -- Resolve GRNI: account_settings first, fallback to code 2150
  SELECT * INTO v_settings FROM public.account_settings WHERE tenant_id=v_tenant LIMIT 1;
  v_grni := v_settings.grni_clearing_account_id;
  IF v_grni IS NULL THEN
    SELECT id INTO v_grni FROM public.accounts
    WHERE tenant_id=v_tenant AND account_code='2150' AND is_active=true LIMIT 1;
  END IF;
  IF v_grni IS NULL THEN
    PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts
    WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  END IF;
  IF v_grni IS NULL THEN
    RAISE EXCEPTION 'GRNI Clearing account not configured. Set it in Settings → Account Mapping.';
  END IF;

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
    SET unit_cost=v_new_avg, quantity_on_hand=v_new_qty,
        last_purchase_price=v_line.unit_cost, updated_at=now()
    WHERE id=v_line.item_id;

    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_item.account_id, v_line.line_total, 0);

    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE public.purchase_order_lines SET qty_received = qty_received + v_line.qty_received WHERE id = v_line.po_line_id;
    END IF;
    v_total := v_total + v_line.line_total;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'GRN must have at least one line'; END IF;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (v_je, v_grni, 0, v_total);

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


-- ── Fix 2: post_supplier_bill — read GRNI + PPV from account_settings first ──

CREATE OR REPLACE FUNCTION public.post_supplier_bill(p_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_bill supplier_bills%ROWTYPE;
  v_grni uuid; v_ap uuid; v_ppv uuid;
  v_je uuid; v_ap_line_id uuid;
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

  SELECT * INTO v_settings FROM public.account_settings WHERE tenant_id=v_tenant LIMIT 1;

  -- Resolve AP: account_settings first, fallback by subtype
  v_ap := v_settings.ap_account_id;
  IF v_ap IS NULL THEN
    SELECT id INTO v_ap FROM public.accounts
    WHERE tenant_id=v_tenant AND account_type='Liability'
      AND lower(account_subtype) LIKE '%payable%' AND is_active LIMIT 1;
  END IF;
  IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts Payable not configured. Set it in Settings → Account Mapping.'; END IF;

  -- Resolve GRNI: account_settings first, fallback to code 2150
  v_grni := v_settings.grni_clearing_account_id;
  IF v_grni IS NULL THEN
    SELECT id INTO v_grni FROM public.accounts
    WHERE tenant_id=v_tenant AND account_code='2150' AND is_active=true LIMIT 1;
  END IF;
  IF v_grni IS NULL THEN
    PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  END IF;

  -- Resolve PPV: account_settings first, fallback to code 5100
  v_ppv := v_settings.purchase_price_variance_account_id;
  IF v_ppv IS NULL THEN
    SELECT id INTO v_ppv FROM public.accounts
    WHERE tenant_id=v_tenant AND account_code='5100' AND is_active=true LIMIT 1;
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

      IF v_grni IS NULL THEN
        RAISE EXCEPTION 'GRNI Clearing account not configured. Set it in Settings → Account Mapping.';
      END IF;
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
      VALUES (v_je, v_grni, v_grn_value, 0);
      v_dr_total := v_dr_total + v_grn_value;

      IF v_variance <> 0 THEN
        IF v_ppv IS NULL THEN
          RAISE EXCEPTION 'Purchase Price Variance account not configured. Set it in Settings → Account Mapping.';
        END IF;
        IF v_variance > 0 THEN
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
          VALUES (v_je, v_ppv, v_variance, 0);
          v_dr_total := v_dr_total + v_variance;
        ELSE
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
          VALUES (v_je, v_ppv, 0, -v_variance);
          v_dr_total := v_dr_total + v_variance;
        END IF;
      END IF;

      UPDATE public.grn_lines SET qty_billed = qty_billed + v_line.qty WHERE id = v_grnline.id;
    ELSE
      IF v_line.account_id IS NULL THEN
        RAISE EXCEPTION 'Line % requires a GRN link or an expense account_id', v_lines_count;
      END IF;
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
      VALUES (v_je, v_line.account_id, v_bill_value, 0);
      v_dr_total := v_dr_total + v_bill_value;
    END IF;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'Bill must have at least one line'; END IF;

  IF v_bill.tax_amount > 0 AND v_settings.tax_payable_account_id IS NOT NULL THEN
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_settings.tax_payable_account_id, v_bill.tax_amount, 0);
    v_dr_total := v_dr_total + v_bill.tax_amount;
  END IF;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (v_je, v_ap, 0, v_bill.total_amount)
  RETURNING id INTO v_ap_line_id;

  IF abs(v_dr_total - v_bill.total_amount) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry out of balance. Debits=% AP credit=%. Check tax/PPV configuration.',
      v_dr_total, v_bill.total_amount;
  END IF;

  UPDATE public.supplier_bills
  SET status='posted', posted_at=now(), journal_entry_id=v_je
  WHERE id=p_bill_id;

  RETURN jsonb_build_object('ok',true,'bill_id',p_bill_id,'journal_entry_id',v_je,'total',v_bill.total_amount);
END $$;
