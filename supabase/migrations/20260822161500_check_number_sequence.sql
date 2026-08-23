-- ============================================================================
-- CHECK NUMBER SEQUENCE
--
-- payment_vouchers.cheque_number is currently guessed client-side
-- (PaymentVoucherForm.tsx: `CHK-${count+1}`), which is not concurrency-safe
-- and can collide/skip. This adds a real per-tenant, per-bank-account
-- sequence, mirroring invoice_serial_sequences / next_invoice_serial
-- (20260625110000_invoice_serial_register.sql). Advisory only — no
-- uniqueness constraint is added on cheque_number, matching current
-- behavior; the server supplies a number when the caller leaves it blank,
-- and a user-typed value is still accepted as-is.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.check_number_sequences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  prefix             TEXT NOT NULL DEFAULT 'CHK-',
  last_seq           INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_account_id)
);

ALTER TABLE public.check_number_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS check_number_sequences_select ON public.check_number_sequences;
CREATE POLICY check_number_sequences_select ON public.check_number_sequences
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT ON public.check_number_sequences TO authenticated;

-- next_check_number(): upsert-and-increment, SECURITY DEFINER so it can be
-- called from create_check without a separate grant per caller.
CREATE OR REPLACE FUNCTION public.next_check_number(p_payment_account_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_prefix text;
  v_seq    int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context for check number generation';
  END IF;
  IF p_payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account is required for check number generation';
  END IF;

  INSERT INTO public.check_number_sequences (tenant_id, payment_account_id, last_seq)
  VALUES (v_tenant, p_payment_account_id, 1)
  ON CONFLICT (tenant_id, payment_account_id)
  DO UPDATE SET last_seq = public.check_number_sequences.last_seq + 1,
                updated_at = now()
  RETURNING last_seq, prefix INTO v_seq, v_prefix;

  RETURN v_prefix || lpad(v_seq::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_check_number(uuid) TO authenticated;

-- Backfill: seed last_seq per (tenant, payment_account) from the highest
-- existing "PREFIX00000" style cheque_number already written for that
-- account, so existing tenants don't restart numbering at 1 and collide
-- with checks already on file.
WITH parsed AS (
  SELECT
    tenant_id,
    payment_account_id,
    regexp_replace(cheque_number, '[0-9]+$', '') AS prefix,
    (regexp_match(cheque_number, '([0-9]+)$'))[1]::int AS seq
  FROM public.payment_vouchers
  WHERE cheque_number ~ '[0-9]+$'
),
best AS (
  SELECT DISTINCT ON (tenant_id, payment_account_id)
    tenant_id, payment_account_id, prefix, seq
  FROM parsed
  ORDER BY tenant_id, payment_account_id, seq DESC
)
INSERT INTO public.check_number_sequences (tenant_id, payment_account_id, prefix, last_seq)
SELECT tenant_id, payment_account_id, COALESCE(NULLIF(prefix, ''), 'CHK-'), seq FROM best
ON CONFLICT (tenant_id, payment_account_id) DO UPDATE
  SET last_seq = GREATEST(public.check_number_sequences.last_seq, EXCLUDED.last_seq),
      prefix   = EXCLUDED.prefix;
