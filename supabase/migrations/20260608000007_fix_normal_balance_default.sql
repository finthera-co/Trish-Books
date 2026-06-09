-- The validate_account_normal_balance trigger (migration 20260417...) auto-sets
-- normal_balance to the correct value when it receives NULL or ''. However the
-- column DEFAULT was 'debit', so inserts that omit normal_balance had the default
-- applied by Postgres BEFORE the trigger ran, causing the trigger to see 'debit'
-- for Liability/Equity/Income accounts and raise an exception instead of
-- auto-correcting. Changing the default to '' lets the trigger do its job.
ALTER TABLE public.accounts ALTER COLUMN normal_balance SET DEFAULT '';
