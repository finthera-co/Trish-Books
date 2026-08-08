-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice-level ("total") discount
--
-- A discount given on the whole invoice rather than on one line. Under SL VAT a
-- discount granted at the time of supply reduces the value of the supply, so it
-- has to come off the taxable base — it cannot simply be subtracted from the
-- gross total after tax.
--
-- post-invoice recomputes tax and the GL split from
--     quantity * unit_price - invoice_items.discount_amount
-- so the invoice-level discount is APPORTIONED across the lines pro-rata and
-- folded into each line's discount_amount. Tax per code, revenue per account and
-- the server-side recompute then all stay correct with no change to the engine.
--
-- Two things are recorded so the draft can be reopened and edited:
--   invoices.document_discount(_percent) — what the user actually entered
--   invoice_items.line_discount_amount   — the line's OWN discount, before the
--                                          apportioned share was added in
-- Without the second column the two discounts could not be told apart on reload
-- and the invoice-level one would compound every time a draft was re-saved.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS document_discount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_percent NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS line_discount_amount NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_document_discount_percent_range'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_document_discount_percent_range
      CHECK (document_discount_percent >= 0 AND document_discount_percent <= 100);
  END IF;
END $$;

-- Existing rows carry no invoice-level discount, so every line's discount is
-- entirely its own. Seed the new column from the current values rather than
-- leaving old drafts looking like they had their line discounts wiped.
UPDATE public.invoice_items
   SET line_discount_amount = discount_amount
 WHERE line_discount_amount = 0
   AND discount_amount <> 0;

COMMENT ON COLUMN public.invoices.document_discount IS
  'Invoice-level discount as entered by the user. Already apportioned into invoice_items.discount_amount — do NOT subtract it again from the total.';
COMMENT ON COLUMN public.invoices.document_discount_percent IS
  'Invoice-level discount as a percentage of the net line total. 0 = none, or a flat-amount discount.';
COMMENT ON COLUMN public.invoice_items.line_discount_amount IS
  'The line''s own discount, excluding any apportioned share of the invoice-level discount. discount_amount = this + that share.';
