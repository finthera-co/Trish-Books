-- Large accounts (bank-import categorization buckets can hold 15k+ lines) recompute
-- the whole account's running-balance window on every export chunk. Under the
-- authenticated role's default 8s statement_timeout, later chunks (large OFFSET)
-- were getting killed with 57014, breaking CSV/Excel export for big accounts.
-- Scoped to this function only, not the role, so other slow queries still
-- surface quickly.
ALTER FUNCTION public.account_ledger_page(uuid, date, date, text, text, text, text, text, int, int)
  SET statement_timeout = '25s';
