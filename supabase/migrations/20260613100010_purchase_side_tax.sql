-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v3 — Migration 10: purchase-side (input) tax architecture.
--
-- House design (SAP/Oracle "item master + stock record", two-sided tax):
--   * Sales/output tax default lives on  public.products      (v2 — done).
--   * Purchase/input tax default lives on public.inventory_items (this file).
--   Same physical item, different tax: output VAT on sale, input VAT on
--   purchase. PO/GRN/Bill lines key on inventory_items, NEVER on products,
--   so purchase tax MUST resolve through inventory_items.
--
-- Resolution order on a purchase line (implemented in post_supplier_bill):
--   line override (tax_group_id/tax_code_id)
--     → inventory_items.default_purchase_tax_group_id / _code_id
--       → tenant_tax_profiles.default_purchase_tax_code_id
--
-- Carry-forward: PO line → GRN line → Bill line via BEFORE INSERT triggers,
-- mirroring snapshot_invoice_item_inventory, so tax chosen at order time
-- flows to the taxable document (the bill) without re-entry.
--
-- NOTE on legacy data: inventory_items has NO legacy tax_id in this schema
-- (the v3 brief's claim is inaccurate here — verified in Phase 0). The only
-- legacy purchase tax field is purchase_order_lines.tax_id, whose values
-- point at public.taxes rows that carry no input/output distinction. We do
-- NOT auto-map those onto the new line tax_code_id: the migrated legacy
-- codes are output-mode, and forcing an output code onto a purchase line
-- would misclassify input VAT. Open POs therefore fall through to the
-- inventory-item / tenant purchase default. tax_id is left intact, deprecated.
-- ════════════════════════════════════════════════════════════════════

-- ── Inventory item: purchase/input tax default ───────────────────────
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS default_purchase_tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN IF NOT EXISTS default_purchase_tax_group_id uuid REFERENCES public.tax_groups(id);
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inv_items_purchase_tax_one_of;
ALTER TABLE public.inventory_items ADD CONSTRAINT inv_items_purchase_tax_one_of
  CHECK (default_purchase_tax_group_id IS NULL OR default_purchase_tax_code_id IS NULL);

-- ── PO lines: line-level tax (legacy tax_id kept, deprecated) ────────
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS tax_group_id uuid REFERENCES public.tax_groups(id),
  ADD COLUMN IF NOT EXISTS tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_amount_line numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.purchase_order_lines DROP CONSTRAINT IF EXISTS pol_tax_one_of;
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT pol_tax_one_of
  CHECK (tax_group_id IS NULL OR tax_code_id IS NULL);

-- ── GRN lines: tax carried forward from PO (informational; the bill is
--    the tax point, so post_grn never posts input VAT) ────────────────
ALTER TABLE public.grn_lines
  ADD COLUMN IF NOT EXISTS tax_group_id uuid REFERENCES public.tax_groups(id),
  ADD COLUMN IF NOT EXISTS tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_amount_line numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.grn_lines DROP CONSTRAINT IF EXISTS grnl_tax_one_of;
ALTER TABLE public.grn_lines ADD CONSTRAINT grnl_tax_one_of
  CHECK (tax_group_id IS NULL OR tax_code_id IS NULL);

-- ── Carry-forward: PO line → GRN line ────────────────────────────────
CREATE OR REPLACE FUNCTION public.grn_line_carry_tax()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_po RECORD;
BEGIN
  IF NEW.po_line_id IS NOT NULL
     AND NEW.tax_code_id IS NULL AND NEW.tax_group_id IS NULL THEN
    SELECT tax_code_id, tax_group_id, is_tax_inclusive
      INTO v_po FROM public.purchase_order_lines WHERE id = NEW.po_line_id;
    IF FOUND THEN
      NEW.tax_code_id := v_po.tax_code_id;
      NEW.tax_group_id := v_po.tax_group_id;
      NEW.is_tax_inclusive := COALESCE(v_po.is_tax_inclusive, false);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grn_line_carry_tax ON public.grn_lines;
CREATE TRIGGER trg_grn_line_carry_tax BEFORE INSERT ON public.grn_lines
  FOR EACH ROW EXECUTE FUNCTION public.grn_line_carry_tax();

-- ── Carry-forward: GRN line → supplier bill line ─────────────────────
CREATE OR REPLACE FUNCTION public.bill_line_carry_tax()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_grn RECORD;
BEGIN
  IF NEW.grn_line_id IS NOT NULL
     AND NEW.tax_code_id IS NULL AND NEW.tax_group_id IS NULL THEN
    SELECT tax_code_id, tax_group_id, is_tax_inclusive
      INTO v_grn FROM public.grn_lines WHERE id = NEW.grn_line_id;
    IF FOUND THEN
      NEW.tax_code_id := v_grn.tax_code_id;
      NEW.tax_group_id := v_grn.tax_group_id;
      NEW.is_tax_inclusive := COALESCE(v_grn.is_tax_inclusive, false);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bill_line_carry_tax ON public.supplier_bill_lines;
CREATE TRIGGER trg_bill_line_carry_tax BEFORE INSERT ON public.supplier_bill_lines
  FOR EACH ROW EXECUTE FUNCTION public.bill_line_carry_tax();

-- ════════════════════════════════════════════════════════════════════
-- post_supplier_bill — add the purchase-side three-tier resolution.
-- Identical to the v2 (migration 8) body except each line now resolves an
-- EFFECTIVE tax group/code: line override → inventory item purchase
-- default → tenant purchase default, before computing input VAT.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_supplier_bill(p_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_bill supplier_bills%ROWTYPE;
  v_profile tenant_tax_profiles%ROWTYPE;
  v_settings RECORD;
  v_grni uuid; v_ap uuid; v_ppv uuid;
  v_je uuid; v_ap_line_id uuid;
  v_line RECORD; v_grnline grn_lines%ROWTYPE;
  v_grn_value numeric(18,2); v_bill_value numeric(18,2); v_variance numeric(18,2);
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
  -- effective (resolved) tax selection for the current line
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

  -- Effective per-line tax (override → item default → tenant default) drives
  -- whether ANY line on this bill carries tax.
  SELECT EXISTS (
    SELECT 1 FROM public.supplier_bill_lines sbl
    LEFT JOIN public.inventory_items ii ON ii.id = sbl.item_id
    WHERE sbl.bill_id=p_bill_id AND (
      sbl.tax_code_id IS NOT NULL OR sbl.tax_group_id IS NOT NULL
      OR ii.default_purchase_tax_code_id IS NOT NULL OR ii.default_purchase_tax_group_id IS NOT NULL
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

  v_grni := v_settings.grni_clearing_account_id;
  IF v_grni IS NULL THEN
    SELECT id INTO v_grni FROM public.accounts
    WHERE tenant_id=v_tenant AND account_code='2150' AND is_active=true LIMIT 1;
  END IF;
  IF v_grni IS NULL THEN
    PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  END IF;

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
    v_line_cost := v_bill_value;
    v_excl_base := v_bill_value;

    -- ── Three-tier purchase tax resolution ──────────────────────────
    v_eff_group := v_line.tax_group_id;
    v_eff_code  := v_line.tax_code_id;
    IF v_eff_group IS NULL AND v_eff_code IS NULL AND v_line.item_id IS NOT NULL THEN
      SELECT default_purchase_tax_group_id, default_purchase_tax_code_id
        INTO v_eff_group, v_eff_code
      FROM public.inventory_items WHERE id = v_line.item_id;
    END IF;
    IF v_eff_group IS NULL AND v_eff_code IS NULL THEN
      v_eff_code := v_profile.default_purchase_tax_code_id;  -- tenant default (also covers account-coded lines)
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

    IF v_line.grn_line_id IS NOT NULL THEN
      SELECT * INTO v_grnline FROM public.grn_lines WHERE id=v_line.grn_line_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'GRN line not found for line %', v_lines_count; END IF;
      IF v_grnline.tenant_id<>v_tenant THEN RAISE EXCEPTION 'GRN line tenant mismatch'; END IF;
      IF (v_grnline.qty_billed + v_line.qty) > v_grnline.qty_received + 0.0001 THEN
        RAISE EXCEPTION 'Three-way match failed line %: bill qty (%) + already billed (%) exceeds GRN received (%)',
          v_lines_count, v_line.qty, v_grnline.qty_billed, v_grnline.qty_received;
      END IF;

      v_grn_value := round(v_line.qty * v_grnline.unit_cost, 2);
      v_variance  := round(v_line_cost - v_grn_value, 2);

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
        ELSE
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
          VALUES (v_je, v_ppv, 0, -v_variance);
        END IF;
        v_dr_total := v_dr_total + v_variance;
      END IF;

      UPDATE public.grn_lines SET qty_billed = qty_billed + v_line.qty WHERE id = v_grnline.id;
    ELSE
      IF v_line.account_id IS NULL THEN
        RAISE EXCEPTION 'Line % requires a GRN link or an expense account_id', v_lines_count;
      END IF;
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
      VALUES (v_je, v_line.account_id, v_line_cost, 0);
      v_dr_total := v_dr_total + v_line_cost;
    END IF;

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
END $$;
