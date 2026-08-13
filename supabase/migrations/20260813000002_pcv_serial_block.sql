-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH — concurrency-safe voucher serial allocation (import path only)
--
-- generate_pcv_number() is COUNT(*)+1. That is fine for creating one voucher
-- interactively, but an import creates a whole block at once: every row in the
-- batch would compute the same number and collide on the
-- UNIQUE(tenant_id, voucher_number) constraint.
--
-- This adds a row-locked sequence table that can reserve N consecutive serials
-- in one call, mirroring the next_invoice_serial pattern. generate_pcv_number
-- is left completely alone — manual voucher creation keeps using it, and the
-- allocator seeds itself from existing PCV-YYYY-NNNN numbers so the two can
-- never hand out the same number.
--
-- Serials consumed by a batch that is later reverted are NOT reclaimed. The
-- vouchers still exist in a 'reversed' state and their numbers must stay
-- stable, so a gap in the sequence after a reversal is correct behaviour.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pcv_serial_sequences (
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  last_serial INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE public.pcv_serial_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_view_pcv_serials" ON public.pcv_serial_sequences;
CREATE POLICY "tenant_view_pcv_serials" ON public.pcv_serial_sequences
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
-- Deliberately no write policy: only the SECURITY DEFINER allocator writes
-- here, so a client cannot rewind or skip the sequence.

COMMENT ON TABLE public.pcv_serial_sequences IS
  'Per-tenant, per-year petty cash voucher serial counter. Written only by next_pcv_serial_block().';

CREATE OR REPLACE FUNCTION public.next_pcv_serial_block(
  p_tenant_id UUID,
  p_year      INTEGER,
  p_count     INTEGER
)
RETURNS INTEGER            -- first serial of the reserved block
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last INTEGER;
  v_seed INTEGER;
BEGIN
  IF p_count < 1 THEN
    RAISE EXCEPTION 'p_count must be >= 1';
  END IF;

  -- Seed from any pre-existing PCV-YYYY-NNNN numbers so the new sequence can
  -- never collide with vouchers created by generate_pcv_number.
  SELECT COALESCE(MAX((regexp_replace(voucher_number, '^PCV-\d{4}-', ''))::INTEGER), 0)
    INTO v_seed
  FROM petty_cash_vouchers
  WHERE tenant_id = p_tenant_id
    AND voucher_number ~ ('^PCV-' || p_year::TEXT || '-\d+$');

  INSERT INTO pcv_serial_sequences (tenant_id, year, last_serial)
  VALUES (p_tenant_id, p_year, v_seed)
  ON CONFLICT (tenant_id, year) DO NOTHING;

  SELECT last_serial INTO v_last
  FROM pcv_serial_sequences
  WHERE tenant_id = p_tenant_id AND year = p_year
  FOR UPDATE;                                   -- row lock held to end of txn

  IF v_last < v_seed THEN
    v_last := v_seed;                           -- catch up to legacy numbering
  END IF;

  UPDATE pcv_serial_sequences
  SET last_serial = v_last + p_count, updated_at = now()
  WHERE tenant_id = p_tenant_id AND year = p_year;

  RETURN v_last + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.next_pcv_serial_block(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_pcv_serial_block(UUID, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.next_pcv_serial_block(UUID, INTEGER, INTEGER) IS
  'Reserves p_count consecutive PCV serials and returns the first. The row lock is held to end of transaction, so concurrent callers get non-overlapping blocks. Import path only — manual vouchers keep using generate_pcv_number.';
