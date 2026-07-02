-- ─────────────────────────────────────────────────────────────────────────────
-- Approval workflow hardening (industrial-grade)
--
--  1. Approval columns become tamper-proof: approval_status→approved/rejected,
--     approved_by, approved_at can ONLY be set by approve_invoice() (which sets a
--     transaction-local flag). Direct API/table updates are rejected.
--  2. created_by is immutable after insert (defeats SoD spoofing).
--  3. Threshold is evaluated in BASE currency (total × exchange_rate).
--  4. Editing an invoice clears any prior approval (stale approvals can't survive).
--  5. Rejections require a reason.
--  6. Append-only approval history for audit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Append-only approval history ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_approval_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  actor_id     UUID REFERENCES public.users(id),
  action       TEXT NOT NULL CHECK (action IN ('submitted','approved','rejected')),
  note         TEXT,
  amount_base  NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_approval_hist ON public.invoice_approval_history (invoice_id, created_at);
ALTER TABLE public.invoice_approval_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_approval_hist_select ON public.invoice_approval_history;
CREATE POLICY inv_approval_hist_select ON public.invoice_approval_history
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT ON public.invoice_approval_history TO authenticated;

-- ── (3)+(4) Threshold in base currency; clear stale approval on edit ──
CREATE OR REPLACE FUNCTION public.set_invoice_approval_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_threshold NUMERIC;
  v_base      NUMERIC;
BEGIN
  SELECT invoice_approval_threshold INTO v_threshold
  FROM public.account_settings WHERE tenant_id = NEW.tenant_id;

  v_base := NEW.total_amount * COALESCE(NEW.exchange_rate, 1);

  IF v_threshold IS NOT NULL AND v_threshold > 0 AND v_base >= v_threshold THEN
    NEW.approval_status := 'pending';
  ELSE
    NEW.approval_status := 'not_required';
  END IF;

  -- Any (re)evaluation voids a previous sign-off: never carry approver identity
  -- across an amount change.
  NEW.approved_by  := NULL;
  NEW.approved_at  := NULL;
  NEW.approval_note := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_approval ON public.invoices;
CREATE TRIGGER trg_invoice_approval
  BEFORE INSERT OR UPDATE OF total_amount, exchange_rate ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_approval_status();

-- ── (1)+(2) Tamper guard ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_invoice_approval_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- created_by is write-once.
  IF OLD.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable' USING ERRCODE = 'P0001';
  END IF;

  -- Asserting an approver, or moving into approved/rejected, is only allowed
  -- from within approve_invoice() (which sets app.invoice_approving = '1').
  IF (NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by)
     OR (NEW.approval_status IS DISTINCT FROM OLD.approval_status
         AND NEW.approval_status IN ('approved','rejected')) THEN
    IF current_setting('app.invoice_approving', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'approval_status can only be changed via approve_invoice()' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Name starts with 'a' so it fires before the reassessment trigger.
DROP TRIGGER IF EXISTS a_guard_invoice_approval ON public.invoices;
CREATE TRIGGER a_guard_invoice_approval
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_approval_columns();

-- ── approve_invoice(): flag-gated, reason-required, history-logged ────
CREATE OR REPLACE FUNCTION public.approve_invoice(
  p_invoice_id UUID,
  p_decision   TEXT,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_inv         public.invoices;
  v_is_eligible BOOLEAN;
  v_eligible_n  INTEGER;
  v_self        BOOLEAN;
  v_note        TEXT;
  v_base        NUMERIC;
BEGIN
  SELECT u.id, u.tenant_id INTO v_user_id, v_tenant_id
  FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'BAD_DECISION'; END IF;
  IF p_decision = 'rejected' AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: a reason is required to reject' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND tenant_id = v_tenant_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_inv.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_PENDING: invoice is %', v_inv.approval_status USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.eligible_invoice_approvers(v_tenant_id) e WHERE e.user_id = v_user_id),
         (SELECT count(*) FROM public.eligible_invoice_approvers(v_tenant_id))
    INTO v_is_eligible, v_eligible_n;
  IF NOT v_is_eligible THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER: you are not appointed to approve invoices' USING ERRCODE = 'P0001';
  END IF;

  v_self := v_inv.created_by IS NOT NULL AND v_inv.created_by = v_user_id;
  IF v_self AND v_eligible_n > 1 THEN
    RAISE EXCEPTION 'SEGREGATION_OF_DUTIES: the approver cannot be the invoice creator' USING ERRCODE = 'P0001';
  END IF;
  v_note := CASE WHEN v_self THEN COALESCE(p_note || ' ', '') || '[self-approved: sole eligible approver]' ELSE p_note END;
  v_base := v_inv.total_amount * COALESCE(v_inv.exchange_rate, 1);

  -- Open the tamper gate for this transaction only.
  PERFORM set_config('app.invoice_approving', '1', true);

  UPDATE public.invoices
     SET approval_status = p_decision, approved_by = v_user_id, approved_at = now(), approval_note = v_note
   WHERE id = p_invoice_id;

  INSERT INTO public.invoice_approval_history (tenant_id, invoice_id, actor_id, action, note, amount_base)
  VALUES (v_tenant_id, p_invoice_id, v_user_id, p_decision, v_note, v_base);

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES (
    CASE WHEN p_decision = 'approved' THEN 'Invoice Approved' ELSE 'Invoice Rejected' END,
    'invoices', p_invoice_id, v_user_id, v_tenant_id,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', v_note, 'self_approved', v_self, 'amount_base', v_base)
  );

  RETURN jsonb_build_object('ok', true, 'status', p_decision, 'self_approved', v_self);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) TO authenticated;
