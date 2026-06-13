-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 8: posting integration (SQL side).
--  * get_tax_members(): expands a line's tax group/code into ordered,
--    effective-dated members (rates resolved by DOCUMENT DATE).
--  * post_supplier_bill(): per-line tax — recoverable input VAT to the
--    code's input receivable account; non-recoverable / unregistered
--    input tax capitalized into cost; reverse charge self-assessment.
--    Legacy bills (no line tax codes) keep the old header-tax behavior.
--  * post_tax_remittance() / void_tax_remittance().
-- Both Dr and Cr sides explicit everywhere (house rule #2).
-- ════════════════════════════════════════════════════════════════════

-- ── Member expansion helper ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tax_members(
  p_tax_group_id uuid,
  p_tax_code_id uuid,
  p_as_of date
) RETURNS TABLE (
  tax_code_id uuid,
  code text,
  tax_type text,
  collection_mode text,
  is_compound boolean,
  apply_order int,
  rate numeric,
  is_recoverable boolean,
  output_liability_account_id uuid,
  input_receivable_account_id uuid,
  wht_payable_account_id uuid,
  wht_receivable_account_id uuid
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tc.id, tc.code, tc.tax_type, tc.collection_mode,
         COALESCE(tgm.compound_on_previous, false),
         COALESCE(tgm.apply_order, 1),
         COALESCE(public.get_tax_rate(tc.id, p_as_of), 0),
         tc.is_recoverable,
         tc.output_liability_account_id, tc.input_receivable_account_id,
         tc.wht_payable_account_id, tc.wht_receivable_account_id
  FROM public.tax_codes tc
  LEFT JOIN public.tax_group_members tgm
    ON tgm.tax_code_id = tc.id AND tgm.tax_group_id = p_tax_group_id
  WHERE (p_tax_group_id IS NOT NULL AND tgm.tax_group_id = p_tax_group_id)
     OR (p_tax_group_id IS NULL AND tc.id = p_tax_code_id)
  ORDER BY COALESCE(tgm.apply_order, 1);
$$;

-- ── post_supplier_bill: tax-aware rewrite ────────────────────────────
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
  v_ap_total numeric(18,2) := 0;     -- what the vendor actually charges (excludes reverse charge)
  v_subtotal numeric(18,2) := 0;
  v_tax_total numeric(18,2) := 0;
  v_has_line_tax boolean;
  -- per-line tax computation
  v_m RECORD;
  v_factor numeric; v_prior_rates numeric; v_prior_tax numeric;
  v_excl_base numeric; v_member_base numeric; v_member_tax numeric;
  v_line_cost numeric;               -- Dr amount for the expense/GRNI side (incl. capitalized tax)
  v_input_acct uuid;
  v_warnings text[] := '{}';
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

  SELECT EXISTS (
    SELECT 1 FROM public.supplier_bill_lines
    WHERE bill_id=p_bill_id AND (tax_code_id IS NOT NULL OR tax_group_id IS NOT NULL)
  ) INTO v_has_line_tax;

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

    -- ── Per-line tax computation (rates by BILL DATE) ────────────────
    v_line_cost := v_bill_value;           -- Dr side; capitalized tax added below
    v_excl_base := v_bill_value;

    IF v_line.tax_code_id IS NOT NULL OR v_line.tax_group_id IS NOT NULL THEN
      -- inclusive pricing: algebraic gross-up factor 1 + Σ rᵢ·bᵢ
      IF v_line.is_tax_inclusive THEN
        v_factor := 1; v_prior_rates := 0;
        FOR v_m IN SELECT * FROM public.get_tax_members(v_line.tax_group_id, v_line.tax_code_id, v_bill.bill_date) LOOP
          v_factor := v_factor + (v_m.rate/100.0) * (CASE WHEN v_m.is_compound THEN 1 + v_prior_rates ELSE 1 END);
          v_prior_rates := v_prior_rates + v_m.rate/100.0;
        END LOOP;
        v_excl_base := round(v_bill_value / v_factor, 2);
        v_line_cost := v_excl_base;
      END IF;

      v_prior_tax := 0;
      FOR v_m IN SELECT * FROM public.get_tax_members(v_line.tax_group_id, v_line.tax_code_id, v_bill.bill_date) LOOP
        IF v_m.rate IS NULL THEN
          RAISE EXCEPTION 'No tax rate effective on % for code %', v_bill.bill_date, v_m.code;
        END IF;
        v_member_base := CASE WHEN v_m.is_compound THEN v_excl_base + v_prior_tax ELSE v_excl_base END;
        v_member_tax  := round(v_member_base * v_m.rate/100.0, 2);
        v_prior_tax := v_prior_tax + v_member_tax;
        IF v_member_tax = 0 THEN CONTINUE; END IF;

        IF v_m.collection_mode = 'reverse_charge' THEN
          -- Self-assessed VAT on imported services. Vendor does NOT charge
          -- it → no effect on AP. Cr VAT Output Payable always; Dr VAT
          -- Input Receivable when the tenant can recover it, otherwise the
          -- input side capitalizes into the line cost.
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
            -- input side not recoverable → cost
            v_line_cost := v_line_cost + v_member_tax;
          END IF;
          -- output leg credit is balanced by either the input Dr or the capitalized cost Dr
          v_tax_total := v_tax_total + v_member_tax;

        ELSIF v_m.collection_mode = 'input' AND COALESCE(v_profile.is_vat_registered, false) AND v_m.is_recoverable THEN
          -- Recoverable input VAT: Dr the code's input receivable
          v_input_acct := v_m.input_receivable_account_id;
          IF v_input_acct IS NULL THEN
            v_input_acct := v_settings.tax_payable_account_id;  -- tier-3 global fallback
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
          -- Non-recoverable (or tenant not VAT-registered): capitalize the
          -- tax into the line cost. It is cost, not tax credit → NO
          -- sub-ledger row (it must never appear on a VAT return).
          v_line_cost := v_line_cost + v_member_tax;
          v_ap_total := v_ap_total + v_member_tax;
          v_tax_total := v_tax_total + v_member_tax;
        END IF;
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_excl_base;
    v_ap_total := v_ap_total + v_excl_base;

    -- ── Expense / GRNI side (Dr v_line_cost) ─────────────────────────
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

    -- persist computed line tax for drill-down
    UPDATE public.supplier_bill_lines
    SET tax_amount_line = round(v_line_cost - v_excl_base + (
          SELECT COALESCE(SUM(tt.tax_amount),0) FROM public.tax_transactions tt
          WHERE tt.source_line_id = v_line.id AND tt.source_type='supplier_bill'
            AND tt.direction IN ('input')
        ), 2)
    WHERE id = v_line.id;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'Bill must have at least one line'; END IF;

  -- ── Legacy header-level tax (bills without line tax codes) ─────────
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

  -- ── Cr AP gross (what the vendor actually charges) ─────────────────
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (v_je, v_ap, 0, v_ap_total)
  RETURNING id INTO v_ap_line_id;

  IF abs(v_dr_total - v_ap_total -
        -- reverse-charge output credits sit outside AP; they are matched by
        -- extra debits (input receivable or capitalized cost)
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

-- ── Tax remittance posting: Dr tax liability / Cr bank ───────────────
CREATE OR REPLACE FUNCTION public.post_tax_remittance(p_remittance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_rem tax_remittances%ROWTYPE;
  v_code tax_codes%ROWTYPE;
  v_liab uuid; v_je uuid;
  v_direction text;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_rem FROM public.tax_remittances WHERE id=p_remittance_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remittance not found'; END IF;
  IF v_rem.status<>'draft' THEN RAISE EXCEPTION 'Only draft remittances can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_rem.remittance_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_rem.remittance_date;
  END IF;

  SELECT * INTO v_code FROM public.tax_codes WHERE id=v_rem.tax_code_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax code not found'; END IF;

  v_liab := CASE
    WHEN v_code.collection_mode IN ('output','reverse_charge') THEN v_code.output_liability_account_id
    WHEN v_code.collection_mode = 'withholding_payable' THEN v_code.wht_payable_account_id
    ELSE NULL
  END;
  IF v_liab IS NULL THEN
    RAISE EXCEPTION 'Tax code % has no liability account mapped for remittance', v_code.code;
  END IF;

  v_direction := CASE
    WHEN v_code.collection_mode = 'withholding_payable' THEN 'wht_payable'
    ELSE 'output'
  END;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_rem.remittance_date,
    'Tax remittance '||v_code.code||COALESCE(' (IRD ref '||v_rem.reference||')',''),
    v_rem.reference, 'posted', now(), v_user, 'tax_remittance', v_rem.id, true, 'tax_remittance')
  RETURNING id INTO v_je;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_liab, v_rem.amount, 0),                 -- Dr tax liability
    (v_je, v_rem.bank_account_id, 0, v_rem.amount);  -- Cr bank

  -- Negative sub-ledger row: reduces the outstanding balance for the code
  INSERT INTO public.tax_transactions(tenant_id, tax_code_id, direction, source_type, source_id,
    base_amount, tax_amount, currency, fx_rate, rate_applied, transaction_date, journal_entry_id, tax_period_id)
  VALUES (v_tenant, v_rem.tax_code_id, v_direction, 'tax_remittance', v_rem.id,
    0, -v_rem.amount, 'LKR', 1, 0, v_rem.remittance_date, v_je, v_rem.tax_period_id);

  UPDATE public.tax_remittances SET status='posted', journal_entry_id=v_je WHERE id=p_remittance_id;

  RETURN jsonb_build_object('ok',true,'remittance_id',p_remittance_id,'journal_entry_id',v_je);
END $$;

-- ── Void a posted remittance: reversal JE + mirrored sub-ledger rows ──
CREATE OR REPLACE FUNCTION public.void_tax_remittance(p_remittance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_role text;
  v_rem tax_remittances%ROWTYPE;
  v_rev_je uuid;
  v_l RECORD;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user, v_tenant, v_role
  FROM public.users u LEFT JOIN public.roles r ON r.id=u.role_id
  WHERE u.auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_role NOT IN ('Primary Admin','Company Admin','Super Admin') THEN
    RAISE EXCEPTION 'Voiding a tax remittance requires a tenant admin role';
  END IF;

  SELECT * INTO v_rem FROM public.tax_remittances WHERE id=p_remittance_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remittance not found'; END IF;
  IF v_rem.status<>'posted' THEN RAISE EXCEPTION 'Only posted remittances can be voided'; END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type, reversal_of)
  VALUES (v_tenant, CURRENT_DATE, 'Reversal of tax remittance '||v_rem.id, v_rem.reference,
    'posted', now(), v_user, 'tax_remittance_reversal', v_rem.id, true, 'tax_remittance', v_rem.journal_entry_id)
  RETURNING id INTO v_rev_je;

  FOR v_l IN SELECT account_id, debit, credit FROM public.journal_lines WHERE journal_entry_id=v_rem.journal_entry_id LOOP
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_rev_je, v_l.account_id, v_l.credit, v_l.debit);
  END LOOP;

  PERFORM public.reverse_tax_transactions(v_tenant, 'tax_remittance', v_rem.id, v_rev_je, CURRENT_DATE);

  UPDATE public.journal_entries SET status='voided', voided_at=now(), voided_by=v_user
  WHERE id=v_rem.journal_entry_id;
  UPDATE public.tax_remittances SET status='voided' WHERE id=p_remittance_id;

  RETURN jsonb_build_object('ok',true,'reversal_journal_id',v_rev_je);
END $$;
