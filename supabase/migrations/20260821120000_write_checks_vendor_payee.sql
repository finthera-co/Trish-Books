-- ============================================================================
-- WRITE CHECKS — vendor payee support + permit_no
--
-- payment_vouchers.payee_id references customers only — there is no way to
-- write a check to a vendor, which is the far more common real-world use of
-- "Write Checks" (paying a supplier, contractor, etc., not a customer). This
-- adds an independent payee_vendor_id column (customer and vendor payee are
-- mutually exclusive, enforced by CHECK) rather than repurposing payee_id, to
-- avoid disturbing existing posted vouchers that already reference a
-- customer. Also adds permit_no, matching the field added to supplier_bills
-- in the Enter Bill redesign (20260821110000).
-- ============================================================================

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS payee_vendor_id uuid REFERENCES public.vendors(id),
  ADD COLUMN IF NOT EXISTS permit_no text;

ALTER TABLE public.payment_vouchers
  DROP CONSTRAINT IF EXISTS payment_vouchers_payee_exclusive;
ALTER TABLE public.payment_vouchers
  ADD CONSTRAINT payment_vouchers_payee_exclusive
  CHECK (payee_id IS NULL OR payee_vendor_id IS NULL);

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
  p_location_id        uuid    DEFAULT NULL,
  p_payee_vendor_id    uuid    DEFAULT NULL,
  p_permit_no          text    DEFAULT NULL
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
    voucher_number, account_number, cheque_number, payee_id, payee_vendor_id,
    payment_account_id, payment_method, reference_number,
    payment_date, memo, bills_attached,
    approved_by, accountant, checked_by, made_by,
    total_amount, status, tenant_id,
    print_later, address_block, location_id, permit_no
  ) VALUES (
    v_voucher_number, NULLIF(p_account_number,''), NULLIF(p_cheque_number,''), p_payee_id, p_payee_vendor_id,
    p_payment_account_id, p_payment_method, NULLIF(p_reference_number,''),
    p_payment_date, NULLIF(p_memo,''), COALESCE(p_bills_attached,0),
    NULLIF(p_approved_by,''), NULLIF(p_accountant,''), NULLIF(p_checked_by,''), NULLIF(p_made_by,''),
    v_total, 'posted', v_tenant_id,
    COALESCE(p_print_later, false), NULLIF(p_address_block,''), p_location_id, NULLIF(p_permit_no,'')
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
  uuid, text, date, jsonb, uuid, text, text, text, text, int, text, text, text, text, boolean, text, uuid, uuid, text
) TO authenticated;
