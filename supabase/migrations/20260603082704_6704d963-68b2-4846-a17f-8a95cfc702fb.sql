
UPDATE public.accounts SET account_subtype = 'Other Current Assets'
  WHERE account_type = 'Asset' AND account_subtype = 'Current Asset';

UPDATE public.accounts SET account_subtype = 'Other COGS'
  WHERE account_type = 'Cost of Goods Sold' AND account_subtype = 'COGS';

UPDATE public.accounts SET account_subtype = 'Sales Revenue'
  WHERE account_type = 'Income' AND account_subtype = 'Sales';
