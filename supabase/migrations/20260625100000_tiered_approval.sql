-- ─────────────────────────────────────────────────────────────────────────────
-- Tiered (multi-level) invoice approval
--
-- A tenant defines tiers: [{min_amount, required_approvals}]. An invoice needs
-- the highest required_approvals of any tier its BASE total reaches, satisfied by
-- that many DISTINCT eligible approvers (none of them the creator). It stays
-- 'pending' until the count is met, then flips to 'approved'. Editing the amount
-- resets the round. Falls back to the single invoice_approval_threshold (=1
-- approver) when no tiers are configured.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS invoice_approval_tiers JSONB;   -- [{"min_amount":n,"required_approvals":k}]

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS required_approvals INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approvals_count    INTEGER NOT NULL DEFAULT 0;

-- ── Reassessment: compute required approvals from tiers/threshold ─────
CREATE OR REPLACE FUNCTION public.set_invoice_approval_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_threshold NUMERIC;
  v_tiers     JSONB;
  v_base      NUMERIC;
  v_required  INTEGER := 0;
BEGIN
  SELECT invoice_approval_threshold, invoice_approval_tiers
    INTO v_threshold, v_tiers
  FROM public.account_settings WHERE tenant_id = NEW.tenant_id;

  v_base := NEW.total_amount * COALESCE(NEW.exchange_rate, 1);

  SELECT COALESCE(MAX((t->>'required_approvals')::int), 0) INTO v_required
  FROM jsonb_array_elements(COALESCE(v_tiers, '[]'::jsonb)) t
  WHERE v_base >= (t->>'min_amount')::numeric;

  IF v_required = 0 AND v_threshold IS NOT NULL AND v_threshold > 0 AND v_base >= v_threshold THEN
    v_required := 1;
  END IF;

  IF v_required > 0 THEN
    NEW.approval_status := 'pending';
    NEW.required_approvals := v_required;
  ELSE
    NEW.approval_status := 'not_required';
    NEW.required_approvals := 0;
  END IF;

  NEW.approvals_count := 0;
  NEW.approved_by := NULL;
  NEW.approved_at := NULL;
  NEW.approval_note := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_approval ON public.invoices;
CREATE TRIGGER trg_invoice_approval
  BEFORE INSERT OR UPDATE OF total_amount, exchange_rate ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_approval_status();

-- ── AFTER: log a 'submitted' round marker + notify approvers ──────────
CREATE OR REPLACE FUNCTION public.notify_invoice_approvers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status = 'pending'
     AND (TG_OP = 'INSERT'
          OR OLD.approval_status IS DISTINCT FROM NEW.approval_status
          OR OLD.total_amount   IS DISTINCT FROM NEW.total_amount
          OR OLD.exchange_rate  IS DISTINCT FROM NEW.exchange_rate) THEN

    -- Round marker: approvals are counted only after the latest 'submitted'.
    INSERT INTO public.invoice_approval_history (tenant_id, invoice_id, actor_id, action, note, amount_base)
    VALUES (NEW.tenant_id, NEW.id, NEW.created_by, 'submitted', NULL,
            NEW.total_amount * COALESCE(NEW.exchange_rate, 1));

    INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
    SELECT NEW.tenant_id, e.user_id, 'warning', 'Invoice needs approval',
           'Invoice ' || NEW.invoice_number || ' needs approval (' ||
           NEW.required_approvals || ' approver' || CASE WHEN NEW.required_approvals > 1 THEN 's' ELSE '' END ||
           ') before it can be posted.',
           '/sales/invoices'
    FROM public.eligible_invoice_approvers(NEW.tenant_id) e
    WHERE e.user_id <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_invoice_approvers ON public.invoices;
CREATE TRIGGER trg_notify_invoice_approvers
  AFTER INSERT OR UPDATE OF approval_status, total_amount, exchange_rate ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_approvers();

-- ── approve_invoice(): collect N distinct approvers ──────────────────
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
  v_submitted   TIMESTAMPTZ;
  v_collected   INTEGER;
  v_required    INTEGER;
  v_final       BOOLEAN;
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
  v_base := v_inv.total_amount * COALESCE(v_inv.exchange_rate, 1);
  v_note := CASE WHEN v_self THEN COALESCE(p_note || ' ', '') || '[self-approved: sole eligible approver]' ELSE p_note END;

  PERFORM set_config('app.invoice_approving', '1', true);

  -- ── Rejection: terminal, any single eligible approver ──
  IF p_decision = 'rejected' THEN
    UPDATE public.invoices
       SET approval_status = 'rejected', approved_by = v_user_id, approved_at = now(), approval_note = v_note
     WHERE id = p_invoice_id;
    INSERT INTO public.invoice_approval_history (tenant_id, invoice_id, actor_id, action, note, amount_base)
    VALUES (v_tenant_id, p_invoice_id, v_user_id, 'rejected', v_note, v_base);
    INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
    VALUES ('Invoice Rejected', 'invoices', p_invoice_id, v_user_id, v_tenant_id,
            jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', v_note));
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  -- ── Approval: accumulate distinct approvers for the current round ──
  SELECT max(created_at) INTO v_submitted
  FROM public.invoice_approval_history WHERE invoice_id = p_invoice_id AND action = 'submitted';

  IF EXISTS (
    SELECT 1 FROM public.invoice_approval_history
    WHERE invoice_id = p_invoice_id AND action = 'approved' AND actor_id = v_user_id
      AND (v_submitted IS NULL OR created_at >= v_submitted)
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED: you have already approved this invoice' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.invoice_approval_history (tenant_id, invoice_id, actor_id, action, note, amount_base)
  VALUES (v_tenant_id, p_invoice_id, v_user_id, 'approved', p_note, v_base);

  SELECT count(DISTINCT actor_id) INTO v_collected
  FROM public.invoice_approval_history
  WHERE invoice_id = p_invoice_id AND action = 'approved'
    AND (v_submitted IS NULL OR created_at >= v_submitted);

  v_required := GREATEST(v_inv.required_approvals, 1);
  v_final := v_collected >= v_required;

  IF v_final THEN
    UPDATE public.invoices
       SET approval_status = 'approved', approved_by = v_user_id, approved_at = now(),
           approval_note = v_note, approvals_count = v_collected
     WHERE id = p_invoice_id;
  ELSE
    UPDATE public.invoices SET approvals_count = v_collected WHERE id = p_invoice_id;
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES ('Invoice Approved', 'invoices', p_invoice_id, v_user_id, v_tenant_id,
          jsonb_build_object('invoice_number', v_inv.invoice_number, 'collected', v_collected,
                             'required', v_required, 'final', v_final, 'self_approved', v_self));

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_final THEN 'approved' ELSE 'pending' END,
                            'collected', v_collected, 'required', v_required, 'final', v_final);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) TO authenticated;
