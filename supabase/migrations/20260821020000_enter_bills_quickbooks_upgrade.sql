-- ============================================================================
-- ENTER BILLS — QUICKBOOKS PARITY UPGRADE
-- Brings the "Enter Bills" flow (supplier_bills / supplier_bill_lines) up to
-- the same QuickBooks-parity standard as the Write Checks upgrade:
--   - vendor Payment Terms (mirrors customers.payment_terms exactly, reusing
--     the existing payment_term_days() helper from invoice_due_tracking) with
--     an auto-calculated Bill Due date
--   - a stored address_block snapshot (mirrors payment_vouchers.address_block)
--   - Customer:Job / Billable job-costing columns per line
-- No Items-tab / inventory columns are added — supplier_bill_lines.item_id was
-- already dropped in 20260820075032_remove_inventory_feature_v2.sql, and bill
-- creation stays account-based only, same call made for Write Checks.
-- ============================================================================

-- 1. Vendor default payment terms (same code format as customers.payment_terms:
--    'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60').
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'net_30';

-- 2. supplier_bills: snapshot payment_terms at bill time (so a later change to
--    the vendor's default doesn't retroactively alter historical bills — same
--    reasoning as invoices.payment_terms), plus the address snapshot.
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'net_30',
  ADD COLUMN IF NOT EXISTS address_block text;

-- 3. Safety net: if a bill is inserted without a due_date, derive it from
--    bill_date + the term (public.payment_term_days already exists — added by
--    20260615000001_invoice_due_tracking.sql for the AR side). The UI also
--    computes this client-side and lets the user override it, same as invoices.
CREATE OR REPLACE FUNCTION public.set_bill_due_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := COALESCE(NEW.bill_date, CURRENT_DATE)
                    + (public.payment_term_days(NEW.payment_terms) || ' days')::interval;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_bill_due_date ON public.supplier_bills;
CREATE TRIGGER trg_set_bill_due_date
  BEFORE INSERT ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.set_bill_due_date();

-- 4. supplier_bill_lines: job-costing columns (mirrors payment_voucher_lines).
ALTER TABLE public.supplier_bill_lines
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS is_billable boolean NOT NULL DEFAULT false;

ALTER TABLE public.supplier_bill_lines
  DROP CONSTRAINT IF EXISTS sbl_billable_requires_customer;
ALTER TABLE public.supplier_bill_lines
  ADD CONSTRAINT sbl_billable_requires_customer
    CHECK (NOT is_billable OR customer_id IS NOT NULL);

-- 5. RLS hardening: bill_update / bl_update were USING-only; add matching
--    WITH CHECK clauses (same fix already applied to payment_voucher_lines).
DROP POLICY IF EXISTS "bill_update" ON public.supplier_bills;
CREATE POLICY "bill_update" ON public.supplier_bills FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id() AND status = 'draft')
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "bl_update" ON public.supplier_bill_lines;
CREATE POLICY "bl_update" ON public.supplier_bill_lines FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
