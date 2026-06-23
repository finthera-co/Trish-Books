-- ============================================================
-- VAT Tax Invoice (IRD Gazette 2481/22) — statutory fields
-- Mandatory for VAT-registered persons from 2026-07-01.
-- Additive + idempotent: safe to re-run.
-- ============================================================

-- 2.1 Supplier particulars live on the tenant (company).
--     registration_number (BR No.) already exists; add TIN/address/phone.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tax_id text,          -- Supplier TIN (9 digits)
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text;

-- 2.2 Purchaser TIN already exists on customers as `tin` — reused as-is
--     (no duplicate column added).

-- 2.3 Statutory invoice fields
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS date_of_supply date,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS mode_of_payment text,
  ADD COLUMN IF NOT EXISTS branch_code text;       -- QQQQ segment of the serial

-- 2.4 Per-tenant, per-branch, per-month serial counter for YYMMM_QQQQ_XXXXX
CREATE TABLE IF NOT EXISTS public.invoice_serial_sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_code text NOT NULL,
  yy          int  NOT NULL,      -- last two digits of year
  mmm         text NOT NULL,      -- 3-char uppercase month, e.g. JUL
  last_seq    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_code, yy, mmm)
);

ALTER TABLE public.invoice_serial_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant invoice serial sequences" ON public.invoice_serial_sequences;
CREATE POLICY "Users can view own tenant invoice serial sequences"
  ON public.invoice_serial_sequences FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Authorized users can manage invoice serial sequences" ON public.invoice_serial_sequences;
CREATE POLICY "Authorized users can manage invoice serial sequences"
  ON public.invoice_serial_sequences FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- 2.5 Atomic serial generator: returns the next compliant serial string.
--     Increments under row lock (ON CONFLICT ... DO UPDATE ... RETURNING) so
--     there are no gaps/collisions per (tenant, branch, year, month).
CREATE OR REPLACE FUNCTION public.next_invoice_serial(
  p_branch_code text,
  p_issue_date  date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_yy     int  := (EXTRACT(YEAR FROM p_issue_date)::int) % 100;
  v_mmm    text;
  v_branch text := NULLIF(btrim(p_branch_code), '');
  v_seq    int;
  v_serial text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context for serial generation';
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch/QQQQ code is required for the invoice serial';
  END IF;
  -- QQQQ: at least 1, at most 15 characters per gazette
  IF length(v_branch) < 1 OR length(v_branch) > 15 THEN
    RAISE EXCEPTION 'Branch/QQQQ code must be 1-15 characters (got %)', length(v_branch);
  END IF;

  -- Locale-independent 3-char uppercase month (avoids TO_CHAR lc_time risk).
  v_mmm := CASE EXTRACT(MONTH FROM p_issue_date)::int
             WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
             WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
             WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
             WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
           END;

  INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
  VALUES (v_tenant, v_branch, v_yy, v_mmm, 1)
  ON CONFLICT (tenant_id, branch_code, yy, mmm)
  DO UPDATE SET last_seq = public.invoice_serial_sequences.last_seq + 1,
                updated_at = now()
  RETURNING last_seq INTO v_seq;

  -- YYMMM_QQQQ_XXXXX  (XXXXX is numeric only; contiguous, not zero-padded by spec)
  v_serial := lpad(v_yy::text, 2, '0') || v_mmm || '_' || v_branch || '_' || v_seq::text;

  -- Hard guards: total length <= 40, no whitespace.
  IF length(v_serial) > 40 THEN
    RAISE EXCEPTION 'Generated serial exceeds 40 characters: %', v_serial;
  END IF;
  IF v_serial ~ '\s' THEN
    RAISE EXCEPTION 'Generated serial contains whitespace: %', v_serial;
  END IF;

  RETURN v_serial;
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_serial(text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.next_invoice_serial(text, date) TO authenticated;
