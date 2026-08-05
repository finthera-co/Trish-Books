-- ─────────────────────────────────────────────────────────────────────────────
-- Per-line discount percentage on invoices and quotes/estimates
--
-- `discount_amount` stays the single source of truth for every downstream
-- consumer (post-invoice tax recompute, PDFs, reports) — nothing that reads it
-- changes. `discount_percent` is the *entry* form: the UI computes
--     discount_amount = round(quantity * unit_price * discount_percent / 100, 2)
-- and stores both, so the document can print "10%" next to the money figure and
-- an edited draft rehydrates with the percentage the user actually typed.
-- A flat-amount discount simply leaves discount_percent at 0.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_discount_percent_range'
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_discount_percent_range
      CHECK (discount_percent >= 0 AND discount_percent <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_discount_percent_range'
  ) THEN
    ALTER TABLE public.quote_items
      ADD CONSTRAINT quote_items_discount_percent_range
      CHECK (discount_percent >= 0 AND discount_percent <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.invoice_items.discount_percent IS
  'Line discount as a percentage of quantity * unit_price. 0 = none or a flat-amount discount. discount_amount remains authoritative for all calculations.';
COMMENT ON COLUMN public.quote_items.discount_percent IS
  'Line discount as a percentage of quantity * unit_price. 0 = none or a flat-amount discount. discount_amount remains authoritative for all calculations.';
