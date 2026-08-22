-- ============================================================================
-- WRITE CHECKS UPGRADE
-- Upgrades Payment Vouchers into a QuickBooks-style "Write Checks" feature:
-- adds a Print Later flag + stored address block on the header, and
-- Customer:Job / Billable job-costing columns per line.
--
-- NOTE: the original ask included a second "Items" tab (inventory/product
-- lines posting to purchase_account_id + a stock_movements row). That is
-- intentionally NOT implemented here — the inventory subsystem
-- (inventory_items, stock_movements, apply_stock_movement()) was dropped in
-- 20260820075032_remove_inventory_feature_v2.sql, one day before this
-- migration, so Write Checks stays account-based only (Expenses lines),
-- matching current DB reality instead of reintroducing dropped tables.
-- ============================================================================

-- 1. payment_voucher_lines: job-costing columns
ALTER TABLE public.payment_voucher_lines
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS is_billable boolean NOT NULL DEFAULT false;

ALTER TABLE public.payment_voucher_lines
  DROP CONSTRAINT IF EXISTS pvl_billable_requires_customer;
ALTER TABLE public.payment_voucher_lines
  ADD CONSTRAINT pvl_billable_requires_customer
    CHECK (NOT is_billable OR customer_id IS NOT NULL);

-- 2. payment_vouchers: check-header columns
ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS print_later boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS address_block text;

-- 3. payment_voucher_lines policy was USING-only; add an explicit WITH CHECK
--    so inserts/updates are constrained the same way reads are.
DROP POLICY IF EXISTS "Authorized users can manage payment voucher lines" ON public.payment_voucher_lines;
CREATE POLICY "Authorized users can manage payment voucher lines"
  ON public.payment_voucher_lines FOR ALL TO authenticated
  USING (voucher_id IN (SELECT id FROM public.payment_vouchers WHERE tenant_id = get_user_tenant_id()))
  WITH CHECK (voucher_id IN (SELECT id FROM public.payment_vouchers WHERE tenant_id = get_user_tenant_id()));

-- 4. Replace create_payment_voucher: add print_later/address_block header
--    params, and per-line customer_id/is_billable job-costing fields.
--    New params are appended with defaults so this remains a drop-in
--    CREATE OR REPLACE of the existing signature.
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
  p_payment_account_id uuid,
  p_payment_method     text,
  p_payment_date       date,
  p_lines              jsonb,                 -- [{account_id, description, amount, customer_id, is_billable}]
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
  p_address_block      text    DEFAULT NULL
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
  v_line_count     int := 0;
BEGIN
  -- A. Caller / tenant resolution
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- B. Structural validation
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Voucher must have at least one line';
  END IF;

  IF p_payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account is required';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  -- C. Payment-account rules: must be Cash/Bank Asset, active, in tenant
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

  -- D. Validate each line
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_count := v_line_count + 1;
    v_account_id := NULLIF(v_line->>'account_id','')::uuid;
    v_amount := COALESCE((v_line->>'amount')::numeric, 0);
    v_customer_id := NULLIF(v_line->>'customer_id','')::uuid;
    v_is_billable := COALESCE((v_line->>'is_billable')::boolean, false);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Line %: account is required', v_line_count;
    END IF;

    IF v_account_id = p_payment_account_id THEN
      RAISE EXCEPTION 'Line %: payment account cannot also appear as a line account', v_line_count;
    END IF;

    -- Round + amount checks
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Line %: amount must be greater than zero', v_line_count;
    END IF;

    IF v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Line %: amount must have at most 2 decimal places', v_line_count;
    END IF;

    -- Account validity
    SELECT * INTO v_account FROM accounts
    WHERE id = v_account_id AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line %: account does not exist in this tenant', v_line_count;
    END IF;

    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'Line %: account "%" is inactive', v_line_count, v_account.account_name;
    END IF;

    -- Type whitelist: Expense (incl. COGS / Other Expense) or Liability
    IF v_account.account_type NOT IN ('Expense','Cost of Goods Sold','Other Expense','Liability') THEN
      RAISE EXCEPTION 'Line %: account "%" of type "%" is not allowed in payment vouchers (use Expense, COGS, Other Expense, or Liability).',
        v_line_count, v_account.account_name, v_account.account_type;
    END IF;

    -- Job costing: Billable requires a Customer:Job, and it must belong to this tenant
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

  -- E. Idempotency: explicit reference duplicate check (index also enforces)
  IF p_reference_number IS NOT NULL AND p_reference_number <> '' THEN
    IF EXISTS (
      SELECT 1 FROM payment_vouchers
      WHERE tenant_id = v_tenant_id AND reference_number = p_reference_number
    ) THEN
      RAISE EXCEPTION 'A payment voucher with reference "%" already exists', p_reference_number;
    END IF;
  END IF;

  -- F. Generate voucher number
  v_voucher_number := public.generate_voucher_number(v_tenant_id);

  -- G. Insert voucher (status starts as 'posted' to mirror existing flow)
  INSERT INTO payment_vouchers (
    voucher_number, account_number, cheque_number, payee_id,
    payment_account_id, payment_method, reference_number,
    payment_date, memo, bills_attached,
    approved_by, accountant, checked_by, made_by,
    total_amount, status, tenant_id,
    print_later, address_block
  ) VALUES (
    v_voucher_number, NULLIF(p_account_number,''), NULLIF(p_cheque_number,''), p_payee_id,
    p_payment_account_id, p_payment_method, NULLIF(p_reference_number,''),
    p_payment_date, NULLIF(p_memo,''), COALESCE(p_bills_attached,0),
    NULLIF(p_approved_by,''), NULLIF(p_accountant,''), NULLIF(p_checked_by,''), NULLIF(p_made_by,''),
    v_total, 'posted', v_tenant_id,
    COALESCE(p_print_later, false), NULLIF(p_address_block,'')
  )
  RETURNING id INTO v_voucher_id;

  -- H. Insert lines
  INSERT INTO payment_voucher_lines (voucher_id, account_id, description, amount, customer_id, is_billable)
  SELECT
    v_voucher_id,
    (l->>'account_id')::uuid,
    NULLIF(l->>'description',''),
    round((l->>'amount')::numeric, 2),
    NULLIF(l->>'customer_id','')::uuid,
    COALESCE((l->>'is_billable')::boolean, false)
  FROM jsonb_array_elements(p_lines) AS l;

  -- I. Create balanced journal entry (server computes totals)
  INSERT INTO journal_entries (
    tenant_id, description, entry_date, reference, created_by, status
  ) VALUES (
    v_tenant_id,
    'Payment Voucher ' || v_voucher_number,
    p_payment_date,
    v_voucher_number,
    v_user_id,
    'posted'
  )
  RETURNING id INTO v_journal_id;

  -- Debits = each line; Credit = aggregated payment account
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT
    v_journal_id,
    (l->>'account_id')::uuid,
    round((l->>'amount')::numeric, 2),
    0
  FROM jsonb_array_elements(p_lines) AS l;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES (v_journal_id, p_payment_account_id, 0, v_total);

  -- J. Link journal back to voucher
  UPDATE payment_vouchers
  SET journal_entry_id = v_journal_id
  WHERE id = v_voucher_id;

  RETURN v_voucher_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  uuid, text, date, jsonb, uuid, text, text, text, text, int, text, text, text, text, boolean, text
) TO authenticated;
