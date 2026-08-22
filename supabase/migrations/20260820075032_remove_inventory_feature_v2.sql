-- ============================================================================
-- REMOVE INVENTORY FEATURE
-- Drops the inventory/procurement (items, stock, warehouses, PO/GRN, landed
-- costs, assembly/BOM, delivery notes, sales/purchase returns) subsystem in
-- full. Confirmed zero rows in every affected table/column before writing
-- this migration — no tenant data is destroyed.
--
-- Supplier Bills (supplier_bills / supplier_bill_lines) are NOT part of the
-- inventory feature and are kept for the core Accounts Payable "Bills" flow,
-- but their GRN 3-way-match linkage (grn_line_id, item_id) is removed since
-- Goods Receipt Notes no longer exist.
-- ============================================================================

-- 1. Drop triggers + trigger functions on tables that are staying, whose
--    logic only makes sense for the inventory feature.
DROP FUNCTION IF EXISTS public.validate_product_inventory_link() CASCADE;
DROP FUNCTION IF EXISTS public.snapshot_invoice_item_inventory() CASCADE;
DROP FUNCTION IF EXISTS public.bill_line_carry_tax() CASCADE;

-- 2. Rewrite post_supplier_bill: drop the GRN 3-way-match branch and the
--    item-based tax default lookup; every line now requires an account_id.
CREATE OR REPLACE FUNCTION public.post_supplier_bill(p_bill_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_user uuid;
  v_bill supplier_bills%ROWTYPE;
  v_profile tenant_tax_profiles%ROWTYPE;
  v_settings RECORD;
  v_ap uuid;
  v_je uuid; v_ap_line_id uuid;
  v_line RECORD;
  v_bill_value numeric(18,2);
  v_lines_count int := 0;
  v_dr_total numeric(18,2) := 0;
  v_ap_total numeric(18,2) := 0;
  v_subtotal numeric(18,2) := 0;
  v_tax_total numeric(18,2) := 0;
  v_has_line_tax boolean;
  v_m RECORD;
  v_factor numeric; v_prior_rates numeric; v_prior_tax numeric;
  v_excl_base numeric; v_member_base numeric; v_member_tax numeric;
  v_line_cost numeric;
  v_input_acct uuid;
  v_warnings text[] := '{}';
  v_eff_group uuid; v_eff_code uuid;
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
  SELECT * INTO v_profile FROM public.tenant_tax_profiles WHERE tenant_id=v_tenant LIMIT 1;

  -- Effective per-line tax (override → tenant default) drives whether ANY
  -- line on this bill carries tax.
  SELECT EXISTS (
    SELECT 1 FROM public.supplier_bill_lines sbl
    WHERE sbl.bill_id=p_bill_id AND (
      sbl.tax_code_id IS NOT NULL OR sbl.tax_group_id IS NOT NULL
      OR v_profile.default_purchase_tax_code_id IS NOT NULL
    )
  ) INTO v_has_line_tax;

  v_ap := v_settings.ap_account_id;
  IF v_ap IS NULL THEN
    SELECT id INTO v_ap FROM public.accounts
    WHERE tenant_id=v_tenant AND account_type='Liability'
      AND lower(account_subtype) LIKE '%payable%' AND is_active LIMIT 1;
  END IF;
  IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts Payable not configured. Set it in Settings → Account Mapping.'; END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_bill.bill_date, 'Supplier Bill '||v_bill.bill_number, v_bill.bill_number,
    'posted', now(), v_user, 'supplier_bill', v_bill.id, true, 'supplier_bill')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.supplier_bill_lines WHERE bill_id=p_bill_id ORDER BY created_at LOOP
    v_lines_count := v_lines_count + 1;
    v_bill_value := round(v_line.qty * v_line.unit_cost, 2);
    v_line_cost := v_bill_value;
    v_excl_base := v_bill_value;

    -- ── Two-tier purchase tax resolution (line override → tenant default) ──
    v_eff_group := v_line.tax_group_id;
    v_eff_code  := v_line.tax_code_id;
    IF v_eff_group IS NULL AND v_eff_code IS NULL THEN
      v_eff_code := v_profile.default_purchase_tax_code_id;
    END IF;

    IF v_eff_code IS NOT NULL OR v_eff_group IS NOT NULL THEN
      IF v_line.is_tax_inclusive THEN
        v_factor := 1; v_prior_rates := 0;
        FOR v_m IN SELECT * FROM public.get_tax_members(v_eff_group, v_eff_code, v_bill.bill_date) LOOP
          v_factor := v_factor + (v_m.rate/100.0) * (CASE WHEN v_m.is_compound THEN 1 + v_prior_rates ELSE 1 END);
          v_prior_rates := v_prior_rates + v_m.rate/100.0;
        END LOOP;
        v_excl_base := round(v_bill_value / v_factor, 2);
        v_line_cost := v_excl_base;
      END IF;

      v_prior_tax := 0;
      FOR v_m IN SELECT * FROM public.get_tax_members(v_eff_group, v_eff_code, v_bill.bill_date) LOOP
        IF v_m.rate IS NULL THEN
          RAISE EXCEPTION 'No tax rate effective on % for code %', v_bill.bill_date, v_m.code;
        END IF;
        v_member_base := CASE WHEN v_m.is_compound THEN v_excl_base + v_prior_tax ELSE v_excl_base END;
        v_member_tax  := round(v_member_base * v_m.rate/100.0, 2);
        v_prior_tax := v_prior_tax + v_member_tax;
        IF v_member_tax = 0 THEN CONTINUE; END IF;

        IF v_m.collection_mode = 'reverse_charge' THEN
          IF v_m.output_liability_account_id IS NULL THEN
            RAISE EXCEPTION 'Tax code % has no output liability account mapped (required for reverse charge)', v_m.code;
          END IF;
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
          VALUES (v_je, v_m.output_liability_account_id, 0, v_member_tax);
          INSERT INTO public.tax_transactions(tenant_id, tax_code_id, direction, source_type, source_id,
            source_line_id, base_amount, tax_amount, currency, fx_rate, rate_applied, transaction_date, journal_entry_id)
          VALUES (v_tenant, v_m.tax_code_id, 'reverse_charge_output', 'supplier_bill', p_bill_id,
            v_line.id, v_member_base, v_member_tax, 'LKR', 1, v_m.rate, v_bill.bill_date, v_je);

          IF COALESCE(v_profile.is_vat_registered, false) AND v_m.is_recoverable THEN
            v_input_acct := COALESCE(v_m.input_receivable_account_id, v_settings.tax_payable_account_id);
            IF v_input_acct IS NULL THEN
              RAISE EXCEPTION 'Tax code % has no input receivable account mapped', v_m.code;
            END IF;
            INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
            VALUES (v_je, v_input_acct, v_member_tax, 0);
            v_dr_total := v_dr_total + v_member_tax;
            INSERT INTO public.tax_transactions(tenant_id, tax_code_id, direction, source_type, source_id,
              source_line_id, base_amount, tax_amount, currency, fx_rate, rate_applied, transaction_date, journal_entry_id)
            VALUES (v_tenant, v_m.tax_code_id, 'reverse_charge_input', 'supplier_bill', p_bill_id,
              v_line.id, v_member_base, v_member_tax, 'LKR', 1, v_m.rate, v_bill.bill_date, v_je);
          ELSE
            v_line_cost := v_line_cost + v_member_tax;
          END IF;
          v_tax_total := v_tax_total + v_member_tax;

        ELSIF v_m.collection_mode = 'input' AND COALESCE(v_profile.is_vat_registered, false) AND v_m.is_recoverable THEN
          v_input_acct := v_m.input_receivable_account_id;
          IF v_input_acct IS NULL THEN
            v_input_acct := v_settings.tax_payable_account_id;
            v_warnings := array_append(v_warnings,
              'Tax code '||v_m.code||' has no input receivable account; used global tax account fallback');
          END IF;
          IF v_input_acct IS NULL THEN
            RAISE EXCEPTION 'Tax code % has no input receivable account mapped and no global fallback', v_m.code;
          END IF;
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
          VALUES (v_je, v_input_acct, v_member_tax, 0);
          v_dr_total := v_dr_total + v_member_tax;
          v_ap_total := v_ap_total + v_member_tax;
          v_tax_total := v_tax_total + v_member_tax;
          INSERT INTO public.tax_transactions(tenant_id, tax_code_id, direction, source_type, source_id,
            source_line_id, base_amount, tax_amount, currency, fx_rate, rate_applied, transaction_date, journal_entry_id)
          VALUES (v_tenant, v_m.tax_code_id, 'input', 'supplier_bill', p_bill_id,
            v_line.id, v_member_base, v_member_tax, 'LKR', 1, v_m.rate, v_bill.bill_date, v_je);

        ELSE
          -- Non-recoverable / tenant not VAT-registered → capitalize into cost.
          -- It is cost, not a tax credit → NO sub-ledger row.
          v_line_cost := v_line_cost + v_member_tax;
          v_ap_total := v_ap_total + v_member_tax;
          v_tax_total := v_tax_total + v_member_tax;
        END IF;
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_excl_base;
    v_ap_total := v_ap_total + v_excl_base;

    IF v_line.account_id IS NULL THEN
      RAISE EXCEPTION 'Line % requires an expense account_id', v_lines_count;
    END IF;
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_line.account_id, v_line_cost, 0);
    v_dr_total := v_dr_total + v_line_cost;

    UPDATE public.supplier_bill_lines
    SET tax_amount_line = round((
          SELECT COALESCE(SUM(tt.tax_amount),0) FROM public.tax_transactions tt
          WHERE tt.source_line_id = v_line.id AND tt.source_type='supplier_bill'
            AND tt.direction IN ('input')
        ) + (v_line_cost - v_excl_base), 2)
    WHERE id = v_line.id;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'Bill must have at least one line'; END IF;

  IF NOT v_has_line_tax AND v_bill.tax_amount > 0 THEN
    IF v_settings.tax_payable_account_id IS NULL THEN
      RAISE EXCEPTION 'Bill has header tax but no Tax Payable account configured (Settings → Account Mapping)';
    END IF;
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_settings.tax_payable_account_id, v_bill.tax_amount, 0);
    v_dr_total := v_dr_total + v_bill.tax_amount;
    v_ap_total := v_ap_total + v_bill.tax_amount;
    v_tax_total := v_tax_total + v_bill.tax_amount;
  END IF;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (v_je, v_ap, 0, v_ap_total)
  RETURNING id INTO v_ap_line_id;

  IF abs(v_dr_total - v_ap_total -
        (SELECT COALESCE(SUM(tt.tax_amount),0) FROM public.tax_transactions tt
         WHERE tt.source_type='supplier_bill' AND tt.source_id=p_bill_id
           AND tt.direction='reverse_charge_output')
      ) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry out of balance. Debits=% AP credit=%. Check tax configuration.',
      v_dr_total, v_ap_total;
  END IF;

  UPDATE public.supplier_bills
  SET status='posted', posted_at=now(), journal_entry_id=v_je,
      subtotal = CASE WHEN v_has_line_tax THEN v_subtotal ELSE subtotal END,
      tax_amount = CASE WHEN v_has_line_tax THEN v_tax_total ELSE tax_amount END,
      total_amount = CASE WHEN v_has_line_tax THEN v_ap_total ELSE total_amount END
  WHERE id=p_bill_id;

  RETURN jsonb_build_object('ok',true,'bill_id',p_bill_id,'journal_entry_id',v_je,
    'total',v_ap_total,'tax_total',v_tax_total,'warnings',to_jsonb(v_warnings));
END $function$;

-- 3. Drop all remaining pure-inventory functions (trigger functions for
--    tables dropped in step 4 are included with CASCADE for safety, even
--    though dropping their table would remove the trigger anyway).
DROP FUNCTION IF EXISTS public.apply_stock_movement() CASCADE;
DROP FUNCTION IF EXISTS public.approve_stock_adjustment(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.block_posted_dn_edits() CASCADE;
DROP FUNCTION IF EXISTS public.block_posted_grn_edits() CASCADE;
DROP FUNCTION IF EXISTS public.cancel_stock_count(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.consume_inventory_fifo(uuid, numeric, uuid, text, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.generate_grn_number(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.generate_item_code(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.generate_lot_number(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.generate_po_number(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.grn_line_carry_tax() CASCADE;
DROP FUNCTION IF EXISTS public.inventory_valuation_report(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_assembly_order(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_delivery_note(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_grn(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_landed_cost_voucher(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_purchase_return(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_sales_return(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_stock_adjustment(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_stock_count(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_stock_transfer(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.receive_inventory(uuid, numeric, numeric, uuid, date, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_inventory_qty(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.reject_stock_adjustment(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.seed_inventory_coa_accounts(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.set_adjustment_number() CASCADE;
DROP FUNCTION IF EXISTS public.set_dn_number() CASCADE;
DROP FUNCTION IF EXISTS public.set_inventory_item_code() CASCADE;
DROP FUNCTION IF EXISTS public.set_lcv_number() CASCADE;
DROP FUNCTION IF EXISTS public.set_pr_number() CASCADE;
DROP FUNCTION IF EXISTS public.set_sr_number() CASCADE;
DROP FUNCTION IF EXISTS public.set_stock_count_number() CASCADE;
DROP FUNCTION IF EXISTS public.set_transfer_number() CASCADE;
DROP FUNCTION IF EXISTS public.start_stock_count(uuid, uuid[]) CASCADE;
DROP FUNCTION IF EXISTS public.submit_stock_adjustment(uuid) CASCADE;

-- 4. Drop the inventory/procurement tables (children and parents together;
--    CASCADE resolves ordering and drops the FK constraints these tables'
--    children hold on kept tables like supplier_bill_lines).
DROP TABLE IF EXISTS
  public.assembly_order_lines,
  public.assembly_orders,
  public.bom_components,
  public.boms,
  public.delivery_note_lines,
  public.delivery_notes,
  public.grn_lines,
  public.goods_receipt_notes,
  public.inventory_subledger,
  public.landed_cost_allocations,
  public.landed_cost_charges,
  public.landed_cost_voucher_grns,
  public.landed_cost_vouchers,
  public.purchase_order_lines,
  public.purchase_orders,
  public.purchase_return_lines,
  public.purchase_returns,
  public.sales_return_lines,
  public.sales_returns,
  public.stock_adjustment_lines,
  public.stock_adjustments,
  public.stock_count_lines,
  public.stock_counts,
  public.stock_lot_consumptions,
  public.stock_lots,
  public.stock_movements,
  public.stock_transfer_lines,
  public.stock_transfers,
  public.warehouses,
  public.inventory_items
CASCADE;

-- 5. Strip inventory-only columns from tables that stay.
ALTER TABLE public.products
  DROP COLUMN IF EXISTS inventory_item_id,
  DROP COLUMN IF EXISTS asset_account_id,
  DROP COLUMN IF EXISTS is_tracked;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_type_chk;
ALTER TABLE public.products ADD CONSTRAINT products_type_chk
  CHECK (type = ANY (ARRAY['service'::text, 'non_inventory'::text]));

ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS inventory_item_id;
ALTER TABLE public.ar_credit_note_items DROP COLUMN IF EXISTS inventory_item_id;

ALTER TABLE public.supplier_bill_lines
  DROP COLUMN IF EXISTS grn_line_id,
  DROP COLUMN IF EXISTS item_id;

ALTER TABLE public.account_settings
  DROP COLUMN IF EXISTS inventory_account_id,
  DROP COLUMN IF EXISTS inventory_adjustment_approval_threshold,
  DROP COLUMN IF EXISTS inventory_asset_account_id,
  DROP COLUMN IF EXISTS cogs_account_id,
  DROP COLUMN IF EXISTS grni_clearing_account_id,
  DROP COLUMN IF EXISTS purchase_price_variance_account_id;

-- 6. Drop the INVENTORY posting-profile module and its transaction types.
ALTER TABLE public.posting_profiles DROP CONSTRAINT IF EXISTS pp_module_values;
ALTER TABLE public.posting_profiles ADD CONSTRAINT pp_module_values
  CHECK (module = ANY (ARRAY['AR'::text, 'AP'::text, 'FIXED_ASSETS'::text, 'BANK'::text]));

ALTER TABLE public.posting_profiles DROP CONSTRAINT IF EXISTS pp_transaction_type_values;
ALTER TABLE public.posting_profiles ADD CONSTRAINT pp_transaction_type_values
  CHECK (transaction_type = ANY (ARRAY[
    'INVOICE'::text, 'PAYMENT'::text, 'CREDIT_NOTE'::text, 'BILL'::text, 'BILL_PAYMENT'::text, 'DEBIT_NOTE'::text,
    'ASSET_ACQUISITION'::text, 'DEPRECIATION'::text, 'DISPOSAL'::text, 'ASSET_WRITE_OFF'::text, 'ASSET_ADJUSTMENT'::text,
    'BANK_TRANSFER'::text, 'BANK_FEE'::text, 'BANK_INTEREST'::text
  ]));

-- 7. Drop the now-orphaned "recommended" checks from the account-settings
--    completeness RPC.
CREATE OR REPLACE FUNCTION public.get_account_settings_completeness(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.account_settings%ROWTYPE;
  v_crit text[] := '{}';
  v_rec  text[] := '{}';
BEGIN
  SELECT * INTO v_row FROM public.account_settings WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configured', false,
      'critical_missing', '["No account_settings row found"]'::jsonb,
      'recommended_missing', '[]'::jsonb,
      'critical_complete', false, 'fully_complete', false);
  END IF;

  -- Critical
  IF v_row.ar_account_id                IS NULL THEN v_crit := v_crit || 'ar_account_id'; END IF;
  IF v_row.ap_account_id                IS NULL THEN v_crit := v_crit || 'ap_account_id'; END IF;
  IF v_row.sales_account_id             IS NULL THEN v_crit := v_crit || 'sales_account_id'; END IF;
  IF v_row.bank_account_id              IS NULL THEN v_crit := v_crit || 'bank_account_id'; END IF;
  IF v_row.tax_payable_account_id       IS NULL THEN v_crit := v_crit || 'tax_payable_account_id'; END IF;
  IF v_row.retained_earnings_account_id IS NULL THEN v_crit := v_crit || 'retained_earnings_account_id'; END IF;

  -- Recommended
  IF v_row.depreciation_expense_account_id    IS NULL THEN v_rec := v_rec || 'depreciation_expense_account_id'; END IF;
  IF v_row.accumulated_depreciation_account_id IS NULL THEN v_rec := v_rec || 'accumulated_depreciation_account_id'; END IF;
  IF v_row.disposal_gain_account_id           IS NULL THEN v_rec := v_rec || 'disposal_gain_account_id'; END IF;
  IF v_row.disposal_loss_account_id           IS NULL THEN v_rec := v_rec || 'disposal_loss_account_id'; END IF;
  IF v_row.wages_expense_account_id           IS NULL THEN v_rec := v_rec || 'wages_expense_account_id'; END IF;
  IF v_row.payroll_clearing_account_id        IS NULL THEN v_rec := v_rec || 'payroll_clearing_account_id'; END IF;
  IF v_row.fx_gain_account_id                 IS NULL THEN v_rec := v_rec || 'fx_gain_account_id'; END IF;
  IF v_row.fx_loss_account_id                 IS NULL THEN v_rec := v_rec || 'fx_loss_account_id'; END IF;

  RETURN jsonb_build_object(
    'configured',          true,
    'critical_missing',    to_jsonb(v_crit),
    'recommended_missing', to_jsonb(v_rec),
    'critical_complete',   (array_length(v_crit, 1) IS NULL),
    'fully_complete',      (array_length(v_crit, 1) IS NULL AND array_length(v_rec, 1) IS NULL)
  );
END;
$function$;
