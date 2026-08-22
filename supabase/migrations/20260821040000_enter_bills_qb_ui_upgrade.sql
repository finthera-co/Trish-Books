-- ============================================================================
-- ENTER BILLS — QUICKBOOKS-STYLE UI UPGRADE
-- Adds the pieces needed for a full QuickBooks-style Enter Bill page that were
-- still missing after the Terms/address/Customer:Job upgrade:
--   - bill_attachments (mirrors invoice_attachments exactly; reuses the same
--     private `invoice-attachments` storage bucket under a /bills/ path — its
--     RLS keys only on the tenant_id path segment, so no new bucket/policies
--     are needed)
--   - bill-level discount (percentage or fixed) and shipping/freight, folded
--     into post_supplier_bill's existing per-line tax computation
-- Explicitly NOT included (per user decision): Item Details/inventory tab,
-- PO/GRN matching, multi-currency, branches/departments/cost-centres, a
-- formal approval workflow. Bills stay account-based only.
-- ============================================================================

-- 1. Bill attachments (metadata index; files live in the existing
--    invoice-attachments bucket under `<tenant_id>/bills/<bill_id>/...`).
CREATE TABLE IF NOT EXISTS public.bill_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bill_id       UUID NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  content_type  TEXT,
  size_bytes    BIGINT,
  uploaded_by   UUID REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_attachments_bill ON public.bill_attachments (bill_id);

ALTER TABLE public.bill_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_attachments_rw ON public.bill_attachments;
CREATE POLICY bill_attachments_rw ON public.bill_attachments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bill_attachments TO authenticated;

-- 2. Bill-level discount + shipping/freight.
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'percentage'
    CHECK (discount_type IN ('percentage', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_account_id uuid REFERENCES public.accounts(id);

-- 3. post_supplier_bill: fold discount (pro-rated across lines, reducing the
--    taxable base — a standard trade-discount treatment) and shipping (posted
--    as its own debit line) into the existing per-line tax computation.
--    Everything else — the two-tier tax resolution, reverse-charge handling,
--    header-tax fallback — is unchanged from the current function.
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
  v_subtotal_raw numeric(18,2);
  v_discount_total numeric(18,2);
  v_discount_ratio numeric;
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

  -- Bill-level discount: computed against the raw (pre-discount) line total,
  -- then spread pro-rata as a reduction of each line's taxable base below.
  SELECT COALESCE(SUM(qty * unit_cost), 0) INTO v_subtotal_raw
  FROM public.supplier_bill_lines WHERE bill_id = p_bill_id;

  v_discount_total := CASE
    WHEN v_bill.discount_type = 'percentage' THEN round(v_subtotal_raw * v_bill.discount_value / 100.0, 2)
    ELSE LEAST(v_bill.discount_value, v_subtotal_raw)
  END;
  v_discount_ratio := CASE WHEN v_subtotal_raw > 0 THEN v_discount_total / v_subtotal_raw ELSE 0 END;

  IF v_bill.shipping_amount > 0 AND v_bill.shipping_account_id IS NULL THEN
    RAISE EXCEPTION 'Shipping/Freight amount is set but no GL account was selected for it.';
  END IF;

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
    v_bill_value := round(round(v_line.qty * v_line.unit_cost, 2) * (1 - v_discount_ratio), 2);
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

  -- Shipping/Freight: its own debit line, added straight to AP (no tax applied
  -- to freight here — the user can add a tax-carrying line instead if needed).
  IF v_bill.shipping_amount > 0 THEN
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_bill.shipping_account_id, v_bill.shipping_amount, 0);
    v_dr_total := v_dr_total + v_bill.shipping_amount;
    v_ap_total := v_ap_total + v_bill.shipping_amount;
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

  -- total_amount always becomes the authoritative posted total (v_ap_total) —
  -- unlike subtotal/tax_amount, it must reflect discount + shipping regardless
  -- of whether line-level tax codes were used.
  UPDATE public.supplier_bills
  SET status='posted', posted_at=now(), journal_entry_id=v_je,
      subtotal = CASE WHEN v_has_line_tax THEN v_subtotal ELSE subtotal END,
      tax_amount = CASE WHEN v_has_line_tax THEN v_tax_total ELSE tax_amount END,
      total_amount = v_ap_total
  WHERE id=p_bill_id;

  RETURN jsonb_build_object('ok',true,'bill_id',p_bill_id,'journal_entry_id',v_je,
    'total',v_ap_total,'tax_total',v_tax_total,'discount_total',v_discount_total,'warnings',to_jsonb(v_warnings));
END $function$;
