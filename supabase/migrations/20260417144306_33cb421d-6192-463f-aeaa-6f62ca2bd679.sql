-- 1. Add is_contra column
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_contra boolean NOT NULL DEFAULT false;

-- 2. Fix existing Accumulated Depreciation accounts (contra asset, credit normal balance)
UPDATE public.accounts
SET is_contra = true,
    normal_balance = 'credit'
WHERE account_name ILIKE '%accumulated depreciation%'
   OR account_subtype ILIKE '%accumulated depreciation%';

-- 3. Normalize normal_balance for all other accounts to match accounting rules
UPDATE public.accounts
SET normal_balance = 'debit'
WHERE is_contra = false
  AND account_type IN ('Asset', 'Expense', 'Cost of Goods Sold', 'Other Expense')
  AND normal_balance <> 'debit';

UPDATE public.accounts
SET normal_balance = 'credit'
WHERE is_contra = false
  AND account_type IN ('Liability', 'Equity', 'Income', 'Other Income')
  AND normal_balance <> 'credit';

-- 4. Validation trigger to enforce contra/normal balance rules
CREATE OR REPLACE FUNCTION public.validate_account_normal_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_debit_types text[] := ARRAY['Asset','Expense','Cost of Goods Sold','Other Expense'];
  v_credit_types text[] := ARRAY['Liability','Equity','Income','Other Income'];
  v_expected text;
BEGIN
  -- Determine expected normal balance
  IF NEW.account_type = ANY(v_debit_types) THEN
    v_expected := CASE WHEN NEW.is_contra THEN 'credit' ELSE 'debit' END;
  ELSIF NEW.account_type = ANY(v_credit_types) THEN
    v_expected := CASE WHEN NEW.is_contra THEN 'debit' ELSE 'credit' END;
  ELSE
    RAISE EXCEPTION 'Invalid account_type: %', NEW.account_type;
  END IF;

  IF NEW.normal_balance IS NULL OR NEW.normal_balance = '' THEN
    NEW.normal_balance := v_expected;
  ELSIF lower(NEW.normal_balance) <> v_expected THEN
    RAISE EXCEPTION 'Invalid normal_balance "%" for account_type "%" (is_contra=%). Expected "%".',
      NEW.normal_balance, NEW.account_type, NEW.is_contra, v_expected;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_account_normal_balance ON public.accounts;
CREATE TRIGGER trg_validate_account_normal_balance
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.validate_account_normal_balance();