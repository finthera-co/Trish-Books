-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: pad the sequence in already-issued invoice numbers
--
-- 20260822000000_pad_invoice_serial_seq.sql fixed generation going forward
-- (…_SHOP_00001 instead of …_SHOP_1), but invoices raised before that migration
-- still carry the unpadded text. Rewrite those in place so every gazette-format
-- number, old or new, reads the same way. Only the trailing sequence digits
-- change; the (tenant_id, branch, yy, mmm, seq) identity is untouched, so no
-- new collisions are possible — each seq was already unique within its bucket.
--
-- trg_block_posted_invoice_edits deliberately makes invoice_number immutable
-- once an invoice is posted (an audit control against renumbering issued
-- invoices), so this only repads DRAFT invoices. Posted invoices keep their
-- original unpadded numbers — that lock is intentional and stays in force.
-- ─────────────────────────────────────────────────────────────────────────────

WITH parsed AS (
  SELECT id,
         (regexp_match(invoice_number, '^([0-9]{2}[A-Z]{3}_.+_)([0-9]+)$'))[1] AS prefix,
         (regexp_match(invoice_number, '^([0-9]{2}[A-Z]{3}_.+_)([0-9]+)$'))[2] AS seq_text
    FROM public.invoices
   WHERE invoice_number ~ '^[0-9]{2}[A-Z]{3}_.+_[0-9]+$'
     AND status = 'draft'
)
UPDATE public.invoices i
   SET invoice_number = p.prefix || lpad(p.seq_text, 5, '0'),
       updated_at = now()
  FROM parsed p
 WHERE i.id = p.id
   AND length(p.seq_text) < 5;

-- Register rows for numbers still 'reserved' or 'skipped' (never issued) can
-- move freely; 'issued' rows mirror a posted invoice and are left untouched
-- for the same reason.
WITH parsed AS (
  SELECT id,
         (regexp_match(serial, '^([0-9]{2}[A-Z]{3}_.+_)([0-9]+)$'))[1] AS prefix,
         (regexp_match(serial, '^([0-9]{2}[A-Z]{3}_.+_)([0-9]+)$'))[2] AS seq_text
    FROM public.invoice_serial_register
   WHERE serial ~ '^[0-9]{2}[A-Z]{3}_.+_[0-9]+$'
     AND status IN ('reserved', 'skipped')
)
UPDATE public.invoice_serial_register r
   SET serial = p.prefix || lpad(p.seq_text, 5, '0'),
       updated_at = now()
  FROM parsed p
 WHERE r.id = p.id
   AND length(p.seq_text) < 5;
