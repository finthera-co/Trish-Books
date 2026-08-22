-- Reconciliation file: this column was applied directly to the remote database
-- (migration "add_product_sku") without a matching local migration file. Recorded
-- here, idempotently, so local migration history and a fresh db bootstrap match
-- what's already live.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text;
