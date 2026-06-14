-- Allow assets to exist without a category. Accounts are then supplied
-- directly and snapshotted onto the asset row.
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS disposal_gain_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposal_loss_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fixed_assets.disposal_gain_account_id IS
  'Snapshot for categoryless assets; falls back to category/global at disposal when null.';
COMMENT ON COLUMN public.fixed_assets.disposal_loss_account_id IS
  'Snapshot for categoryless assets; falls back to category/global at disposal when null.';
