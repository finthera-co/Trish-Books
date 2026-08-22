-- ============================================================================
-- BILL VOID + BILL PAYMENT VOID
--
-- AP had no way to void a posted bill or a posted bill payment — the only
-- terminal states were 'cancelled'/'reversed' (values that exist on the
-- status CHECK but nothing ever set them) and posting_status='VOID' (dead
-- plumbing, never written for bills). This adds a real void flow, mirroring
-- rpc_void_payroll_run (supabase/migrations/20260624360000_void_payroll_run.sql)
-- for the reversal-JE mechanics and the void columns already on
-- payments_received for the audit columns.
-- ============================================================================

-- ── Bill void columns ────────────────────────────────────────────────────
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.journal_entries(id);

-- Additive only — keep 'cancelled'/'reversed', both already relied on by
-- revalue_ap_fx and record_bill_payment.
ALTER TABLE public.supplier_bills
  DROP CONSTRAINT IF EXISTS supplier_bills_status_check;
ALTER TABLE public.supplier_bills
  ADD CONSTRAINT supplier_bills_status_check
  CHECK (status IN ('draft','posted','paid','cancelled','reversed','voided'));

-- ── Bill payment void columns ────────────────────────────────────────────
ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.journal_entries(id);

ALTER TABLE public.bill_payments
  DROP CONSTRAINT IF EXISTS bill_payments_status_check;
ALTER TABLE public.bill_payments
  ADD CONSTRAINT bill_payments_status_check
  CHECK (status IN ('posted','voided'));

-- ── void_supplier_bill ───────────────────────────────────────────────────
-- Requires the bill to be fully unpaid (amount_paid = 0) — any bill payments
-- must be voided first via void_bill_payment. Keeps ordering simple: void
-- leaf transactions before the document they settle.
CREATE OR REPLACE FUNCTION public.void_supplier_bill(p_bill_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_bill supplier_bills%ROWTYPE;
  v_rev_je uuid;
  v_l RECORD;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_bill FROM public.supplier_bills WHERE id = p_bill_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.status = 'voided' THEN RAISE EXCEPTION 'Bill is already voided'; END IF;
  IF v_bill.status NOT IN ('posted','paid') THEN RAISE EXCEPTION 'Only posted or paid bills can be voided (bill is %)', v_bill.status; END IF;
  IF v_bill.amount_paid > 0.005 THEN
    RAISE EXCEPTION 'This bill has payments applied — void the bill payment(s) first, then void the bill';
  END IF;
  IF public.is_period_closed(v_tenant, CURRENT_DATE) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', CURRENT_DATE;
  END IF;

  IF v_bill.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (
      tenant_id, entry_date, description, reference, status, posted_at,
      created_by, source_type, source_id, is_system_generated, entry_type, reversal_of
    ) VALUES (
      v_tenant, CURRENT_DATE, 'Void: Bill ' || v_bill.bill_number || COALESCE(' — ' || p_reason, ''),
      v_bill.bill_number, 'posted', now(), v_user, 'bill_void', v_bill.id, true, 'bill_void', v_bill.journal_entry_id
    )
    RETURNING id INTO v_rev_je;

    FOR v_l IN SELECT account_id, debit, credit FROM public.journal_lines WHERE journal_entry_id = v_bill.journal_entry_id LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_rev_je, v_l.account_id, v_l.credit, v_l.debit);
    END LOOP;

    UPDATE public.journal_entries SET status = 'voided', voided_at = now(), voided_by = v_user
      WHERE id = v_bill.journal_entry_id;

    PERFORM public.reverse_tax_transactions(v_tenant, 'supplier_bill', v_bill.id, v_rev_je, CURRENT_DATE);
  END IF;

  UPDATE public.supplier_bills
  SET status = 'voided', voided_at = now(), voided_by = v_user, void_reason = p_reason,
      reversal_journal_entry_id = v_rev_je
  WHERE id = p_bill_id;

  RETURN jsonb_build_object('ok', true, 'reversal_journal_id', v_rev_je);
END;
$$;

REVOKE ALL ON FUNCTION public.void_supplier_bill(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_supplier_bill(uuid, text) TO authenticated;

-- ── void_bill_payment ────────────────────────────────────────────────────
-- Unlike AR (ar_transactions is an append-only signed ledger),
-- supplier_bills.amount_paid is maintained by fn_update_bill_amount_paid,
-- which recomputes it as a fresh SUM(amount_applied) over
-- bill_payment_allocations on every INSERT/UPDATE/DELETE. Deleting this
-- payment's allocation rows is therefore the correct — and only valid,
-- given amount_applied has CHECK > 0 — way to restore each bill's balance;
-- no compensating negative row is needed or possible.
CREATE OR REPLACE FUNCTION public.void_bill_payment(p_payment_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_pmt bill_payments%ROWTYPE;
  v_rev_je uuid;
  v_l RECORD;
  v_bill_ids uuid[];
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_pmt FROM public.bill_payments WHERE id = p_payment_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_pmt.status = 'voided' THEN RAISE EXCEPTION 'Payment is already voided'; END IF;
  IF public.is_period_closed(v_tenant, CURRENT_DATE) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', CURRENT_DATE;
  END IF;

  SELECT array_agg(DISTINCT bill_id) INTO v_bill_ids
  FROM public.bill_payment_allocations WHERE payment_id = p_payment_id;

  IF v_pmt.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (
      tenant_id, entry_date, description, reference, status, posted_at,
      created_by, source_type, source_id, is_system_generated, entry_type, reversal_of
    ) VALUES (
      v_tenant, CURRENT_DATE, 'Void: Bill payment' || COALESCE(' ' || v_pmt.reference, '') || COALESCE(' — ' || p_reason, ''),
      v_pmt.reference, 'posted', now(), v_user, 'bill_payment_void', v_pmt.id, true, 'bill_payment_void', v_pmt.journal_entry_id
    )
    RETURNING id INTO v_rev_je;

    FOR v_l IN SELECT account_id, debit, credit FROM public.journal_lines WHERE journal_entry_id = v_pmt.journal_entry_id LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_rev_je, v_l.account_id, v_l.credit, v_l.debit);
    END LOOP;

    UPDATE public.journal_entries SET status = 'voided', voided_at = now(), voided_by = v_user
      WHERE id = v_pmt.journal_entry_id;

    IF v_pmt.wht_amount > 0 THEN
      PERFORM public.reverse_tax_transactions(v_tenant, 'bill_payment', v_pmt.id, v_rev_je, CURRENT_DATE);
    END IF;
  END IF;

  -- fn_update_bill_amount_paid fires per deleted row and recomputes each
  -- bill's amount_paid from the rows that remain.
  DELETE FROM public.bill_payment_allocations WHERE payment_id = p_payment_id;

  UPDATE public.supplier_bills b
  SET status = 'posted'
  WHERE b.id = ANY(v_bill_ids) AND b.status = 'paid' AND b.amount_paid < b.total_amount - 0.005;

  UPDATE public.bill_payments
  SET status = 'voided', voided_at = now(), voided_by = v_user, void_reason = p_reason,
      reversal_journal_entry_id = v_rev_je
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('ok', true, 'reversal_journal_id', v_rev_je, 'bills_restored', COALESCE(array_length(v_bill_ids, 1), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.void_bill_payment(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_bill_payment(uuid, text) TO authenticated;
