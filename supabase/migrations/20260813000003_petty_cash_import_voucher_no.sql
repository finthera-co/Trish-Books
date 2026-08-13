-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — the sheet's second column is a VOUCHER number
--
-- The staging column was named raw_cheque_no on the assumption that the column
-- identified a cheque. It does not: it carries the number of the paper petty
-- cash voucher the row belongs to. That distinction matters, because the
-- grouping key for building vouchers is (date, voucher no, name) — grouping by
-- a voucher number reconstructs exactly the paper voucher that was written,
-- which is the whole point of the grouping.
--
-- Safe to rename rather than add-and-deprecate: the column was introduced one
-- migration ago, nothing reads it yet, and no batch has ever been staged.
-- Guarded so it is idempotent and so a database built from scratch — where
-- 20260813000000 has not yet been amended — still lands in the same shape.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'petty_cash_import_lines'
      AND column_name = 'raw_cheque_no'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'petty_cash_import_lines'
      AND column_name = 'raw_voucher_no'
  ) THEN
    ALTER TABLE public.petty_cash_import_lines
      RENAME COLUMN raw_cheque_no TO raw_voucher_no;
  END IF;
END $$;

COMMENT ON COLUMN public.petty_cash_import_lines.raw_voucher_no IS
  'Verbatim voucher number from the source sheet. Part of the (date, voucher no, name) grouping key that rebuilds one petty cash voucher per paper voucher. Carried onto the journal entry as its reference.';
