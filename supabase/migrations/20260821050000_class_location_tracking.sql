-- ============================================================================
-- CLASS / LOCATION TRACKING (Phase 1 of 4 — QuickBooks dimension parity)
-- QuickBooks' "Class" tracking already has an exact equivalent in this schema:
-- `cost_centers` + `journal_lines.cost_center_id`, present since the very
-- first migration but never wired to any hook or UI. Per "reuse existing
-- tables, don't duplicate" this migration:
--   - Completes cost_centers (adds is_active + a per-tenant unique name) and
--     extends cost_center_id onto the per-LINE tables that don't have it yet
--     (supplier_bill_lines, payment_voucher_lines) — matching QB's default
--     "one Class per line" behavior.
--   - Adds a NEW `locations` table (nothing analogous existed) for QB's
--     Location tracking, which is per-TRANSACTION (header-level), added to
--     journal_entries / supplier_bills / payment_vouchers.
--   - Adds account_settings toggles, including QB's "rename Location" option.
--   - Wires both into post_supplier_bill and create_payment_voucher so the
--     dimensions actually flow into journal_lines, not just sit on the source
--     document (per "must flow into the journal/GL transaction").
-- Only the transaction screens already built this session (Journal Entries,
-- Write Checks, Enter Bills) get selectors wired in this phase — Invoices,
-- Payroll, and Reports are NOT touched here; that is explicitly follow-up work.
-- ============================================================================

-- 1. Complete cost_centers (QB "Class" equivalent).
ALTER TABLE public.cost_centers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_centers_tenant_name
  ON public.cost_centers (tenant_id, name);

-- Cost centers only had an owner-facing SELECT+ALL-by-tenant policy with no
-- WITH CHECK — harden it the same way every other tenant table was this
-- session.
DROP POLICY IF EXISTS "Authorized users can manage cost centers" ON public.cost_centers;
CREATE POLICY "Authorized users can manage cost centers" ON public.cost_centers
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- 2. New: locations (QB "Location" equivalent — nothing analogous existed).
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_tenant_name ON public.locations (tenant_id, name);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own tenant locations" ON public.locations;
CREATE POLICY "Users can view own tenant locations" ON public.locations
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id() OR is_super_admin());
DROP POLICY IF EXISTS "Authorized users can manage locations" ON public.locations;
CREATE POLICY "Authorized users can manage locations" ON public.locations
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- 3. Per-line class_id equivalent (cost_center_id) on the transaction line
--    tables that don't have it yet. journal_lines already has it.
ALTER TABLE public.supplier_bill_lines
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.cost_centers(id);
ALTER TABLE public.payment_voucher_lines
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.cost_centers(id);

-- 4. Per-transaction location_id on the headers.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

-- 5. Settings: on/off toggles + QB's customizable Location label
--    ("Location"/"Branch"/"Store"/"Division"/"Property").
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS class_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_label text NOT NULL DEFAULT 'Location';

-- 6. Wire cost_center_id / location_id into the GL when posting bills.
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
    created_by, source_type, source_id, is_system_generated, entry_type, location_id)
  VALUES (v_tenant, v_bill.bill_date, 'Supplier Bill '||v_bill.bill_number, v_bill.bill_number,
    'posted', now(), v_user, 'supplier_bill', v_bill.id, true, 'supplier_bill', v_bill.location_id)
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.supplier_bill_lines WHERE bill_id=p_bill_id ORDER BY created_at LOOP
    v_lines_count := v_lines_count + 1;
    v_bill_value := round(round(v_line.qty * v_line.unit_cost, 2) * (1 - v_discount_ratio), 2);
    v_line_cost := v_bill_value;
    v_excl_base := v_bill_value;

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
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, cost_center_id)
    VALUES (v_je, v_line.account_id, v_line_cost, 0, v_line.cost_center_id);
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

  UPDATE public.supplier_bills
  SET status='posted', posted_at=now(), journal_entry_id=v_je,
      subtotal = CASE WHEN v_has_line_tax THEN v_subtotal ELSE subtotal END,
      tax_amount = CASE WHEN v_has_line_tax THEN v_tax_total ELSE tax_amount END,
      total_amount = v_ap_total
  WHERE id=p_bill_id;

  RETURN jsonb_build_object('ok',true,'bill_id',p_bill_id,'journal_entry_id',v_je,
    'total',v_ap_total,'tax_total',v_tax_total,'discount_total',v_discount_total,'warnings',to_jsonb(v_warnings));
END $function$;

-- 7. Wire cost_center_id / location_id into the GL when posting a check
--    (create_payment_voucher already posts as it creates, unlike bills).
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
  p_payment_account_id uuid,
  p_payment_method     text,
  p_payment_date       date,
  p_lines              jsonb,
  p_payee_id           uuid    DEFAULT NULL,
  p_account_number     text    DEFAULT NULL,
  p_cheque_number      text    DEFAULT NULL,
  p_reference_number   text    DEFAULT NULL,
  p_memo               text    DEFAULT NULL,
  p_bills_attached     int     DEFAULT 0,
  p_approved_by        text    DEFAULT NULL,
  p_accountant         text    DEFAULT NULL,
  p_checked_by         text    DEFAULT NULL,
  p_made_by            text    DEFAULT NULL,
  p_print_later        boolean DEFAULT false,
  p_address_block      text    DEFAULT NULL,
  p_location_id        uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      uuid;
  v_user_id        uuid;
  v_voucher_id     uuid;
  v_voucher_number text;
  v_journal_id     uuid;
  v_total          numeric(18,2) := 0;
  v_line           jsonb;
  v_account        accounts%ROWTYPE;
  v_amount         numeric(18,2);
  v_account_id     uuid;
  v_customer_id    uuid;
  v_is_billable    boolean;
  v_cost_center_id uuid;
  v_line_count     int := 0;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Voucher must have at least one line';
  END IF;

  IF p_payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account is required';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  SELECT * INTO v_account FROM accounts
  WHERE id = p_payment_account_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account does not exist in this tenant';
  END IF;

  IF NOT v_account.is_active THEN
    RAISE EXCEPTION 'Payment account "%" is inactive', v_account.account_name;
  END IF;

  IF NOT public.is_cash_or_bank_account(p_payment_account_id) THEN
    RAISE EXCEPTION 'Payment account must be a Cash or Bank account (Asset). Got "%".', v_account.account_name;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_count := v_line_count + 1;
    v_account_id := NULLIF(v_line->>'account_id','')::uuid;
    v_amount := COALESCE((v_line->>'amount')::numeric, 0);
    v_customer_id := NULLIF(v_line->>'customer_id','')::uuid;
    v_is_billable := COALESCE((v_line->>'is_billable')::boolean, false);
    v_cost_center_id := NULLIF(v_line->>'cost_center_id','')::uuid;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Line %: account is required', v_line_count;
    END IF;

    IF v_account_id = p_payment_account_id THEN
      RAISE EXCEPTION 'Line %: payment account cannot also appear as a line account', v_line_count;
    END IF;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Line %: amount must be greater than zero', v_line_count;
    END IF;

    IF v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Line %: amount must have at most 2 decimal places', v_line_count;
    END IF;

    SELECT * INTO v_account FROM accounts
    WHERE id = v_account_id AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line %: account does not exist in this tenant', v_line_count;
    END IF;

    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'Line %: account "%" is inactive', v_line_count, v_account.account_name;
    END IF;

    IF v_account.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense','Liability') THEN
      RAISE EXCEPTION 'Line %: account "%" of type "%" is not allowed in payment vouchers (use Expense, COGS, Other Expense, or Liability).',
        v_line_count, v_account.account_name, v_account.account_type;
    END IF;

    IF v_is_billable AND v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Line %: Billable requires a Customer:Job', v_line_count;
    END IF;

    IF v_customer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM customers WHERE id = v_customer_id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Line %: Customer:Job does not exist in this tenant', v_line_count;
    END IF;

    v_total := v_total + v_amount;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total amount must be greater than zero';
  END IF;

  IF p_reference_number IS NOT NULL AND p_reference_number <> '' THEN
    IF EXISTS (
      SELECT 1 FROM payment_vouchers
      WHERE tenant_id = v_tenant_id AND reference_number = p_reference_number
    ) THEN
      RAISE EXCEPTION 'A payment voucher with reference "%" already exists', p_reference_number;
    END IF;
  END IF;

  v_voucher_number := public.generate_voucher_number(v_tenant_id);

  INSERT INTO payment_vouchers (
    voucher_number, account_number, cheque_number, payee_id,
    payment_account_id, payment_method, reference_number,
    payment_date, memo, bills_attached,
    approved_by, accountant, checked_by, made_by,
    total_amount, status, tenant_id,
    print_later, address_block, location_id
  ) VALUES (
    v_voucher_number, NULLIF(p_account_number,''), NULLIF(p_cheque_number,''), p_payee_id,
    p_payment_account_id, p_payment_method, NULLIF(p_reference_number,''),
    p_payment_date, NULLIF(p_memo,''), COALESCE(p_bills_attached,0),
    NULLIF(p_approved_by,''), NULLIF(p_accountant,''), NULLIF(p_checked_by,''), NULLIF(p_made_by,''),
    v_total, 'posted', v_tenant_id,
    COALESCE(p_print_later, false), NULLIF(p_address_block,''), p_location_id
  )
  RETURNING id INTO v_voucher_id;

  INSERT INTO payment_voucher_lines (voucher_id, account_id, description, amount, customer_id, is_billable, cost_center_id)
  SELECT
    v_voucher_id,
    (l->>'account_id')::uuid,
    NULLIF(l->>'description',''),
    round((l->>'amount')::numeric, 2),
    NULLIF(l->>'customer_id','')::uuid,
    COALESCE((l->>'is_billable')::boolean, false),
    NULLIF(l->>'cost_center_id','')::uuid
  FROM jsonb_array_elements(p_lines) AS l;

  INSERT INTO journal_entries (
    tenant_id, description, entry_date, reference, created_by, status, location_id
  ) VALUES (
    v_tenant_id,
    'Payment Voucher ' || v_voucher_number,
    p_payment_date,
    v_voucher_number,
    v_user_id,
    'posted',
    p_location_id
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, cost_center_id)
  SELECT
    v_journal_id,
    (l->>'account_id')::uuid,
    round((l->>'amount')::numeric, 2),
    0,
    NULLIF(l->>'cost_center_id','')::uuid
  FROM jsonb_array_elements(p_lines) AS l;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES (v_journal_id, p_payment_account_id, 0, v_total);

  UPDATE payment_vouchers
  SET journal_entry_id = v_journal_id
  WHERE id = v_voucher_id;

  RETURN v_voucher_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  uuid, text, date, jsonb, uuid, text, text, text, text, int, text, text, text, text, boolean, text, uuid
) TO authenticated;
