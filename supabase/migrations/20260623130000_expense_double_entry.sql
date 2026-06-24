-- Double-entry posting for the Expenses module.
--
-- Until now, approving an expense only wrote a single row to the legacy
-- `transactions` table (via sync_expense_to_transactions()). The real general
-- ledger — trial balance, P&L, balance sheet, dashboard expense totals — is
-- built exclusively from posted journal_lines, so approved expenses never
-- reached the financial statements at all.
--
-- This migration brings expenses in line with the QuickBooks "Expense" model
-- and with the existing Payment Voucher / Petty Cash posting pattern: on
-- approval we post a balanced journal entry
--     Dr  <expense category GL account>
--         Cr  <paid-through cash/bank account>
-- The legacy transactions sync is left untouched (dashboard widgets still
-- depend on it; it does not double-count because financials read journal_lines).

-- 1. Columns: where the money was paid from, and the link to the posted JE.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES public.accounts(id);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id);

-- 2. approve_expense(): validate, post the balanced JE, link it, flip status.
--    Mirrors post_pcv() / create_payment_voucher().
CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      uuid := get_user_tenant_id();
  v_user_id        uuid;
  v_expense        expenses%ROWTYPE;
  v_debit_account  uuid;
  v_pay_account    accounts%ROWTYPE;
  v_debit_acct     accounts%ROWTYPE;
  v_amount         numeric(14,2);
  v_je_id          uuid;
  v_period_closed  boolean;
BEGIN
  -- Caller (resolve users.id; never use auth.uid() for created_by)
  SELECT id INTO v_user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

  -- Fetch + tenant-scope the expense
  SELECT * INTO v_expense
  FROM expenses
  WHERE id = p_expense_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND: %', p_expense_id USING ERRCODE = 'P0001';
  END IF;

  IF v_expense.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATE: expense is "%", only pending expenses can be approved', v_expense.status
      USING ERRCODE = 'P0002';
  END IF;

  v_amount := ROUND(v_expense.amount, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: expense amount must be greater than zero' USING ERRCODE = 'P0003';
  END IF;

  -- Paid-through account: required, must be an active cash/bank asset in tenant
  IF v_expense.payment_account_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_REQUIRED: choose the account this expense was paid through'
      USING ERRCODE = 'P0004';
  END IF;

  SELECT * INTO v_pay_account FROM accounts
  WHERE id = v_expense.payment_account_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_INVALID: paid-through account does not exist in this tenant'
      USING ERRCODE = 'P0004';
  END IF;
  IF NOT v_pay_account.is_active THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_INACTIVE: paid-through account "%" is inactive', v_pay_account.account_name
      USING ERRCODE = 'P0004';
  END IF;
  IF NOT public.is_cash_or_bank_account(v_expense.payment_account_id) THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_INVALID: paid-through account must be a Cash or Bank account (Asset). Got "%".',
      v_pay_account.account_name USING ERRCODE = 'P0004';
  END IF;

  -- Category: required, and must map to an active GL account (the debit side)
  IF v_expense.category_id IS NULL THEN
    RAISE EXCEPTION 'CATEGORY_REQUIRED: expense must have a category mapped to a GL account'
      USING ERRCODE = 'P0005';
  END IF;

  SELECT account_id INTO v_debit_account
  FROM expense_categories
  WHERE id = v_expense.category_id AND tenant_id = v_tenant_id;

  IF v_debit_account IS NULL THEN
    RAISE EXCEPTION 'CATEGORY_UNMAPPED: expense category is not linked to a GL account'
      USING ERRCODE = 'P0005';
  END IF;

  SELECT * INTO v_debit_acct FROM accounts
  WHERE id = v_debit_account AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CATEGORY_ACCOUNT_INVALID: category GL account does not exist in this tenant'
      USING ERRCODE = 'P0005';
  END IF;
  IF NOT v_debit_acct.is_active THEN
    RAISE EXCEPTION 'CATEGORY_ACCOUNT_INACTIVE: category GL account "%" is inactive', v_debit_acct.account_name
      USING ERRCODE = 'P0005';
  END IF;

  IF v_debit_account = v_expense.payment_account_id THEN
    RAISE EXCEPTION 'SAME_ACCOUNT: category and paid-through account cannot be the same'
      USING ERRCODE = 'P0006';
  END IF;

  -- Period lock
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND v_expense.expense_date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: expense date % is in a closed period', v_expense.expense_date
      USING ERRCODE = 'P0007';
  END IF;

  -- Balanced journal entry: Dr category GL, Cr paid-through account
  INSERT INTO journal_entries (
    tenant_id, description, entry_date, status, is_system_generated,
    entry_type, reference, cash_flow_category, posted_at, created_by
  )
  VALUES (
    v_tenant_id,
    'Expense ' || COALESCE(v_expense.description, v_debit_acct.account_name),
    v_expense.expense_date, 'posted', true,
    'expense', 'EXP-' || left(v_expense.id::text, 8), 'operating', now(), v_user_id
  )
  RETURNING id INTO v_je_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES
    (v_je_id, v_debit_account, v_amount, 0),
    (v_je_id, v_expense.payment_account_id, 0, v_amount);

  -- Flip the expense to approved (the existing sync trigger keeps `transactions`
  -- in sync for dashboard widgets)
  UPDATE expenses
  SET status = 'approved',
      journal_entry_id = v_je_id
  WHERE id = p_expense_id;

  RETURN v_je_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_expense(uuid) TO authenticated;
