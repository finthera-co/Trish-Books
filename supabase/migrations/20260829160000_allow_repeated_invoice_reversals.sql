-- Allow an invoice to be reversed more than once.
--
-- Editing a posted invoice reopens it: the live journal is voided and a
-- mirrored reversal is written, then the invoice is re-posted from the new
-- figures. idx_je_unique_source made that work exactly once — it is unique on
-- (source_type, source_id) across every non-voided entry, so a SECOND edit of
-- the same invoice collided with the reversal left behind by the first.
--
-- The guarantee that index exists for is "one live journal per source
-- DOCUMENT" (never post the same invoice, bill or voucher twice). A reversal
-- is an event against a document, not a document, so 'invoice_reversal' has no
-- business being in that index. Posting itself (source_type = 'invoice') stays
-- covered exactly as before, and so does every other source type.
DROP INDEX IF EXISTS public.idx_je_unique_source;

CREATE UNIQUE INDEX idx_je_unique_source
  ON public.journal_entries (source_type, source_id)
  WHERE source_type IS NOT NULL
    AND source_id IS NOT NULL
    AND status <> 'voided'
    AND source_type <> 'invoice_reversal';
