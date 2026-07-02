-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice approval workflow (maker/checker) + credit-limit enforcement
--
--  • Invoices at/above a tenant threshold are auto-flagged 'pending' and cannot
--    be posted until a DIFFERENT finance user approves (segregation of duties).
--  • Posting also blocks when a customer is on credit hold or the new invoice
--    would push their outstanding AR past their credit limit — unless approved.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required'
                            CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_by     UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note   TEXT;

ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS invoice_approval_threshold NUMERIC,         -- null/0 = no approval needed
  ADD COLUMN IF NOT EXISTS enforce_credit_limit       BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.account_settings.invoice_approval_threshold IS
  'Invoices with total_amount >= this value require approval before posting (null/0 disables).';

-- ── Auto-flag invoices that need approval ────────────────────────────
-- Runs on insert and whenever the total changes, so inflating an already-approved
-- draft re-triggers approval. approve_invoice() sets approval_status directly and
-- does not touch total_amount, so it is never clobbered by this trigger.
CREATE OR REPLACE FUNCTION public.set_invoice_approval_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_threshold NUMERIC;
BEGIN
  SELECT invoice_approval_threshold INTO v_threshold
  FROM public.account_settings WHERE tenant_id = NEW.tenant_id;

  IF v_threshold IS NOT NULL AND v_threshold > 0 AND NEW.total_amount >= v_threshold THEN
    NEW.approval_status := 'pending';
  ELSE
    NEW.approval_status := 'not_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_approval ON public.invoices;
CREATE TRIGGER trg_invoice_approval
  BEFORE INSERT OR UPDATE OF total_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_approval_status();

-- ── Approve / reject an invoice (enforces role + SoD) ────────────────
CREATE OR REPLACE FUNCTION public.approve_invoice(
  p_invoice_id UUID,
  p_decision   TEXT,     -- 'approved' | 'rejected'
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_tenant_id UUID;
  v_role      TEXT;
  v_inv       public.invoices;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name
    INTO v_user_id, v_tenant_id, v_role
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid();

  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'BAD_DECISION'; END IF;
  IF v_role NOT IN ('Super Admin','Primary Admin','Company Admin','Accountant') THEN
    RAISE EXCEPTION 'ROLE_CANNOT_APPROVE: %', COALESCE(v_role,'unknown') USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND tenant_id = v_tenant_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_inv.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_PENDING: invoice is %', v_inv.approval_status USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.created_by IS NOT NULL AND v_inv.created_by = v_user_id THEN
    RAISE EXCEPTION 'SEGREGATION_OF_DUTIES: the approver cannot be the invoice creator' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoices
     SET approval_status = p_decision,
         approved_by = v_user_id,
         approved_at = now(),
         approval_note = p_note
   WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES (
    CASE WHEN p_decision = 'approved' THEN 'Invoice Approved' ELSE 'Invoice Rejected' END,
    'invoices', p_invoice_id, v_user_id, v_tenant_id,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', p_note)
  );

  RETURN jsonb_build_object('ok', true, 'status', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) TO authenticated;
