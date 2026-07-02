-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice approval ROUTING — designated approvers + owner fallback + notify
--
--  • A tenant can appoint one or more approvers (account_settings.invoice_approver_ids).
--  • If none are appointed, approval falls back to the owner(s): Primary/Super Admin.
--  • Owners are ALWAYS eligible (prevents deadlock / ultimate authority).
--  • Segregation of duties still holds (approver ≠ creator) — except when the
--    creator is the ONLY eligible approver (sole-admin tenant), which is allowed
--    and explicitly audit-flagged.
--  • When an invoice becomes 'pending', every eligible approver (except the
--    creator) is notified.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS invoice_approver_ids UUID[];   -- appointed approvers; null/empty = owner fallback

COMMENT ON COLUMN public.account_settings.invoice_approver_ids IS
  'Users appointed to approve invoices. Empty/null → owners (Primary/Super Admin) approve. Owners are always eligible.';

-- Eligible approvers for a tenant: appointed users ∪ owners; or just owners when
-- no one is appointed. Active users only.
CREATE OR REPLACE FUNCTION public.eligible_invoice_approvers(p_tenant_id UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH appointed AS (
    SELECT invoice_approver_ids AS ids FROM public.account_settings WHERE tenant_id = p_tenant_id
  ),
  owners AS (
    SELECT u.id FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id AND r.role_name IN ('Primary Admin','Super Admin')
  ),
  appointed_users AS (
    SELECT u.id FROM public.users u, appointed a
    WHERE u.tenant_id = p_tenant_id
      AND a.ids IS NOT NULL AND array_length(a.ids, 1) > 0
      AND u.id = ANY(a.ids)
  )
  SELECT id FROM owners
  UNION
  SELECT id FROM appointed_users;
$$;
GRANT EXECUTE ON FUNCTION public.eligible_invoice_approvers(UUID) TO authenticated, service_role;

-- ── Approve / reject with routing + deadlock-safe SoD ────────────────
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
BEGIN
  SELECT u.id, u.tenant_id INTO v_user_id, v_tenant_id
  FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'BAD_DECISION'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND tenant_id = v_tenant_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_inv.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_PENDING: invoice is %', v_inv.approval_status USING ERRCODE = 'P0001';
  END IF;

  -- Routing: caller must be an eligible approver for this tenant.
  SELECT EXISTS (SELECT 1 FROM public.eligible_invoice_approvers(v_tenant_id) e WHERE e.user_id = v_user_id),
         (SELECT count(*) FROM public.eligible_invoice_approvers(v_tenant_id))
    INTO v_is_eligible, v_eligible_n;
  IF NOT v_is_eligible THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER: you are not appointed to approve invoices' USING ERRCODE = 'P0001';
  END IF;

  -- Segregation of duties, with a sole-approver exception.
  v_self := v_inv.created_by IS NOT NULL AND v_inv.created_by = v_user_id;
  IF v_self AND v_eligible_n > 1 THEN
    RAISE EXCEPTION 'SEGREGATION_OF_DUTIES: the approver cannot be the invoice creator' USING ERRCODE = 'P0001';
  END IF;
  v_note := CASE WHEN v_self THEN COALESCE(p_note || ' ', '') || '[self-approved: sole eligible approver]' ELSE p_note END;

  UPDATE public.invoices
     SET approval_status = p_decision, approved_by = v_user_id, approved_at = now(), approval_note = v_note
   WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES (
    CASE WHEN p_decision = 'approved' THEN 'Invoice Approved' ELSE 'Invoice Rejected' END,
    'invoices', p_invoice_id, v_user_id, v_tenant_id,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', v_note, 'self_approved', v_self)
  );

  RETURN jsonb_build_object('ok', true, 'status', p_decision, 'self_approved', v_self);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) TO authenticated;

-- ── Notify eligible approvers when an invoice becomes pending ─────────
CREATE OR REPLACE FUNCTION public.notify_invoice_approvers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'pending') THEN
    INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
    SELECT NEW.tenant_id, e.user_id, 'warning', 'Invoice needs approval',
           'Invoice ' || NEW.invoice_number || ' needs your approval before it can be posted.',
           '/sales/invoices'
    FROM public.eligible_invoice_approvers(NEW.tenant_id) e
    WHERE e.user_id <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_invoice_approvers ON public.invoices;
CREATE TRIGGER trg_notify_invoice_approvers
  AFTER INSERT OR UPDATE OF approval_status, total_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_approvers();
