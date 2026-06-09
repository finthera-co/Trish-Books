-- AP Module Phase 2: bill_payments, allocations, vendor_credit_notes, amount_paid trigger
-- Mirrors the AR module structure (payments_received, ar_credit_notes)

-- ──────────────────────────────────────────────────────────
-- 1a. Bill payments table (mirrors payments_received)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  ap_account_id uuid NOT NULL REFERENCES public.accounts(id),
  reference text,
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  status text NOT NULL DEFAULT 'posted',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_bill_payments" ON public.bill_payments
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- ──────────────────────────────────────────────────────────
-- 1b. Bill payment allocations
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bill_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.bill_payments(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.supplier_bills(id),
  amount_applied numeric(18,2) NOT NULL CHECK (amount_applied > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bill_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_bill_payment_alloc" ON public.bill_payment_allocations
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- ──────────────────────────────────────────────────────────
-- 1c. Add amount_paid to supplier_bills
-- ──────────────────────────────────────────────────────────
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS amount_paid numeric(18,2) NOT NULL DEFAULT 0;

-- ──────────────────────────────────────────────────────────
-- 1d. Trigger: keep supplier_bills.amount_paid in sync
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_bill_amount_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.supplier_bills
  SET amount_paid = (
    SELECT COALESCE(SUM(amount_applied), 0)
    FROM public.bill_payment_allocations
    WHERE bill_id = COALESCE(NEW.bill_id, OLD.bill_id)
  )
  WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_update_bill_amount_paid ON public.bill_payment_allocations;
CREATE TRIGGER trg_update_bill_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON public.bill_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_update_bill_amount_paid();

-- ──────────────────────────────────────────────────────────
-- 1e. Vendor credit notes (mirrors ar_credit_notes)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  credit_note_number text NOT NULL,
  credit_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text,
  expense_account_id uuid REFERENCES public.accounts(id),
  ap_account_id uuid REFERENCES public.accounts(id),
  bill_id uuid REFERENCES public.supplier_bills(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, credit_note_number)
);
ALTER TABLE public.vendor_credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_vendor_credit_notes" ON public.vendor_credit_notes
  FOR ALL TO authenticated USING (tenant_id = get_user_tenant_id());

-- ──────────────────────────────────────────────────────────
-- 1f. AP Aging RPC — uses amount_paid for accurate balances
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ap_aging_report(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID := get_user_tenant_id();
  v_result JSON;
BEGIN
  WITH open_bills AS (
    SELECT
      sb.vendor_id,
      v.name AS vendor_name,
      sb.id AS bill_id,
      sb.bill_number,
      sb.due_date,
      (sb.total_amount - sb.amount_paid) AS outstanding,
      (p_as_of_date - COALESCE(sb.due_date, sb.bill_date)) AS days_overdue
    FROM public.supplier_bills sb
    JOIN public.vendors v ON v.id = sb.vendor_id
    WHERE sb.tenant_id = v_tenant_id
      AND sb.status IN ('posted', 'partial')
      AND (sb.total_amount - sb.amount_paid) > 0.01
      AND sb.bill_date <= p_as_of_date
  ),
  bucketed AS (
    SELECT
      vendor_id, vendor_name,
      SUM(CASE WHEN days_overdue <= 0  THEN outstanding ELSE 0 END) AS current_amt,
      SUM(CASE WHEN days_overdue BETWEEN 1  AND 30  THEN outstanding ELSE 0 END) AS days_1_30,
      SUM(CASE WHEN days_overdue BETWEEN 31 AND 60  THEN outstanding ELSE 0 END) AS days_31_60,
      SUM(CASE WHEN days_overdue BETWEEN 61 AND 90  THEN outstanding ELSE 0 END) AS days_61_90,
      SUM(CASE WHEN days_overdue BETWEEN 91 AND 120 THEN outstanding ELSE 0 END) AS days_91_120,
      SUM(CASE WHEN days_overdue > 120               THEN outstanding ELSE 0 END) AS over_120,
      SUM(outstanding) AS total
    FROM open_bills
    GROUP BY vendor_id, vendor_name
  )
  SELECT json_build_object(
    'rows', COALESCE(json_agg(b ORDER BY b.total DESC), '[]'::json),
    'totals', json_build_object(
      'current',     SUM(current_amt),
      'days_1_30',   SUM(days_1_30),
      'days_31_60',  SUM(days_31_60),
      'days_61_90',  SUM(days_61_90),
      'days_91_120', SUM(days_91_120),
      'over_120',    SUM(over_120),
      'grand_total', SUM(total)
    )
  ) INTO v_result FROM bucketed b;

  RETURN COALESCE(v_result, '{"rows":[],"totals":{"current":0,"days_1_30":0,"days_31_60":0,"days_61_90":0,"days_91_120":0,"over_120":0,"grand_total":0}}'::json);
END $$;

GRANT EXECUTE ON FUNCTION ap_aging_report(DATE) TO authenticated;
