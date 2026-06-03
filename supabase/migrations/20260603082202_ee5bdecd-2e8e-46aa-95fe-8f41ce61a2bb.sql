
-- Normalize non-canonical account_type (Income is credit-normal, flip balance too)
UPDATE public.accounts SET account_type = 'Income', normal_balance = 'credit' WHERE account_type = 'Revenue';

-- Reclassify 5010 to COGS (still debit-normal, no balance change needed)
UPDATE public.accounts SET account_type = 'Cost of Goods Sold' WHERE account_code = '5010' AND account_type = 'Expense';

-- Map non-canonical subtypes to canonical ones
UPDATE public.accounts SET account_subtype = 'Other Current Liability'
  WHERE account_subtype IN ('Accrued Liability', 'Current Liabilities', 'Accrued Liabilities');

-- Assets
UPDATE public.accounts SET account_subtype = 'Cash on Hand' WHERE account_code IN ('1010','1030') AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Bank' WHERE account_code = '1020' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Accounts Receivable' WHERE account_code = '1100' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Inventory' WHERE account_code = '1200' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Prepaid Expenses' WHERE account_code = '1300' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other Current Assets' WHERE account_code = '1400' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Fixed Assets' WHERE account_code = '1500' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Buildings' WHERE account_code = '1510' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Furniture & Equipment' WHERE account_code IN ('1520','1530','1550') AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Vehicles' WHERE account_code = '1540' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Intangible Assets' WHERE account_code = '1560' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Accumulated Depreciation', is_contra = true, normal_balance = 'credit'
  WHERE account_code = '1600' AND (account_subtype IS NULL OR account_subtype = '');

-- Liabilities
UPDATE public.accounts SET account_subtype = 'Accounts Payable' WHERE account_code = '2010' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Payroll Liability' WHERE account_code = '2020' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Sales Tax Payable' WHERE account_code IN ('2030','2040') AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other Current Liability' WHERE account_code IN ('2050','2060') AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Long-Term Loan' WHERE account_code = '2500' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Long-term Liability' WHERE account_code IN ('2510','2520') AND (account_subtype IS NULL OR account_subtype = '');

-- Equity
UPDATE public.accounts SET account_subtype = 'Owner''s Equity' WHERE account_code = '3010' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Retained Earnings' WHERE account_code = '3020' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Dividends' WHERE account_code = '3030' AND (account_subtype IS NULL OR account_subtype = '');

-- Income
UPDATE public.accounts SET account_subtype = 'Sales Revenue' WHERE account_code = '4010' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Service Revenue' WHERE account_code = '4020' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other Revenue' WHERE account_code = '4510' AND (account_subtype IS NULL OR account_subtype = '');

-- COGS
UPDATE public.accounts SET account_subtype = 'Other COGS' WHERE account_code = '5010' AND (account_subtype IS NULL OR account_subtype = '');

-- Expenses
UPDATE public.accounts SET account_subtype = 'Payroll Expenses' WHERE account_code = '5100' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Rent' WHERE account_code = '5110' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Utilities' WHERE account_code = '5120' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Advertising' WHERE account_code = '5130' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Depreciation' WHERE account_code = '5140' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Bank Charges' WHERE account_code = '5500' AND (account_subtype IS NULL OR account_subtype = '');

-- Safety net: any remaining uncategorized account gets a sensible default for its type
UPDATE public.accounts SET account_subtype = 'Other Current Assets'
  WHERE account_type = 'Asset' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other Current Liability'
  WHERE account_type = 'Liability' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Owner''s Equity'
  WHERE account_type = 'Equity' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other Revenue'
  WHERE account_type = 'Income' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other Expense'
  WHERE account_type = 'Expense' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Other COGS'
  WHERE account_type = 'Cost of Goods Sold' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Miscellaneous Income'
  WHERE account_type = 'Other Income' AND (account_subtype IS NULL OR account_subtype = '');
UPDATE public.accounts SET account_subtype = 'Miscellaneous Expense'
  WHERE account_type = 'Other Expense' AND (account_subtype IS NULL OR account_subtype = '');

-- Also align the seed Edge Function output going forward — update the COA seeder defaults
-- so newly provisioned tenants don't reintroduce uncategorized accounts.
-- (Handled in code: supabase/functions/seed-chart-of-accounts/index.ts will be updated next.)
