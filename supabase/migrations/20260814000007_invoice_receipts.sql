-- ─────────────────────────────────────────────────────────────────────────────
-- Issued invoice receipts
--
-- Until now a receipt was a throwaway PDF: the Receipts screen invented a
-- random RCP number, rendered a document, and remembered nothing. Nothing tied
-- a receipt to an invoice, so the same invoice could be receipted any number of
-- times and the invoice itself never knew it had been settled on paper.
--
-- This makes an issued receipt a stored, numbered document:
--   * exactly ONE receipt per invoice (uq_invoice_receipt_per_invoice)
--   * only for a posted invoice that is settled in full — a receipt is the
--     final settlement document, so its PAID stamp can never be a false claim
--   * numbered atomically from the existing per-tenant receipt_counters
--   * written only by issue_invoice_receipt(); no client write policies exist,
--     so the one-per-invoice rule cannot be bypassed from the browser
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_receipts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT: an invoice with an issued receipt is a settled
  -- document. Only drafts are deletable and a draft can never be receipted.
  invoice_id       UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  receipt_number   TEXT NOT NULL,
  receipt_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  -- What the receipt acknowledges. Equal to the invoice total: a receipt is
  -- only issued once the invoice is settled in full.
  amount           NUMERIC NOT NULL CHECK (amount > 0),
  currency         TEXT NOT NULL DEFAULT 'LKR',
  received_from    TEXT,
  customer_address TEXT,
  payment_method   TEXT,
  reference        TEXT,
  notes            TEXT,
  issued_by        UUID REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_invoice_receipt_per_invoice UNIQUE (invoice_id),
  CONSTRAINT uq_invoice_receipt_number      UNIQUE (tenant_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_invoice_receipts_tenant ON public.invoice_receipts (tenant_id);

COMMENT ON TABLE public.invoice_receipts IS
  'One issued settlement receipt per invoice. Its existence is what puts the PAID stamp on the invoice document.';

ALTER TABLE public.invoice_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_receipts_select ON public.invoice_receipts;
CREATE POLICY invoice_receipts_select ON public.invoice_receipts
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- No INSERT/UPDATE/DELETE policies: issue_invoice_receipt() is the only writer.
GRANT SELECT ON public.invoice_receipts TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- issue_invoice_receipt — allocate a number and record the receipt, once
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.issue_invoice_receipt(
  p_invoice_id       UUID,
  p_receipt_date     DATE DEFAULT NULL,
  p_payment_method   TEXT DEFAULT NULL,
  p_reference        TEXT DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL,
  p_received_from    TEXT DEFAULT NULL,
  p_customer_address TEXT DEFAULT NULL
)
RETURNS public.invoice_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant UUID := get_user_tenant_id();
  v_user          UUID;
  v_inv           RECORD;
  v_settled       NUMERIC;
  v_balance       NUMERIC;
  v_number        TEXT;
  v_row           public.invoice_receipts;
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'INVOICE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the invoice so two concurrent issues serialise here rather than
  -- racing to the unique index and surfacing a raw constraint error.
  SELECT id, tenant_id, invoice_number, status, total_amount, currency, customer_id
    INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.tenant_id IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.status IN ('draft', 'voided') THEN
    RAISE EXCEPTION 'INVOICE_NOT_POSTED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invoice_receipts WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'RECEIPT_ALREADY_ISSUED' USING ERRCODE = 'P0001';
  END IF;

  -- Settlement, computed exactly as the invoice list does: allocations whose
  -- parent receipt is not voided, plus non-voided credit notes.
  SELECT
    COALESCE((
      SELECT SUM(a.amount)
      FROM public.payment_received_allocations a
      JOIN public.payments_received pr ON pr.id = a.payment_id
      WHERE a.invoice_id = p_invoice_id AND pr.status <> 'voided'
    ), 0)
    + COALESCE((
      SELECT SUM(cn.amount)
      FROM public.ar_credit_notes cn
      WHERE cn.invoice_id = p_invoice_id AND cn.status <> 'voided'
    ), 0)
  INTO v_settled;

  v_balance := ROUND(COALESCE(v_inv.total_amount, 0) - v_settled, 2);
  IF v_balance > 0.005 THEN
    RAISE EXCEPTION 'INVOICE_NOT_SETTLED: % still outstanding on %',
      v_balance, v_inv.invoice_number USING ERRCODE = 'P0001';
  END IF;

  -- users.id, never auth.uid() — issued_by is a FK onto public.users.
  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid();

  v_number := public.next_receipt_number(v_inv.tenant_id);

  INSERT INTO public.invoice_receipts (
    tenant_id, invoice_id, receipt_number, receipt_date, amount, currency,
    received_from, customer_address, payment_method, reference, notes, issued_by
  ) VALUES (
    v_inv.tenant_id,
    p_invoice_id,
    v_number,
    COALESCE(p_receipt_date, CURRENT_DATE),
    COALESCE(v_inv.total_amount, 0),
    COALESCE(v_inv.currency, 'LKR'),
    COALESCE(NULLIF(BTRIM(p_received_from), ''), (SELECT c.name FROM public.customers c WHERE c.id = v_inv.customer_id)),
    NULLIF(BTRIM(p_customer_address), ''),
    NULLIF(BTRIM(p_payment_method), ''),
    NULLIF(BTRIM(p_reference), ''),
    NULLIF(BTRIM(p_notes), ''),
    v_user
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice_receipt(UUID, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_invoice_receipt(UUID, DATE, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
