-- ─────────────────────────────────────────────────────────────────────────────
-- Industrial-grade credit-note numbering
--
-- Until now AR credit-note numbers were typed by hand (e.g. "CN-001"), which is
-- duplicate-prone and not auditable. This adds an atomic per-tenant/year counter
-- and a SECURITY DEFINER RPC that mirrors next_invoice_serial / pc_next_document_number:
-- a single locked UPDATE eliminates the COUNT(*)+1 race under concurrent issuance.
--
-- Format: CN-YYYY-NNNN  (e.g. CN-2026-0001)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_note_counters (
  tenant_id   UUID    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE public.credit_note_counters ENABLE ROW LEVEL SECURITY;

-- The counter is only ever read/written through the SECURITY DEFINER RPC below,
-- so no direct client policies are granted (RLS denies all by default).

CREATE OR REPLACE FUNCTION public.next_credit_note_number(
  p_tenant_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Atomic upsert-and-increment; the UPDATE locks the counter row.
  INSERT INTO public.credit_note_counters (tenant_id, year, last_number)
  VALUES (p_tenant_id, v_year, 1)
  ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_number = public.credit_note_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN 'CN-' || v_year::TEXT || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_credit_note_number(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.next_credit_note_number(UUID) TO authenticated;

-- One-time backfill so freshly minted numbers continue past any hand-typed ones.
-- We seed the current-year counter from the count of existing notes per tenant;
-- the format differs from old numbers but uniqueness going forward is guaranteed.
DO $$
DECLARE
  r RECORD;
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
  FOR r IN
    SELECT tenant_id, COUNT(*) AS n
    FROM public.ar_credit_notes
    GROUP BY tenant_id
  LOOP
    INSERT INTO public.credit_note_counters (tenant_id, year, last_number)
    VALUES (r.tenant_id, v_year, r.n)
    ON CONFLICT (tenant_id, year)
    DO UPDATE SET last_number = GREATEST(public.credit_note_counters.last_number, EXCLUDED.last_number);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.next_credit_note_number(UUID) IS
  'Atomic per-tenant/year credit-note serial (CN-YYYY-NNNN). Race-free via locked counter row.';
