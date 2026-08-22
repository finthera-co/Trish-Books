-- ============================================================================
-- MULTI-CURRENCY AP (Phase 2 of 4 — QuickBooks parity)
-- Mirrors the existing AR pattern (20260625050000_multicurrency_ar.sql)
-- exactly: same shared `exchange_rates` table and `fx_rate()` function reused
-- as-is (no second currency system), same "document amounts in foreign
-- currency + one exchange_rate at document date, GL booked in base" model,
-- same period-end revaluation + auto-reversal shape.
--
-- Scope guard: a foreign-currency bill may NOT carry tax codes (VAT/WHT are
-- domestic SL taxes; combining them with FX conversion inside the existing
-- reverse-charge/recoverable-tax branches of post_supplier_bill would be a
-- real correctness risk to retrofit blind). LKR bills are completely
-- unaffected — exchange_rate defaults to 1 and every amount is unchanged.
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'LKR';

ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'LKR',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.supplier_bills.exchange_rate IS
  'Foreign→base (LKR) rate at the bill date. Bill amounts (subtotal/tax/total) are in supplier_bills.currency; GL is booked in base = amount × exchange_rate.';

ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'LKR';

-- ── Period-end revaluation log (mirrors ar_fx_revaluations) ─────────────────
CREATE TABLE IF NOT EXISTS public.ap_fx_revaluations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_end                DATE NOT NULL,
  bill_id                   UUID REFERENCES public.supplier_bills(id),
  currency                  TEXT NOT NULL,
  open_amount_fc            NUMERIC NOT NULL,
  rate_bill                 NUMERIC NOT NULL,
  rate_period_end           NUMERIC NOT NULL,
  base_at_bill              NUMERIC NOT NULL,
  base_at_period_end        NUMERIC NOT NULL,
  fx_delta                  NUMERIC NOT NULL,     -- +gain / −loss (base), same sign convention as ar_fx_revaluations
  journal_entry_id          UUID REFERENCES public.journal_entries(id),
  reversal_journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by                UUID REFERENCES public.users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_fx_reval_tenant ON public.ap_fx_revaluations (tenant_id, period_end DESC);

ALTER TABLE public.ap_fx_revaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ap_fx_reval_select ON public.ap_fx_revaluations;
CREATE POLICY ap_fx_reval_select ON public.ap_fx_revaluations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT ON public.ap_fx_revaluations TO authenticated;

-- ── Period-end revaluation routine ──────────────────────────────────────────
-- AP is a LIABILITY, so the gain/loss polarity is the mirror image of AR:
-- if the outstanding foreign AP is now worth MORE in base (it costs more to
-- pay off), that is a LOSS; worth LESS is a GAIN. fx_delta is stored using
-- the same "+gain / −loss" convention as ar_fx_revaluations for consistent
-- reporting, so the sign is flipped relative to the raw base movement.
CREATE OR REPLACE FUNCTION public.revalue_ap_fx(p_period_end DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_ap_acct     UUID;
  v_gain_acct   UUID;
  v_loss_acct   UUID;
  v_net         NUMERIC := 0;
  v_count       INTEGER := 0;
  v_je          UUID;
  v_rev_je      UUID;
  r             RECORD;
  v_base_out    NUMERIC;
  v_fc_out      NUMERIC;
  v_pe_rate     NUMERIC;
  v_base_pe     NUMERIC;
  v_delta_gain  NUMERIC;
BEGIN
  SELECT u.id, u.tenant_id, rl.role_name INTO v_user_id, v_tenant_id, v_role
  FROM public.users u LEFT JOIN public.roles rl ON rl.id = u.role_id
  WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role NOT IN ('Super Admin','Primary Admin','Company Admin','Accountant') THEN
    RAISE EXCEPTION 'ROLE_CANNOT_REVALUE: %', COALESCE(v_role,'unknown') USING ERRCODE = 'P0001';
  END IF;

  SELECT ap_account_id, fx_gain_account_id, fx_loss_account_id
    INTO v_ap_acct, v_gain_acct, v_loss_acct
  FROM public.account_settings WHERE tenant_id = v_tenant_id;
  IF v_ap_acct IS NULL OR v_gain_acct IS NULL OR v_loss_acct IS NULL THEN
    RAISE EXCEPTION 'FX accounts not configured (Settings → Account Mapping: AP, FX Gain, FX Loss)' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: clear any prior run for this period (incl. its journals).
  FOR r IN SELECT journal_entry_id, reversal_journal_entry_id FROM public.ap_fx_revaluations
           WHERE tenant_id = v_tenant_id AND period_end = p_period_end LOOP
    DELETE FROM public.journal_lines WHERE journal_entry_id IN (r.journal_entry_id, r.reversal_journal_entry_id);
    DELETE FROM public.journal_entries WHERE id IN (r.journal_entry_id, r.reversal_journal_entry_id);
  END LOOP;
  DELETE FROM public.ap_fx_revaluations WHERE tenant_id = v_tenant_id AND period_end = p_period_end;

  INSERT INTO public.journal_entries (tenant_id, entry_date, description, status, posted_at, created_by, is_system_generated, entry_type, source_type)
  VALUES (v_tenant_id, p_period_end, 'AP FX revaluation ' || p_period_end, 'posted', now(), v_user_id, true, 'fx_revaluation', 'fx_revaluation')
  RETURNING id INTO v_je;
  INSERT INTO public.journal_entries (tenant_id, entry_date, description, status, posted_at, created_by, is_system_generated, entry_type, source_type, reversal_of)
  VALUES (v_tenant_id, p_period_end + 1, 'Reversal: AP FX revaluation ' || p_period_end, 'posted', now(), v_user_id, true, 'fx_revaluation_reversal', 'fx_revaluation_reversal', v_je)
  RETURNING id INTO v_rev_je;

  -- One reval row per open foreign bill. Outstanding = total_amount - amount_paid
  -- (the same live balance ap_aging_report and the Bill List already use — the
  -- dedicated ap_transactions table is legacy and unwritten by any live path).
  FOR r IN
    SELECT b.id, b.currency, b.exchange_rate,
           (b.total_amount - b.amount_paid) AS base_out
    FROM public.supplier_bills b
    WHERE b.tenant_id = v_tenant_id
      AND b.currency IS NOT NULL AND b.currency <> 'LKR'
      AND b.status NOT IN ('draft','cancelled')
      AND b.bill_date <= p_period_end
  LOOP
    v_base_out := COALESCE(r.base_out, 0);
    IF v_base_out <= 0.005 OR r.exchange_rate IS NULL OR r.exchange_rate <= 0 THEN CONTINUE; END IF;
    v_fc_out     := v_base_out / r.exchange_rate;
    v_pe_rate    := public.fx_rate(v_tenant_id, r.currency, p_period_end);
    v_base_pe    := round(v_fc_out * v_pe_rate, 2);
    v_delta_gain := round(v_base_out - v_base_pe, 2);   -- AP costs MORE (v_base_pe > v_base_out) => negative => loss
    IF v_delta_gain = 0 THEN CONTINUE; END IF;

    v_net := v_net + v_delta_gain;
    v_count := v_count + 1;
    INSERT INTO public.ap_fx_revaluations (
      tenant_id, period_end, bill_id, currency, open_amount_fc, rate_bill, rate_period_end,
      base_at_bill, base_at_period_end, fx_delta, journal_entry_id, reversal_journal_entry_id, created_by)
    VALUES (v_tenant_id, p_period_end, r.id, r.currency, round(v_fc_out,2), r.exchange_rate, v_pe_rate,
            v_base_out, v_base_pe, v_delta_gain, v_je, v_rev_je, v_user_id);
  END LOOP;

  v_net := round(v_net, 2);
  IF v_count = 0 OR v_net = 0 THEN
    DELETE FROM public.journal_entries WHERE id IN (v_je, v_rev_je);
    DELETE FROM public.ap_fx_revaluations WHERE tenant_id = v_tenant_id AND period_end = p_period_end;
    RETURN jsonb_build_object('ok', true, 'bills', v_count, 'net_fx', 0, 'message', 'No FX adjustment needed');
  END IF;

  -- v_net > 0 (net gain, AP now costs less) => Dr AP / Cr Gain.
  -- v_net < 0 (net loss, AP now costs more)  => Dr Loss / Cr AP.
  IF v_net > 0 THEN
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_je, v_ap_acct, v_net, 0), (v_je, v_gain_acct, 0, v_net);
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_rev_je, v_ap_acct, 0, v_net), (v_rev_je, v_gain_acct, v_net, 0);
  ELSE
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_je, v_loss_acct, -v_net, 0), (v_je, v_ap_acct, 0, -v_net);
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_rev_je, v_loss_acct, 0, -v_net), (v_rev_je, v_ap_acct, -v_net, 0);
  END IF;

  RETURN jsonb_build_object('ok', true, 'bills', v_count, 'net_fx', v_net,
                            'journal_id', v_je, 'reversal_journal_id', v_rev_je);
END;
$$;

REVOKE ALL ON FUNCTION public.revalue_ap_fx(DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.revalue_ap_fx(DATE) TO authenticated;

-- ── post_supplier_bill: book foreign-currency bills in base at exchange_rate ─
-- Guard: foreign-currency bills cannot carry tax codes (see header comment).
-- Every Dr/Cr that reaches journal_lines is scaled by the same exchange_rate,
-- so if the entry balances in the bill's currency it is guaranteed to balance
-- in base too — no separate FX plug is needed at bill-posting time (unlike
-- bill *payment*, where the settlement date's rate can differ from the bill's
-- own rate and a realized FX plug is required).
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
  v_rate numeric;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_bill FROM public.supplier_bills WHERE id=p_bill_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.status<>'draft' THEN RAISE EXCEPTION 'Only draft bills can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_bill.bill_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_bill.bill_date;
  END IF;

  v_rate := COALESCE(v_bill.exchange_rate, 1);

  IF v_bill.currency IS NOT NULL AND v_bill.currency <> 'LKR' THEN
    IF EXISTS (
      SELECT 1 FROM public.supplier_bill_lines sbl
      WHERE sbl.bill_id = p_bill_id AND (sbl.tax_code_id IS NOT NULL OR sbl.tax_group_id IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'Foreign-currency bills cannot carry tax codes. Enter tax-carrying bills in LKR.';
    END IF;
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
      OR (v_bill.currency = 'LKR' AND v_profile.default_purchase_tax_code_id IS NOT NULL)
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
    IF v_eff_group IS NULL AND v_eff_code IS NULL AND v_bill.currency = 'LKR' THEN
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
    VALUES (v_je, v_line.account_id, round(v_line_cost * v_rate, 2), 0, v_line.cost_center_id);
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
    VALUES (v_je, v_settings.tax_payable_account_id, round(v_bill.tax_amount * v_rate, 2), 0);
    v_dr_total := v_dr_total + v_bill.tax_amount;
    v_ap_total := v_ap_total + v_bill.tax_amount;
    v_tax_total := v_tax_total + v_bill.tax_amount;
  END IF;

  IF v_bill.shipping_amount > 0 THEN
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_bill.shipping_account_id, round(v_bill.shipping_amount * v_rate, 2), 0);
    v_dr_total := v_dr_total + v_bill.shipping_amount;
    v_ap_total := v_ap_total + v_bill.shipping_amount;
  END IF;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (v_je, v_ap, 0, round(v_ap_total * v_rate, 2))
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
