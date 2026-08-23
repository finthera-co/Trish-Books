-- ============================================================================
-- VOID CHECK — reversal journal entry, modeled on void_supplier_bill
-- (20260821080000_bill_void_flow.sql). Simpler than the bill case: checks
-- carry no tax total to reverse (is_taxable is an inert display-only
-- checkbox, no tax_codes table exists yet), so this is a pure debit/credit
-- swap of the linked journal entry.
--
-- block_posted_payment_voucher_edits() (20260427033230_...sql) already
-- permits status 'posted' -> 'voided', so no trigger change is needed.
-- ============================================================================

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.journal_entries(id);

CREATE OR REPLACE FUNCTION public.void_check(p_voucher_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_user_id    uuid;
  v_voucher    payment_vouchers%ROWTYPE;
  v_reversal_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_voucher FROM payment_vouchers
  WHERE id = p_voucher_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check not found in this tenant';
  END IF;

  IF v_voucher.status = 'voided' THEN
    RAISE EXCEPTION 'Check is already voided';
  END IF;

  IF v_voucher.status <> 'posted' THEN
    RAISE EXCEPTION 'Only a posted check can be voided (status is "%")', v_voucher.status;
  END IF;

  IF public.is_period_closed(v_tenant_id, CURRENT_DATE) THEN
    RAISE EXCEPTION 'Cannot void a check — the current fiscal period is closed';
  END IF;

  IF v_voucher.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Check has no linked journal entry to reverse';
  END IF;

  INSERT INTO journal_entries (tenant_id, description, entry_date, reference, created_by, status)
  VALUES (
    v_tenant_id,
    'Void: Check ' || COALESCE(v_voucher.cheque_number, v_voucher.voucher_number) || ' — ' || v_voucher.voucher_number,
    CURRENT_DATE,
    v_voucher.voucher_number || '-VOID',
    v_user_id,
    'posted'
  )
  RETURNING id INTO v_reversal_id;

  -- Debit/credit swapped copy of every original line.
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, cost_center_id)
  SELECT v_reversal_id, jl.account_id, jl.credit, jl.debit, jl.cost_center_id
  FROM journal_lines jl
  WHERE jl.journal_entry_id = v_voucher.journal_entry_id;

  UPDATE journal_entries SET status = 'voided' WHERE id = v_voucher.journal_entry_id;

  UPDATE payment_vouchers
  SET status = 'voided',
      voided_at = now(),
      voided_by = v_user_id,
      void_reason = NULLIF(p_reason, ''),
      reversal_journal_entry_id = v_reversal_id
  WHERE id = p_voucher_id;

  INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (
    v_tenant_id, v_user_id, 'Check Voided', 'payment_vouchers', p_voucher_id,
    jsonb_build_object('reason', p_reason, 'reversal_journal_entry_id', v_reversal_id)
  );

  RETURN jsonb_build_object('voucher_id', p_voucher_id, 'reversal_journal_entry_id', v_reversal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_check(uuid, text) TO authenticated;
