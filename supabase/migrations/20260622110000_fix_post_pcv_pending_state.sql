-- Fix: "This document has already been posted or is not in a draft state."
-- (INVALID_STATE) when approving & posting a petty cash voucher.
--
-- Root cause: the UI workflow is draft -> (Submit for Approval) -> pending ->
-- (Approve & Post) -> approved. The "Approve & Post" action calls post_pcv(),
-- but post_pcv() only accepted vouchers in 'draft' state. By the time the user
-- posts, the voucher is 'pending', so the guard raised INVALID_STATE and posting
-- was impossible through the normal workflow.
--
-- Fix: accept both 'draft' and 'pending' as postable states. Everything else in
-- the function is unchanged.

CREATE OR REPLACE FUNCTION public.post_pcv(p_voucher_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_user_id        UUID;
  v_voucher        petty_cash_vouchers%ROWTYPE;
  v_coa_account_id UUID;
  v_balance        NUMERIC(14,2);
  v_je_id          UUID;
  v_line_total     NUMERIC(14,2);
  v_period_closed  BOOLEAN;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

  -- Fetch + tenant-scope the voucher
  SELECT * INTO v_voucher
  FROM petty_cash_vouchers
  WHERE id = p_voucher_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: %', p_voucher_id USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'INVALID_STATE: voucher is "%", only draft or pending vouchers can be posted', v_voucher.status
      USING ERRCODE = 'P0002';
  END IF;

  -- Period lock
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND v_voucher.date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: voucher date % is in a closed period', v_voucher.date
      USING ERRCODE = 'P0003';
  END IF;

  -- Resolve COA account behind the fund and LOCK the fund (serialises postings)
  v_balance := pc_locked_ledger_balance(v_voucher.petty_cash_account_id, v_tenant_id);

  SELECT account_id INTO v_coa_account_id
  FROM petty_cash_accounts
  WHERE id = v_voucher.petty_cash_account_id;

  -- Sum the lines and validate the header total matches
  SELECT COALESCE(SUM(amount), 0) INTO v_line_total
  FROM petty_cash_voucher_lines
  WHERE voucher_id = p_voucher_id;

  IF v_line_total <= 0 THEN
    RAISE EXCEPTION 'EMPTY_VOUCHER: voucher has no positive line amounts' USING ERRCODE = 'P0004';
  END IF;

  IF ROUND(v_line_total, 2) <> ROUND(v_voucher.total_amount, 2) THEN
    RAISE EXCEPTION 'TOTAL_MISMATCH: line sum % <> header total %', v_line_total, v_voucher.total_amount
      USING ERRCODE = 'P0005';
  END IF;

  -- Insufficient-funds guard (now race-safe due to the row lock above)
  IF v_balance < v_line_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS: available %, required %', v_balance, v_line_total
      USING ERRCODE = 'P0006';
  END IF;

  -- Create the posted journal entry
  INSERT INTO journal_entries (
    tenant_id, description, entry_date, status, is_system_generated,
    entry_type, reference, cash_flow_category, posted_at, created_by
  )
  VALUES (
    v_tenant_id,
    'Petty Cash Voucher ' || v_voucher.voucher_number,
    v_voucher.date, 'posted', true,
    'petty_cash', v_voucher.voucher_number, 'operating', now(), v_user_id
  )
  RETURNING id INTO v_je_id;

  -- Debit each expense line
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT v_je_id, account_id, amount, 0
  FROM petty_cash_voucher_lines
  WHERE voucher_id = p_voucher_id;

  -- Credit the petty cash fund for the total
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_coa_account_id, 0, v_line_total);

  -- Flip the voucher to approved
  UPDATE petty_cash_vouchers
  SET status = 'approved',
      approved_at = now(),
      journal_entry_id = v_je_id
  WHERE id = p_voucher_id;

  RETURN v_je_id;
END;
$$;
