-- ================================================================
-- Migration: expand account_settings for full GL control account coverage
-- Extends the existing 5-field account_settings table to 14 fields.
-- Both Dr and Cr sides are captured where both are global defaults.
-- All new columns are nullable so existing rows are not broken.
-- ================================================================

ALTER TABLE public.account_settings

  -- ── Receivables / Revenue (invoice posting) ──────────────────────
  -- ar_account_id already exists      → Dr on invoice
  -- sales_account_id already exists   → Cr on invoice
  -- tax_payable_account_id exists      → Cr on invoice (tax portion)
  -- bank_account_id already exists     → Dr on payment received
  --   (Cr on payment received = ar_account_id, already mapped)

  -- ── Payables / Inventory ─────────────────────────────────────────
  -- ap_account_id already exists       → Cr on supplier bill
  --   (Dr on supplier bill = per bill line, not a global default)
  --   (Dr on bill payment = ap_account_id; Cr = bank_account_id — both already mapped)

  ADD COLUMN IF NOT EXISTS inventory_asset_account_id     UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Dr on GRN

  ADD COLUMN IF NOT EXISTS grni_clearing_account_id       UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Cr on GRN (reversed to Cr AP when supplier invoice arrives)

  ADD COLUMN IF NOT EXISTS cogs_account_id                UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Dr on invoice dispatch (fallback when product has no expense_account_id)
  --   (Cr on dispatch = inventory_asset_account_id above)

  -- ── Fixed Assets ─────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS depreciation_expense_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Dr on depreciation run (fallback when asset category has no depreciation expense account)

  ADD COLUMN IF NOT EXISTS accum_depreciation_account_id  UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Cr on depreciation run (fallback when asset category has no accum. depreciation account)

  ADD COLUMN IF NOT EXISTS gain_on_disposal_account_id    UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Cr when disposal proceeds > net book value (Other Income)

  ADD COLUMN IF NOT EXISTS loss_on_disposal_account_id    UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Dr when disposal proceeds < net book value (Other Expense)
  -- NOTE: gain and loss are split into two accounts because they map to
  -- different account types (Other Income vs Other Expense) and IFRS
  -- requires separate disclosure. Do not merge into one field.

  -- ── Petty Cash ───────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS petty_cash_account_id          UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- Cr when PCV is posted (Dr side = expense account per PCV line, not a global default)

  -- ── Equity / Year-end ────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS retained_earnings_account_id   UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
  -- Cr on year-end P&L close (Dr side = all income/expense accounts being zeroed,
  -- determined dynamically from COA — not a configurable default)


-- ── Comments ────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.account_settings.inventory_asset_account_id
  IS 'Asset — Dr on GRN; Cr on invoice dispatch (COGS pair). Fallback when inventory item has no asset_account_id.';

COMMENT ON COLUMN public.account_settings.grni_clearing_account_id
  IS 'Liability — Cr on GRN before supplier invoice arrives; Dr when invoice matches GRN (three-way match).';

COMMENT ON COLUMN public.account_settings.cogs_account_id
  IS 'COGS — Dr on invoice dispatch. Fallback when product has no expense_account_id. Cr pair is inventory_asset_account_id.';

COMMENT ON COLUMN public.account_settings.depreciation_expense_account_id
  IS 'Expense — Dr on depreciation run. Fallback when asset category has no depreciation_expense_account_id.';

COMMENT ON COLUMN public.account_settings.accum_depreciation_account_id
  IS 'Contra-asset — Cr on depreciation run. Fallback when asset category has no accumulated_depreciation_account_id.';

COMMENT ON COLUMN public.account_settings.gain_on_disposal_account_id
  IS 'Other Income — Cr when asset disposal proceeds exceed net book value (IFRS: separate from loss).';

COMMENT ON COLUMN public.account_settings.loss_on_disposal_account_id
  IS 'Other Expense — Dr when asset disposal proceeds are less than net book value (IFRS: separate from gain).';

COMMENT ON COLUMN public.account_settings.petty_cash_account_id
  IS 'Asset — Cr when PCV is posted. Dr side is the expense account on each PCV line.';

COMMENT ON COLUMN public.account_settings.retained_earnings_account_id
  IS 'Equity — Cr target for year-end P&L close journal (IAS 1). Dr side is all revenue/expense accounts dynamically.';
