-- ============================================================================
-- PAY BILLS — QUICKBOOKS PARITY UPGRADE
-- Adds the Payment Method / "To be printed" vs. assigned check number choice
-- that QuickBooks' Pay Bills window has and this app's bill_payments flow was
-- missing. Reuses the same payment-method vocabulary already established for
-- Write Checks (Cash / Bank Transfer / Cheque / Credit Card) for consistency
-- across the app rather than introducing a second, narrower list.
-- ============================================================================

ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'Cheque',
  ADD COLUMN IF NOT EXISTS print_later boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS check_number text;

ALTER TABLE public.bill_payments
  DROP CONSTRAINT IF EXISTS bill_payments_payment_method_chk;
ALTER TABLE public.bill_payments
  ADD CONSTRAINT bill_payments_payment_method_chk
    CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Cheque', 'Credit Card'));

-- RLS hardening: "tenant_bill_payments" was USING-only; add a matching
-- WITH CHECK (same fix already applied to payment_voucher_lines / supplier_bill_lines).
DROP POLICY IF EXISTS "tenant_bill_payments" ON public.bill_payments;
CREATE POLICY "tenant_bill_payments" ON public.bill_payments
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
