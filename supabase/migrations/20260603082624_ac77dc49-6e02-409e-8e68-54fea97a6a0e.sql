
-- Reclassify variance / applied / returns accounts to proper COGS type with canonical subtypes
UPDATE public.accounts SET account_type = 'Cost of Goods Sold', account_subtype = 'Other COGS'
  WHERE account_code = '5100' AND account_name ILIKE 'Purchase Price Variance';

UPDATE public.accounts SET account_type = 'Cost of Goods Sold', account_subtype = 'Cost of Labour'
  WHERE account_code = '5110' AND account_name ILIKE 'Direct Labor Applied';

UPDATE public.accounts SET account_type = 'Cost of Goods Sold', account_subtype = 'Other COGS'
  WHERE account_code = '5120' AND account_name ILIKE 'Manufacturing Overhead Applied';

UPDATE public.accounts SET account_type = 'Cost of Goods Sold', account_subtype = 'Other COGS'
  WHERE account_code = '5300' AND account_name ILIKE 'Purchase Returns';

-- Inventory write-downs / write-offs stay as Expense, but with canonical subtype
UPDATE public.accounts SET account_subtype = 'Other Expense'
  WHERE account_code IN ('5200','5210') AND account_type = 'Expense';

-- Global remap of any non-canonical subtypes still in the database
UPDATE public.accounts SET account_subtype = 'Other Expense'
  WHERE account_type = 'Expense' AND account_subtype IN ('Operating Expense','Administrative Expense');

UPDATE public.accounts SET account_subtype = 'Other COGS'
  WHERE account_type = 'Cost of Goods Sold' AND account_subtype IN ('Cost of Goods Sold','Operating Expense');

UPDATE public.accounts SET account_subtype = 'Other Current Assets'
  WHERE account_type = 'Asset' AND account_subtype IN ('Current Assets','Other Asset');

UPDATE public.accounts SET account_subtype = 'Other Current Liability'
  WHERE account_type = 'Liability' AND account_subtype = 'Current Liability';
