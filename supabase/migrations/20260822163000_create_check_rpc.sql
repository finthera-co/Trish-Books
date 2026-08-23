-- ============================================================================
-- CREATE_CHECK — replaces create_payment_voucher for the Write Checks flow.
--
-- create_payment_voucher had exactly one caller (PaymentVoucherForm.tsx,
-- being retired for the new full-page WriteCheck UI) and no other DB object
-- depends on its signature, so this folds in the new pixel-spec fields
-- (mailing_address, permit_number, per-line sort_order/is_taxable) and
-- server-assigns the check number via next_check_number() when the caller
-- leaves p_cheque_number blank, rather than keeping two near-duplicate RPCs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_check(
  p_payment_account_id uuid,
  p_payment_method     text,
  p_payment_date       date,
  p_lines              jsonb,                 -- [{account_id, description, amount, customer_id, is_billable, cost_center_id, is_taxable, sort_order}]
  p_payee_id           uuid    DEFAULT NULL,
  p_payee_vendor_id    uuid    DEFAULT NULL,
  p_account_number     text    DEFAULT NULL,
  p_cheque_number      text    DEFAULT NULL,   -- blank => server-assigned via next_check_number()
  p_reference_number   text    DEFAULT NULL,
  p_memo               text    DEFAULT NULL,
  p_bills_attached     int     DEFAULT 0,
  p_approved_by        text    DEFAULT NULL,
  p_accountant         text    DEFAULT NULL,
  p_checked_by         text    DEFAULT NULL,
  p_made_by            text    DEFAULT NULL,
  p_print_later        boolean DEFAULT false,
  p_mailing_address    text    DEFAULT NULL,
  p_permit_number      text    DEFAULT NULL,
  p_location_id        uuid    DEFAULT NULL,
  p_is_recurring       boolean DEFAULT false,
  p_recurring_template_id uuid DEFAULT NULL
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
  v_cheque_number  text;
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
    RAISE EXCEPTION 'Check must have at least one line';
  END IF;

  IF p_payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Bank account is required';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  IF p_payee_id IS NOT NULL AND p_payee_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Payee must be either a customer or a vendor, not both';
  END IF;
  IF p_payee_vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM vendors WHERE id = p_payee_vendor_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Payee vendor does not exist in this tenant';
  END IF;

  SELECT * INTO v_account FROM accounts
  WHERE id = p_payment_account_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account does not exist in this tenant';
  END IF;

  IF NOT v_account.is_active THEN
    RAISE EXCEPTION 'Bank account "%" is inactive', v_account.account_name;
  END IF;

  IF NOT public.is_cash_or_bank_account(p_payment_account_id) THEN
    RAISE EXCEPTION 'Bank account must be a Cash or Bank account (Asset). Got "%".', v_account.account_name;
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
      RAISE EXCEPTION 'Line %: bank account cannot also appear as a line account', v_line_count;
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
      RAISE EXCEPTION 'Line %: account "%" of type "%" is not allowed on a check (use Expense, COGS, Other Expense, or Liability).',
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
      RAISE EXCEPTION 'A check with reference "%" already exists', p_reference_number;
    END IF;
  END IF;

  v_voucher_number := public.generate_voucher_number(v_tenant_id);

  -- Server-assigned check number when the caller leaves it blank.
  v_cheque_number := NULLIF(p_cheque_number, '');
  IF v_cheque_number IS NULL AND NOT p_print_later THEN
    v_cheque_number := public.next_check_number(p_payment_account_id);
  END IF;

  INSERT INTO payment_vouchers (
    voucher_number, account_number, cheque_number, payee_id, payee_vendor_id,
    payment_account_id, payment_method, reference_number,
    payment_date, memo, bills_attached,
    approved_by, accountant, checked_by, made_by,
    total_amount, status, tenant_id,
    print_later, mailing_address, permit_number, location_id,
    is_recurring, recurring_template_id
  ) VALUES (
    v_voucher_number, NULLIF(p_account_number,''), v_cheque_number, p_payee_id, p_payee_vendor_id,
    p_payment_account_id, p_payment_method, NULLIF(p_reference_number,''),
    p_payment_date, NULLIF(p_memo,''), COALESCE(p_bills_attached,0),
    NULLIF(p_approved_by,''), NULLIF(p_accountant,''), NULLIF(p_checked_by,''), NULLIF(p_made_by,''),
    v_total, 'posted', v_tenant_id,
    COALESCE(p_print_later, false), NULLIF(p_mailing_address,''), NULLIF(p_permit_number,''), p_location_id,
    COALESCE(p_is_recurring, false), p_recurring_template_id
  )
  RETURNING id INTO v_voucher_id;

  INSERT INTO payment_voucher_lines (
    voucher_id, account_id, description, amount, customer_id, is_billable, cost_center_id, is_taxable, sort_order
  )
  SELECT
    v_voucher_id,
    (l->>'account_id')::uuid,
    NULLIF(l->>'description',''),
    round((l->>'amount')::numeric, 2),
    NULLIF(l->>'customer_id','')::uuid,
    COALESCE((l->>'is_billable')::boolean, false),
    NULLIF(l->>'cost_center_id','')::uuid,
    COALESCE((l->>'is_taxable')::boolean, false),
    COALESCE((l->>'sort_order')::int, 0)
  FROM jsonb_array_elements(p_lines) AS l;

  INSERT INTO journal_entries (
    tenant_id, description, entry_date, reference, created_by, status, location_id
  ) VALUES (
    v_tenant_id,
    'Check ' || COALESCE(v_cheque_number, v_voucher_number) || ' — ' || v_voucher_number,
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

  INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (
    v_tenant_id, v_user_id, 'Check Created', 'payment_vouchers', v_voucher_id,
    jsonb_build_object('voucher_number', v_voucher_number, 'cheque_number', v_cheque_number, 'total_amount', v_total, 'payment_account_id', p_payment_account_id)
  );

  RETURN v_voucher_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_check(
  uuid, text, date, jsonb, uuid, uuid, text, text, text, text, int, text, text, text, text, boolean, text, text, uuid, boolean, uuid
) TO authenticated;
