-- ============================================================================
-- ATOMIC BILL PAYMENT
--
-- Pay Bills (PayBillsDialog.tsx) previously recorded a payment as five
-- separate client-side writes: insert bill_payments, insert
-- bill_payment_allocations, insert journal_entries+journal_lines+ap_subledger
-- (+tax_transactions for WHT) via postBillPayment/post() in
-- postingEngine.ts, link journal_entry_id back onto bill_payments, then
-- update supplier_bills.status. None of that was wrapped in a transaction,
-- so a failure partway through (e.g. the GL post step throwing) left a
-- bill_payments row + allocations already committed — and the bill's
-- amount_paid already reduced by the trigger — with NO journal entry ever
-- created. There was also no DB-level guard against two concurrent payments
-- jointly over-allocating the same bill: the only check was client-side,
-- against a possibly-stale query cache.
--
-- record_bill_payment() replaces that whole sequence with one SECURITY
-- DEFINER function so it's atomic, and takes FOR UPDATE locks on the bills
-- being paid so overlapping payments can't both succeed against the same
-- balance. WHT amount/rate/tax_code_id (LKR only) and the FX settlement
-- rate/gain-loss accounts (foreign-currency bills only — the two are
-- mutually exclusive today, see useRecordBillPayment) are still computed
-- client-side by the existing shared engines; that logic is out of scope
-- here. The WHT certificate number, however, is now issued from inside
-- this transaction via the existing concurrency-safe next_tenant_number()
-- counter, closing the COUNT(*)+1 race in generate_wht_certificate_no.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_bill_payment(
  p_vendor_id        uuid,
  p_payment_date     date,
  p_amount           numeric,          -- gross amount in the bill's own currency (p_currency)
  p_bank_account_id  uuid,
  p_ap_account_id    uuid,
  p_allocations      jsonb,
  p_reference        text    DEFAULT NULL,
  p_notes            text    DEFAULT NULL,
  p_payment_nature   text    DEFAULT NULL,
  p_wht              jsonb   DEFAULT NULL,
  p_payment_method   text    DEFAULT 'Cheque',
  p_print_later      boolean DEFAULT false,
  p_check_number     text    DEFAULT NULL,
  p_currency         text    DEFAULT 'LKR',
  p_ap_amount_base   numeric DEFAULT NULL,   -- AP relief in base currency; defaults to p_amount when LKR
  p_fx               jsonb   DEFAULT NULL    -- { net_bank_base, fx_gain_account_id, fx_loss_account_id } — foreign-currency only
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant           uuid;
  v_user             uuid;
  v_bank             accounts%ROWTYPE;
  v_ap               accounts%ROWTYPE;
  v_alloc            RECORD;
  v_bill             supplier_bills%ROWTYPE;
  v_alloc_total      numeric(18,2) := 0;
  v_wht_amount       numeric(18,2) := 0;
  v_ap_base          numeric(18,2);
  v_net_bank         numeric(18,2);
  v_fx_delta         numeric(18,2);
  v_payment_id       uuid;
  v_je               uuid;
  v_ap_line_id       uuid;
  v_cert_no          text;
  v_cert_seq         bigint;
  v_alloc_count      int := 0;
  v_dr_total         numeric(18,2);
  v_cr_total         numeric(18,2);
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Vendor does not exist in this tenant';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'At least one bill allocation is required';
  END IF;

  IF p_wht IS NOT NULL AND p_fx IS NOT NULL THEN
    RAISE EXCEPTION 'WHT and foreign-currency FX settlement cannot both apply to one payment';
  END IF;

  IF NOT public.is_cash_or_bank_account(p_bank_account_id) THEN
    RAISE EXCEPTION 'Bank/cash account must be an active Cash or Bank account';
  END IF;
  SELECT * INTO v_bank FROM public.accounts WHERE id = p_bank_account_id AND tenant_id = v_tenant;

  SELECT * INTO v_ap FROM public.accounts WHERE id = p_ap_account_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'AP control account does not exist in this tenant'; END IF;
  IF NOT v_ap.is_active THEN RAISE EXCEPTION 'AP control account "%" is inactive', v_ap.account_name; END IF;

  IF p_payment_method = 'Cheque' AND NOT COALESCE(p_print_later, false)
     AND (p_check_number IS NULL OR btrim(p_check_number) = '') THEN
    RAISE EXCEPTION 'Enter a check number, or set Print Later';
  END IF;

  v_ap_base := COALESCE(p_ap_amount_base, p_amount);
  IF v_ap_base <= 0 THEN
    RAISE EXCEPTION 'AP relief amount must be greater than zero';
  END IF;

  IF p_wht IS NOT NULL THEN
    v_wht_amount := COALESCE((p_wht->>'amount')::numeric, 0);
    IF v_wht_amount > 0 THEN
      IF NULLIF(p_wht->>'tax_code_id','') IS NULL OR NULLIF(p_wht->>'wht_payable_account_id','') IS NULL THEN
        RAISE EXCEPTION 'WHT applies to this payment but no tax code / WHT payable account was supplied';
      END IF;
    END IF;
  END IF;

  IF p_fx IS NOT NULL THEN
    IF NULLIF(p_fx->>'net_bank_base','') IS NULL
       OR NULLIF(p_fx->>'fx_gain_account_id','') IS NULL
       OR NULLIF(p_fx->>'fx_loss_account_id','') IS NULL THEN
      RAISE EXCEPTION 'Foreign-currency payment requires net_bank_base, fx_gain_account_id and fx_loss_account_id';
    END IF;
    v_net_bank := round((p_fx->>'net_bank_base')::numeric, 2);
  ELSE
    v_net_bank := round(v_ap_base - v_wht_amount, 2);
  END IF;
  IF v_net_bank < 0 THEN
    RAISE EXCEPTION 'WHT amount cannot exceed the AP relief amount';
  END IF;

  -- Lock every targeted bill up front, in a stable order, so two concurrent
  -- payments against overlapping bills can't both pass validation. Bill
  -- balances (total_amount/amount_paid) are in the bill's OWN currency
  -- (p_currency), same units as amount_applied, so this compares correctly
  -- regardless of whether the payment is foreign-currency or LKR.
  FOR v_alloc IN
    SELECT (a->>'bill_id')::uuid AS bill_id, (a->>'amount_applied')::numeric AS amount_applied
    FROM jsonb_array_elements(p_allocations) AS a
    ORDER BY (a->>'bill_id')::uuid
  LOOP
    v_alloc_count := v_alloc_count + 1;
    IF v_alloc.bill_id IS NULL OR v_alloc.amount_applied IS NULL OR v_alloc.amount_applied <= 0 THEN
      RAISE EXCEPTION 'Allocation %: bill_id and a positive amount_applied are required', v_alloc_count;
    END IF;

    SELECT * INTO v_bill FROM public.supplier_bills
    WHERE id = v_alloc.bill_id AND tenant_id = v_tenant
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation %: bill not found', v_alloc_count; END IF;
    IF v_bill.vendor_id <> p_vendor_id THEN
      RAISE EXCEPTION 'Allocation %: bill % does not belong to this vendor', v_alloc_count, v_bill.bill_number;
    END IF;
    IF v_bill.status IN ('draft','cancelled','reversed') THEN
      RAISE EXCEPTION 'Allocation %: bill % is % and cannot be paid', v_alloc_count, v_bill.bill_number, v_bill.status;
    END IF;
    IF v_alloc.amount_applied > (v_bill.total_amount - v_bill.amount_paid) + 0.005 THEN
      RAISE EXCEPTION 'Allocation %: amount for bill % exceeds its remaining balance', v_alloc_count, v_bill.bill_number;
    END IF;

    v_alloc_total := v_alloc_total + v_alloc.amount_applied;
  END LOOP;

  IF abs(v_alloc_total - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Allocation total (%) does not match payment amount (%)', v_alloc_total, p_amount;
  END IF;

  INSERT INTO public.bill_payments (
    tenant_id, vendor_id, payment_date, amount, currency, bank_account_id, ap_account_id,
    reference, notes, status, wht_amount, wht_rule_id, wht_certificate_no,
    wht_override_reason, payment_nature, payment_method, print_later, check_number, created_by
  ) VALUES (
    v_tenant, p_vendor_id, p_payment_date, p_amount, COALESCE(NULLIF(p_currency,''), 'LKR'),
    p_bank_account_id, p_ap_account_id,
    NULLIF(p_reference,''), NULLIF(p_notes,''), 'posted', v_wht_amount,
    NULLIF(p_wht->>'rule_id','')::uuid, NULL,
    NULLIF(p_wht->>'override_reason',''), NULLIF(p_payment_nature,''),
    p_payment_method, COALESCE(p_print_later,false),
    CASE WHEN COALESCE(p_print_later,false) THEN NULL ELSE NULLIF(p_check_number,'') END,
    v_user
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.bill_payment_allocations (tenant_id, payment_id, bill_id, amount_applied)
  SELECT v_tenant, v_payment_id, (a->>'bill_id')::uuid, (a->>'amount_applied')::numeric
  FROM jsonb_array_elements(p_allocations) AS a;

  INSERT INTO public.journal_entries (
    tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type
  ) VALUES (
    v_tenant, p_payment_date,
    'Bill payment' || CASE WHEN p_reference IS NOT NULL AND p_reference <> '' THEN ' - ' || p_reference ELSE '' END,
    p_reference, 'posted', now(), v_user, 'bill_payment', v_payment_id, true, 'bill_payment'
  )
  RETURNING id INTO v_je;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, vendor_id)
  VALUES (v_je, p_ap_account_id, v_ap_base, 0, p_vendor_id)
  RETURNING id INTO v_ap_line_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES (v_je, p_bank_account_id, 0, v_net_bank);

  INSERT INTO public.ap_subledger (
    tenant_id, vendor_id, journal_line_id, journal_id, document_type, document_id, debit, credit, balance, amount
  ) VALUES (
    v_tenant, p_vendor_id, v_ap_line_id, v_je, 'bill_payment', v_payment_id, v_ap_base, 0, v_ap_base, v_ap_base
  );

  IF v_wht_amount > 0 THEN
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (v_je, (p_wht->>'wht_payable_account_id')::uuid, 0, v_wht_amount);

    -- Certificate numbers are issued here, inside the transaction, via the
    -- same concurrency-safe counter used for other tenant-scoped document
    -- numbers — closing the COUNT(*)+1 race in generate_wht_certificate_no.
    v_cert_seq := public.next_tenant_number(v_tenant, 'wht_' || to_char(p_payment_date, 'YYYY'));
    v_cert_no := 'WHT-' || to_char(p_payment_date, 'YYYY') || '-' || LPAD(v_cert_seq::text, 5, '0');

    UPDATE public.bill_payments SET wht_certificate_no = v_cert_no WHERE id = v_payment_id;

    INSERT INTO public.tax_transactions (
      tenant_id, tax_code_id, direction, source_type, source_id, base_amount, tax_amount,
      tax_amount_txn_currency, currency, fx_rate, rate_applied, transaction_date,
      journal_entry_id, wht_certificate_no, note
    ) VALUES (
      v_tenant, (p_wht->>'tax_code_id')::uuid, 'wht_payable', 'bill_payment', v_payment_id,
      COALESCE((p_wht->>'base_amount')::numeric, v_ap_base), v_wht_amount, v_wht_amount, 'LKR', 1,
      COALESCE((p_wht->>'rate')::numeric, 0), p_payment_date, v_je, v_cert_no,
      NULLIF(p_wht->>'override_reason','')
    );
  END IF;

  IF p_fx IS NOT NULL THEN
    v_fx_delta := round(v_ap_base - v_net_bank, 2);
    IF v_fx_delta > 0.005 THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_je, (p_fx->>'fx_gain_account_id')::uuid, 0, v_fx_delta);
    ELSIF v_fx_delta < -0.005 THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_je, (p_fx->>'fx_loss_account_id')::uuid, -v_fx_delta, 0);
    END IF;
  END IF;

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO v_dr_total, v_cr_total
  FROM public.journal_lines WHERE journal_entry_id = v_je;
  IF abs(v_dr_total - v_cr_total) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry out of balance. Debits=% Credits=%.', v_dr_total, v_cr_total;
  END IF;

  UPDATE public.bill_payments SET journal_entry_id = v_je WHERE id = v_payment_id;

  -- fn_update_bill_amount_paid already recomputed amount_paid as a fresh
  -- SUM(amount_applied) when the allocation rows above were inserted (it
  -- fires synchronously, AFTER INSERT, within this same transaction) — so
  -- this only flips status once a bill is fully settled, it must not add
  -- amount_applied again on top.
  UPDATE public.supplier_bills b
  SET status = 'paid'
  WHERE b.id IN (SELECT (x->>'bill_id')::uuid FROM jsonb_array_elements(p_allocations) AS x)
    AND b.status <> 'paid'
    AND b.amount_paid >= b.total_amount - 0.005;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'journal_entry_id', v_je,
    'wht_certificate_no', v_cert_no,
    'net_bank_amount', v_net_bank
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_bill_payment(
  uuid, date, numeric, uuid, uuid, jsonb, text, text, text, jsonb, text, boolean, text, text, numeric, jsonb
) TO authenticated;
