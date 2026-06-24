-- Fix: approving an expense raised
--   insert or update on table "transactions" violates foreign key constraint
--   "transactions_account_id_fkey"
--
-- Root cause: sync_expense_to_transactions() inserted NEW.category_id into
-- transactions.account_id. category_id references expense_categories(id), but
-- transactions.account_id has an FK to accounts(id), so any categorized expense
-- failed the FK check on approval.
--
-- Correct value is the GL account linked to the expense category
-- (expense_categories.account_id), or NULL when the expense is uncategorized or
-- the category has no linked account — both of which are FK-safe.

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
      (SELECT account_id FROM expense_categories WHERE id = NEW.category_id),
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
