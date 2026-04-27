
-- ============================================================================
-- Payment Voucher Hardening: validation, atomic RPC, immutability, idempotency
-- ============================================================================

-- 1. Helper: classify whether an account can serve as a payment (cash/bank) account
CREATE OR REPLACE FUNCTION public.is_cash_or_bank_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = p_account_id
      AND a.is_active = true
      AND a.account_type = 'Asset'
      AND (
        a.account_subtype IN ('Cash on Hand','Checking','Savings','Bank')
        OR lower(a.account_name) LIKE '%cash%'
        OR lower(a.account_name) LIKE '%bank%'
        OR lower(a.account_name) LIKE '%checking%'
        OR lower(a.account_name) LIKE '%savings%'
      )
  );
$$;

-- 2. Idempotency: unique reference number per tenant (when provided)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_vouchers_tenant_reference
  ON public.payment_vouchers (tenant_id, reference_number)
  WHERE reference_number IS NOT NULL AND reference_number <> '';

-- 3. Immutability trigger: block edits/deletes once posted
CREATE OR REPLACE FUNCTION public.block_posted_payment_voucher_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Cannot delete posted payment voucher %. Create a reversal instead.', OLD.voucher_number;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    -- Allow only status transition to 'reversed' or 'voided'
    IF NEW.status NOT IN ('posted','reversed','voided') THEN
      RAISE EXCEPTION 'Posted payment voucher % can only be reversed/voided.', OLD.voucher_number;
    END IF;

    IF NEW.status = 'posted' AND (
         NEW.voucher_number       IS DISTINCT FROM OLD.voucher_number
      OR NEW.payment_account_id   IS DISTINCT FROM OLD.payment_account_id
      OR NEW.total_amount         IS DISTINCT FROM OLD.total_amount
      OR NEW.payment_date         IS DISTINCT FROM OLD.payment_date
      OR NEW.tenant_id            IS DISTINCT FROM OLD.tenant_id
      OR NEW.journal_entry_id     IS DISTINCT FROM OLD.journal_entry_id
    ) THEN
      RAISE EXCEPTION 'Posted payment voucher % is immutable. Reverse and re-issue to make changes.', OLD.voucher_number;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_posted_payment_voucher_edits ON public.payment_vouchers;
CREATE TRIGGER trg_block_posted_payment_voucher_edits
  BEFORE UPDATE OR DELETE ON public.payment_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_payment_voucher_edits();

-- 4. Block line edits on posted vouchers
CREATE OR REPLACE FUNCTION public.block_posted_payment_voucher_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM payment_vouchers
  WHERE id = COALESCE(NEW.voucher_id, OLD.voucher_id);

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted payment voucher.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_posted_payment_voucher_lines ON public.payment_voucher_lines;
CREATE TRIGGER trg_block_posted_payment_voucher_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.payment_voucher_lines
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_payment_voucher_lines();

-- 5. Atomic create_payment_voucher RPC
--    Validates everything server-side and creates voucher + lines + journal in a single transaction.
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
  p_payment_account_id uuid,
  p_payment_method     text,
  p_payment_date       date,
  p_lines              jsonb,                 -- [{account_id, description, amount}]
  p_payee_id           uuid    DEFAULT NULL,
  p_account_number     text    DEFAULT NULL,
  p_cheque_number      text    DEFAULT NULL,
  p_reference_number   text    DEFAULT NULL,
  p_memo               text    DEFAULT NULL,
  p_bills_attached     int     DEFAULT 0,
  p_approved_by        text    DEFAULT NULL,
  p_accountant         text    DEFAULT NULL,
  p_checked_by         text    DEFAULT NULL,
  p_made_by            text    DEFAULT NULL
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
  v_line_count     int := 0;
  v_acc_seen       uuid[] := ARRAY[]::uuid[];
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
    total_amount, status, tenant_id
  ) VALUES (
    v_voucher_number, NULLIF(p_account_number,''), NULLIF(p_cheque_number,''), p_payee_id,
    p_payment_account_id, p_payment_method, NULLIF(p_reference_number,''),
    p_payment_date, NULLIF(p_memo,''), COALESCE(p_bills_attached,0),
    NULLIF(p_approved_by,''), NULLIF(p_accountant,''), NULLIF(p_checked_by,''), NULLIF(p_made_by,''),
    v_total, 'posted', v_tenant_id
  )
  RETURNING id INTO v_voucher_id;

  -- H. Insert lines
  INSERT INTO payment_voucher_lines (voucher_id, account_id, description, amount)
  SELECT
    v_voucher_id,
    (l->>'account_id')::uuid,
    NULLIF(l->>'description',''),
    round((l->>'amount')::numeric, 2)
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
  uuid, text, date, jsonb, uuid, text, text, text, text, int, text, text, text, text
) TO authenticated;
