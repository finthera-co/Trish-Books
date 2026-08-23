-- ============================================================================
-- WRITE CHECKS — pixel-accurate QBO rebuild: new header/line fields
--
-- mailing_address / permit_number are intentionally separate from the
-- existing address_block / permit_no columns (added in
-- 20260821010000_write_checks_upgrade.sql / 20260821120000_...vendor_payee.sql)
-- rather than reusing them — the new full-page WriteCheck UI writes to these,
-- the old columns are left in place unused. is_taxable is a plain checkbox
-- column (no tax_codes table exists yet to back a real tax code); sort_order
-- supports future drag-reorder of category lines (not built this round).
-- ============================================================================

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS mailing_address TEXT,
  ADD COLUMN IF NOT EXISTS permit_number TEXT,
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_template_id UUID;

ALTER TABLE public.payment_voucher_lines
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT false;
