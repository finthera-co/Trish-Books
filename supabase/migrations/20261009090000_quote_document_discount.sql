-- ─────────────────────────────────────────────────────────────────────────────
-- Quote-level ("total") discount — same model as the invoice one
-- (20260808000003_invoice_document_discount.sql).
--
-- The discount on the whole estimate is APPORTIONED across the lines pro-rata
-- and folded into each line's discount_amount, so tax per code is charged on
-- the discounted value and a converted invoice carries the right figures.
--
--   quotes.document_discount(_percent) — what the user actually entered
--   quote_items.line_discount_amount   — the line's OWN discount, before the
--                                        apportioned share was added in
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS document_discount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_percent NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS line_discount_amount NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_document_discount_percent_range'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_document_discount_percent_range
      CHECK (document_discount_percent >= 0 AND document_discount_percent <= 100);
  END IF;
END $$;

-- Existing quotes carry no quote-level discount, so every line's discount is
-- entirely its own.
UPDATE public.quote_items
   SET line_discount_amount = discount_amount
 WHERE line_discount_amount = 0
   AND discount_amount <> 0;

COMMENT ON COLUMN public.quotes.document_discount IS
  'Quote-level discount as entered by the user. Already apportioned into quote_items.discount_amount — do NOT subtract it again from the total.';
COMMENT ON COLUMN public.quotes.document_discount_percent IS
  'Quote-level discount as a percentage of the net line total. 0 = none, or a flat-amount discount.';
COMMENT ON COLUMN public.quote_items.line_discount_amount IS
  'The line''s own discount, excluding any apportioned share of the quote-level discount. discount_amount = this + that share.';
