-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant's default branch / entity code (the QQQQ segment)
--
-- Every invoice serial is YYMMM_QQQQ_XXXXX, and QQQQ differs per business — one
-- runs everything from MAIN, another codes each outlet BR01/BR02. Until now the
-- code had to be re-typed on every invoice and fell back to the hard-coded
-- 'MAIN', so a business whose real code was BR03 silently issued MAIN serials.
--
-- Stored on company_profiles beside the other invoice defaults (terms, footer,
-- bank details) rather than on tenants: it is a document-presentation default,
-- and that is where the invoice settings form already reads and writes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS default_branch_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_default_branch_code_len'
  ) THEN
    ALTER TABLE public.company_profiles
      ADD CONSTRAINT company_profiles_default_branch_code_len
      -- next_invoice_serial() rejects anything outside 1-15 characters, and a
      -- serial may not contain whitespace.
      CHECK (
        default_branch_code IS NULL
        OR (length(btrim(default_branch_code)) BETWEEN 1 AND 15
            AND btrim(default_branch_code) !~ '\s')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.company_profiles.default_branch_code IS
  'Default QQQQ segment for invoice serials, pre-filled on new invoices and in the number register. NULL = fall back to MAIN.';
