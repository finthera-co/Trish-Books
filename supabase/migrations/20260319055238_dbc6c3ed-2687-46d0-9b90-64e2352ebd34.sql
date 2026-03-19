
-- Trigger function: sync journal entries to transactions
-- When a journal entry is posted, create transaction rows from its lines
CREATE OR REPLACE FUNCTION public.sync_journal_to_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line RECORD;
BEGIN
  -- Only sync when status becomes 'posted'
  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status != 'posted') THEN
    -- Delete any existing synced transactions for this entry (idempotent)
    DELETE FROM transactions WHERE source_type = 'journal_entry' AND source_id = NEW.id;

    -- Insert a transaction for each journal line
    FOR line IN
      SELECT jl.account_id, jl.debit, jl.credit, a.account_type, a.account_name
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = NEW.id
    LOOP
      -- Determine if this is income or expense based on the line
      IF line.debit > 0 AND line.account_type IN ('Expense', 'Cost of Goods Sold') THEN
        INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
        VALUES (NEW.tenant_id, NEW.entry_date, line.debit, 'expense', line.account_id, line.account_type, NEW.description, 'journal_entry', NEW.id);
      ELSIF line.credit > 0 AND line.account_type = 'Revenue' THEN
        INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
        VALUES (NEW.tenant_id, NEW.entry_date, line.credit, 'income', line.account_id, line.account_type, NEW.description, 'journal_entry', NEW.id);
      END IF;
    END LOOP;
  END IF;

  -- If voided, remove synced transactions
  IF NEW.status = 'voided' AND (TG_OP = 'UPDATE' AND OLD.status != 'voided') THEN
    DELETE FROM transactions WHERE source_type = 'journal_entry' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_journal_to_transactions
AFTER INSERT OR UPDATE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_journal_to_transactions();

-- Trigger function: sync expenses to transactions
CREATE OR REPLACE FUNCTION public.sync_expense_to_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status != 'approved') THEN
    DELETE FROM transactions WHERE source_type = 'expense' AND source_id = NEW.id;

    INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
    VALUES (
      NEW.tenant_id,
      NEW.expense_date,
      NEW.amount,
      'expense',
      NEW.category_id,
      COALESCE((SELECT name FROM expense_categories WHERE id = NEW.category_id), 'Uncategorized'),
      NEW.description,
      'expense',
      NEW.id
    );
  END IF;

  -- If rejected or reverted, remove
  IF NEW.status IN ('rejected', 'pending') AND TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    DELETE FROM transactions WHERE source_type = 'expense' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_expense_to_transactions
AFTER INSERT OR UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.sync_expense_to_transactions();

-- Trigger function: sync invoices (payments received = income)
CREATE OR REPLACE FUNCTION public.sync_invoice_payment_to_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_invoice_number text;
BEGIN
  SELECT tenant_id, invoice_number INTO v_tenant_id, v_invoice_number
  FROM invoices WHERE id = NEW.invoice_id;

  INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
  VALUES (
    v_tenant_id,
    NEW.payment_date::date,
    NEW.amount,
    'income',
    NULL,
    'Invoice Payment',
    'Payment for invoice ' || v_invoice_number,
    'invoice_payment',
    NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_invoice_payment_to_transactions
AFTER INSERT ON public.payments_received
FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_payment_to_transactions();

-- Trigger function: sync payment vouchers to transactions
CREATE OR REPLACE FUNCTION public.sync_payment_voucher_to_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status != 'approved') THEN
    DELETE FROM transactions WHERE source_type = 'payment_voucher' AND source_id = NEW.id;

    INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
    VALUES (
      NEW.tenant_id,
      NEW.payment_date,
      NEW.total_amount,
      'expense',
      NEW.payment_account_id,
      'Payment Voucher',
      COALESCE(NEW.memo, 'Payment voucher ' || NEW.voucher_number),
      'payment_voucher',
      NEW.id
    );
  END IF;

  IF NEW.status IN ('draft', 'rejected') AND TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    DELETE FROM transactions WHERE source_type = 'payment_voucher' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_payment_voucher_to_transactions
AFTER INSERT OR UPDATE ON public.payment_vouchers
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_voucher_to_transactions();

-- Trigger function: sync petty cash vouchers to transactions
CREATE OR REPLACE FUNCTION public.sync_petty_cash_to_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status != 'approved') THEN
    DELETE FROM transactions WHERE source_type = 'petty_cash' AND source_id = NEW.id;

    INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
    VALUES (
      NEW.tenant_id,
      NEW.voucher_date,
      NEW.total_amount,
      'expense',
      NEW.petty_cash_account_id,
      'Petty Cash',
      COALESCE(NEW.description, 'Petty cash voucher ' || NEW.voucher_number),
      'petty_cash',
      NEW.id
    );
  END IF;

  IF NEW.status IN ('draft', 'pending', 'reversed') AND TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    DELETE FROM transactions WHERE source_type = 'petty_cash' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_petty_cash_to_transactions
AFTER INSERT OR UPDATE ON public.petty_cash_vouchers
FOR EACH ROW EXECUTE FUNCTION public.sync_petty_cash_to_transactions();
