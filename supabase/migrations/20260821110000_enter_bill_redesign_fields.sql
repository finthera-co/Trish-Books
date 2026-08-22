-- ============================================================================
-- ENTER BILL REDESIGN — new fields
--
-- Matching a QuickBooks-style Bill entry screen: a permit/reference number on
-- the bill header, a free-text SKU per line (no product catalog behind it —
-- inventory/items was removed from this app, so this is a manual label like
-- vendor_ref, not a lookup), and vendor bank/remittance details for a
-- "Bill Pay info" card. Bank field names match the convention already used
-- on company_profiles/employees (bank_name/bank_branch/bank_account_name/
-- bank_account_no), not a US-ABA routing_number — this app is SL-oriented.
-- ============================================================================

ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS permit_no text;

ALTER TABLE public.supplier_bill_lines
  ADD COLUMN IF NOT EXISTS sku text;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_account_no text;
