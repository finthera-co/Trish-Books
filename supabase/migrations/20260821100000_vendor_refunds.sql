-- ============================================================================
-- VENDOR REFUNDS
--
-- Cash received back from a vendor (e.g. against a vendor_credit_notes entry
-- that reduced AP via Dr AP / Cr Expense but was never drawn down against a
-- future bill). This is the missing third leg: Dr Bank / Cr AP, clearing the
-- debit balance the credit note left in the vendor's AP subledger. No
-- balance/application tracking exists on vendor_credit_notes today, so
-- credit_note_id here is a soft link for traceability, not a validated draw.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_refunds (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_id                 uuid NOT NULL REFERENCES public.vendors(id),
  refund_date               date NOT NULL DEFAULT CURRENT_DATE,
  amount                    numeric(18,2) NOT NULL CHECK (amount > 0),
  bank_account_id           uuid NOT NULL REFERENCES public.accounts(id),
  ap_account_id             uuid NOT NULL REFERENCES public.accounts(id),
  reference                 text,
  memo                      text,
  credit_note_id            uuid REFERENCES public.vendor_credit_notes(id),
  journal_entry_id          uuid REFERENCES public.journal_entries(id),
  status                    text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  voided_at                 timestamptz,
  voided_by                 uuid REFERENCES public.users(id),
  void_reason               text,
  reversal_journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by                uuid REFERENCES public.users(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_refunds_vendor ON public.vendor_refunds (tenant_id, vendor_id);

ALTER TABLE public.vendor_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_vendor_refunds ON public.vendor_refunds;
CREATE POLICY tenant_vendor_refunds ON public.vendor_refunds
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── record_vendor_refund ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_vendor_refund(
  p_vendor_id       uuid,
  p_refund_date     date,
  p_amount          numeric,
  p_bank_account_id uuid,
  p_ap_account_id   uuid,
  p_reference       text DEFAULT NULL,
  p_memo            text DEFAULT NULL,
  p_credit_note_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_bank accounts%ROWTYPE;
  v_ap accounts%ROWTYPE;
  v_refund_id uuid;
  v_je uuid;
  v_ap_line_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Vendor does not exist in this tenant';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  IF NOT public.is_cash_or_bank_account(p_bank_account_id) THEN
    RAISE EXCEPTION 'Bank/cash account must be an active Cash or Bank account';
  END IF;
  SELECT * INTO v_bank FROM public.accounts WHERE id = p_bank_account_id AND tenant_id = v_tenant;

  SELECT * INTO v_ap FROM public.accounts WHERE id = p_ap_account_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'AP control account does not exist in this tenant'; END IF;
  IF NOT v_ap.is_active THEN RAISE EXCEPTION 'AP control account "%" is inactive', v_ap.account_name; END IF;

  IF p_credit_note_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vendor_credit_notes WHERE id = p_credit_note_id AND tenant_id = v_tenant AND vendor_id = p_vendor_id
  ) THEN
    RAISE EXCEPTION 'Credit note not found for this vendor';
  END IF;

  IF public.is_period_closed(v_tenant, p_refund_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', p_refund_date;
  END IF;

  INSERT INTO public.vendor_refunds (
    tenant_id, vendor_id, refund_date, amount, bank_account_id, ap_account_id,
    reference, memo, credit_note_id, status, created_by
  ) VALUES (
    v_tenant, p_vendor_id, p_refund_date, p_amount, p_bank_account_id, p_ap_account_id,
    NULLIF(p_reference,''), NULLIF(p_memo,''), p_credit_note_id, 'posted', v_user
  )
  RETURNING id INTO v_refund_id;

  INSERT INTO public.journal_entries (
    tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type
  ) VALUES (
    v_tenant, p_refund_date,
    'Vendor refund' || CASE WHEN p_reference IS NOT NULL AND p_reference <> '' THEN ' - ' || p_reference ELSE '' END,
    p_reference, 'posted', now(), v_user, 'vendor_refund', v_refund_id, true, 'vendor_refund'
  )
  RETURNING id INTO v_je;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES (v_je, p_bank_account_id, p_amount, 0);

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, vendor_id)
  VALUES (v_je, p_ap_account_id, 0, p_amount, p_vendor_id)
  RETURNING id INTO v_ap_line_id;

  INSERT INTO public.ap_subledger (
    tenant_id, vendor_id, journal_line_id, journal_id, document_type, document_id, debit, credit, balance, amount
  ) VALUES (
    v_tenant, p_vendor_id, v_ap_line_id, v_je, 'vendor_refund', v_refund_id, 0, p_amount, -p_amount, -p_amount
  );

  UPDATE public.vendor_refunds SET journal_entry_id = v_je WHERE id = v_refund_id;

  RETURN jsonb_build_object('ok', true, 'refund_id', v_refund_id, 'journal_entry_id', v_je);
END;
$$;

REVOKE ALL ON FUNCTION public.record_vendor_refund(uuid, date, numeric, uuid, uuid, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_vendor_refund(uuid, date, numeric, uuid, uuid, text, text, uuid) TO authenticated;

-- ── void_vendor_refund ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_vendor_refund(p_refund_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_ref vendor_refunds%ROWTYPE;
  v_rev_je uuid;
  v_l RECORD;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_ref FROM public.vendor_refunds WHERE id = p_refund_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF v_ref.status = 'voided' THEN RAISE EXCEPTION 'Refund is already voided'; END IF;
  IF public.is_period_closed(v_tenant, CURRENT_DATE) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', CURRENT_DATE;
  END IF;

  IF v_ref.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (
      tenant_id, entry_date, description, reference, status, posted_at,
      created_by, source_type, source_id, is_system_generated, entry_type, reversal_of
    ) VALUES (
      v_tenant, CURRENT_DATE, 'Void: Vendor refund' || COALESCE(' — ' || p_reason, ''),
      v_ref.reference, 'posted', now(), v_user, 'vendor_refund_void', v_ref.id, true, 'vendor_refund_void', v_ref.journal_entry_id
    )
    RETURNING id INTO v_rev_je;

    FOR v_l IN SELECT account_id, debit, credit FROM public.journal_lines WHERE journal_entry_id = v_ref.journal_entry_id LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_rev_je, v_l.account_id, v_l.credit, v_l.debit);
    END LOOP;

    UPDATE public.journal_entries SET status = 'voided', voided_at = now(), voided_by = v_user
      WHERE id = v_ref.journal_entry_id;
  END IF;

  UPDATE public.vendor_refunds
  SET status = 'voided', voided_at = now(), voided_by = v_user, void_reason = p_reason,
      reversal_journal_entry_id = v_rev_je
  WHERE id = p_refund_id;

  RETURN jsonb_build_object('ok', true, 'reversal_journal_id', v_rev_je);
END;
$$;

REVOKE ALL ON FUNCTION public.void_vendor_refund(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_vendor_refund(uuid, text) TO authenticated;
