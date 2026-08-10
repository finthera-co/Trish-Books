-- ─────────────────────────────────────────────────────────────────────────────
-- Sequential invoice approval chains + request-changes + comments
--
-- Supersedes the flat "N distinct approvers" tier model with an ordered chain:
--
--   account_settings.invoice_approval_workflow =
--     [{"name":"Sales Manager","min_amount":0,      "approver_ids":[…],"required_approvals":1},
--      {"name":"Finance",      "min_amount":500000, "approver_ids":[…],"required_approvals":1},
--      {"name":"CFO",          "min_amount":2000000,"approver_ids":[…],"required_approvals":2}]
--
--   • A step applies only when the invoice BASE total reaches its min_amount, so
--     the chain gets longer as the invoice gets bigger.
--   • Steps open one at a time. Level 2 only accepts sign-offs once level 1 has
--     collected its required_approvals from DISTINCT eligible approvers.
--   • A step with no approver_ids falls back to the tenant-level appointed
--     approvers (account_settings.invoice_approver_ids), then to the owners.
--   • Optional: invoice_approval_require_distinct forbids one person signing two
--     different levels of the same invoice.
--   • Tenants with no workflow keep working on the legacy tiers/threshold, which
--     are read as a single-step chain.
--
-- New decisions besides approve/reject:
--   • changes_requested — sends the invoice back to its creator (editable, not
--     postable) instead of killing it. resubmit_invoice() restarts the chain.
--   • comment          — a discussion thread on the approval, in the same
--     append-only history table as the decisions.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Settings ─────────────────────────────────────────────────────────
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS invoice_approval_workflow        JSONB,
  ADD COLUMN IF NOT EXISTS invoice_approval_require_distinct BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.account_settings.invoice_approval_workflow IS
  'Ordered approval chain: [{name, min_amount, approver_ids[], required_approvals}]. Null/empty falls back to invoice_approval_tiers.';
COMMENT ON COLUMN public.account_settings.invoice_approval_require_distinct IS
  'When true, a user who signed one level of an invoice cannot sign another level of the same invoice.';

-- ── Invoice state ────────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS approval_step        INTEGER NOT NULL DEFAULT 0,  -- 1-based open level (0 = none)
  ADD COLUMN IF NOT EXISTS approval_steps_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_step_name   TEXT;

-- approval_status gains 'changes_requested'.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%approval_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_approval_status_check
  CHECK (approval_status IN ('not_required','pending','approved','rejected','changes_requested'));

-- ── History gains step context + the new event types ─────────────────
ALTER TABLE public.invoice_approval_history
  ADD COLUMN IF NOT EXISTS step_index INTEGER,
  ADD COLUMN IF NOT EXISTS step_name  TEXT;

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.invoice_approval_history'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.invoice_approval_history DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.invoice_approval_history
  ADD CONSTRAINT invoice_approval_history_action_check
  CHECK (action IN ('submitted','approved','rejected','changes_requested','resubmitted','comment'));

-- ─────────────────────────────────────────────────────────────────────
-- invoice_approval_plan() — the chain that applies to a given base total
-- Returns [] when no approval is needed.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoice_approval_plan(p_tenant_id UUID, p_base NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wf        JSONB;
  v_tiers     JSONB;
  v_threshold NUMERIC;
  v_appointed UUID[];
  v_steps     JSONB := '[]'::jsonb;
  v_step      JSONB;
  v_idx       INTEGER := 0;
  v_req       INTEGER;
BEGIN
  SELECT invoice_approval_workflow, invoice_approval_tiers, invoice_approval_threshold, invoice_approver_ids
    INTO v_wf, v_tiers, v_threshold, v_appointed
  FROM public.account_settings WHERE tenant_id = p_tenant_id;

  -- Chain mode.
  IF v_wf IS NOT NULL AND jsonb_typeof(v_wf) = 'array' AND jsonb_array_length(v_wf) > 0 THEN
    FOR v_step IN SELECT value FROM jsonb_array_elements(v_wf) LOOP
      IF p_base >= COALESCE(NULLIF(v_step->>'min_amount','')::numeric, 0) THEN
        v_idx := v_idx + 1;
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'index',              v_idx,
          'name',               COALESCE(NULLIF(btrim(COALESCE(v_step->>'name','')), ''), 'Level ' || v_idx),
          'required_approvals', GREATEST(COALESCE(NULLIF(v_step->>'required_approvals','')::int, 1), 1),
          'approver_ids',       CASE WHEN jsonb_typeof(v_step->'approver_ids') = 'array'
                                     THEN v_step->'approver_ids' ELSE '[]'::jsonb END,
          'min_amount',         COALESCE(NULLIF(v_step->>'min_amount','')::numeric, 0)
        ));
      END IF;
    END LOOP;
    RETURN v_steps;
  END IF;

  -- Legacy tiers/threshold → a single step.
  SELECT COALESCE(MAX((t->>'required_approvals')::int), 0) INTO v_req
  FROM jsonb_array_elements(COALESCE(v_tiers, '[]'::jsonb)) t
  WHERE p_base >= (t->>'min_amount')::numeric;

  IF v_req = 0 AND v_threshold IS NOT NULL AND v_threshold > 0 AND p_base >= v_threshold THEN
    v_req := 1;
  END IF;
  IF v_req = 0 THEN RETURN '[]'::jsonb; END IF;

  RETURN jsonb_build_array(jsonb_build_object(
    'index', 1, 'name', 'Approval', 'required_approvals', v_req, 'min_amount', 0,
    'approver_ids', CASE WHEN v_appointed IS NULL THEN '[]'::jsonb ELSE to_jsonb(v_appointed) END
  ));
END;
$$;
GRANT EXECUTE ON FUNCTION public.invoice_approval_plan(UUID, NUMERIC) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- eligible_step_approvers() — who may sign one particular level
-- Named approvers if the step lists any, otherwise the tenant-level fallback.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eligible_step_approvers(p_tenant_id UUID, p_step JSONB)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH named AS (
    SELECT (jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(p_step->'approver_ids') = 'array'
                   THEN p_step->'approver_ids' ELSE '[]'::jsonb END))::uuid AS id
  )
  SELECT u.id
  FROM public.users u
  JOIN named n ON n.id = u.id
  WHERE u.tenant_id = p_tenant_id
  UNION
  SELECT e.user_id
  FROM public.eligible_invoice_approvers(p_tenant_id) e
  WHERE NOT EXISTS (SELECT 1 FROM named);
$$;
GRANT EXECUTE ON FUNCTION public.eligible_step_approvers(UUID, JSONB) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Reassessment: an amount change rebuilds the chain and restarts it at level 1
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_invoice_approval_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_base NUMERIC;
  v_plan JSONB;
  v_n    INTEGER;
BEGIN
  v_base := NEW.total_amount * COALESCE(NEW.exchange_rate, 1);
  v_plan := public.invoice_approval_plan(NEW.tenant_id, v_base);
  v_n    := jsonb_array_length(v_plan);

  IF v_n > 0 THEN
    NEW.approval_status       := 'pending';
    NEW.approval_step         := 1;
    NEW.approval_steps_total  := v_n;
    NEW.approval_step_name    := v_plan->0->>'name';
    NEW.required_approvals    := (v_plan->0->>'required_approvals')::int;
  ELSE
    NEW.approval_status       := 'not_required';
    NEW.approval_step         := 0;
    NEW.approval_steps_total  := 0;
    NEW.approval_step_name    := NULL;
    NEW.required_approvals    := 0;
  END IF;

  -- Any (re)evaluation voids prior sign-offs: never carry approver identity
  -- across an amount change.
  NEW.approvals_count := 0;
  NEW.approved_by     := NULL;
  NEW.approved_at     := NULL;
  NEW.approval_note   := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_approval ON public.invoices;
CREATE TRIGGER trg_invoice_approval
  BEFORE INSERT OR UPDATE OF total_amount, exchange_rate ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_approval_status();

-- ─────────────────────────────────────────────────────────────────────
-- Tamper guard — step/counter columns join the protected set
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_invoice_approval_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable' USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by)
     OR (NEW.approval_status IS DISTINCT FROM OLD.approval_status
         AND NEW.approval_status IN ('approved','rejected','changes_requested'))
     OR NEW.approval_step    IS DISTINCT FROM OLD.approval_step
     OR NEW.approvals_count  IS DISTINCT FROM OLD.approvals_count THEN
    IF current_setting('app.invoice_approving', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'approval state can only be changed via approve_invoice()/resubmit_invoice()'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_guard_invoice_approval ON public.invoices;
CREATE TRIGGER a_guard_invoice_approval
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_approval_columns();

-- ─────────────────────────────────────────────────────────────────────
-- Notify the approvers of the currently open level
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_invoice_step_approvers(
  p_invoice public.invoices,
  p_step    JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
  SELECT p_invoice.tenant_id, e.user_id, 'warning', 'Invoice needs your approval',
         'Invoice ' || p_invoice.invoice_number || ' is at ' || (p_step->>'name') ||
         ' (level ' || (p_step->>'index') || ' of ' || p_invoice.approval_steps_total || ') and needs ' ||
         (p_step->>'required_approvals') || ' sign-off' ||
         CASE WHEN (p_step->>'required_approvals')::int > 1 THEN 's' ELSE '' END || '.',
         '/sales/approvals'
  FROM public.eligible_step_approvers(p_invoice.tenant_id, p_step) e
  WHERE e.user_id <> COALESCE(p_invoice.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
END;
$$;

-- Decisions travel back to whoever raised the invoice.
CREATE OR REPLACE FUNCTION public.notify_invoice_creator(
  p_invoice public.invoices,
  p_type    TEXT,
  p_title   TEXT,
  p_message TEXT,
  p_actor   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_invoice.created_by IS NULL OR p_invoice.created_by = p_actor THEN RETURN; END IF;
  INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
  VALUES (p_invoice.tenant_id, p_invoice.created_by, p_type, p_title, p_message, '/sales/approvals');
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_invoice_approvers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan JSONB;
BEGIN
  -- approve_invoice()/resubmit_invoice() log and notify for themselves; this
  -- trigger only covers ordinary writes (raising or editing an invoice).
  IF current_setting('app.invoice_approving', true) IS NOT DISTINCT FROM '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status = 'pending'
     AND (TG_OP = 'INSERT'
          OR OLD.approval_status IS DISTINCT FROM NEW.approval_status
          OR OLD.total_amount   IS DISTINCT FROM NEW.total_amount
          OR OLD.exchange_rate  IS DISTINCT FROM NEW.exchange_rate) THEN

    v_plan := public.invoice_approval_plan(NEW.tenant_id, NEW.total_amount * COALESCE(NEW.exchange_rate, 1));
    IF jsonb_array_length(v_plan) = 0 THEN RETURN NEW; END IF;

    -- Round marker: sign-offs are counted only after the latest submission.
    INSERT INTO public.invoice_approval_history
      (tenant_id, invoice_id, actor_id, action, note, amount_base, step_index, step_name)
    VALUES (NEW.tenant_id, NEW.id, NEW.created_by, 'submitted', NULL,
            NEW.total_amount * COALESCE(NEW.exchange_rate, 1), 1, v_plan->0->>'name');

    PERFORM public.notify_invoice_step_approvers(NEW, v_plan->0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_invoice_approvers ON public.invoices;
CREATE TRIGGER trg_notify_invoice_approvers
  AFTER INSERT OR UPDATE OF approval_status, total_amount, exchange_rate ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_approvers();

-- ─────────────────────────────────────────────────────────────────────
-- approve_invoice(p_decision ∈ approved | rejected | changes_requested)
-- ─────────────────────────────────────────────────────────────────────
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
  v_user_id    UUID;
  v_tenant_id  UUID;
  v_inv        public.invoices;
  v_plan       JSONB;
  v_n          INTEGER;
  v_idx        INTEGER;
  v_step       JSONB;
  v_next       JSONB;
  v_eligible_n INTEGER;
  v_is_elig    BOOLEAN;
  v_distinct   BOOLEAN;
  v_self       BOOLEAN;
  v_note       TEXT;
  v_base       NUMERIC;
  v_round      TIMESTAMPTZ;
  v_collected  INTEGER;
  v_required   INTEGER;
  v_step_done  BOOLEAN;
  v_final      BOOLEAN;
BEGIN
  SELECT u.id, u.tenant_id INTO v_user_id, v_tenant_id
  FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF p_decision NOT IN ('approved','rejected','changes_requested') THEN
    RAISE EXCEPTION 'BAD_DECISION';
  END IF;
  IF p_decision <> 'approved' AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a reason is required to reject or request changes'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND tenant_id = v_tenant_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_inv.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_PENDING: invoice is %', v_inv.approval_status USING ERRCODE = 'P0001';
  END IF;

  v_base := v_inv.total_amount * COALESCE(v_inv.exchange_rate, 1);
  v_plan := public.invoice_approval_plan(v_tenant_id, v_base);
  v_n    := jsonb_array_length(v_plan);

  -- The workflow was switched off (or relaxed) after this invoice was submitted.
  IF v_n = 0 THEN
    PERFORM set_config('app.invoice_approving', '1', true);
    UPDATE public.invoices
       SET approval_status = 'not_required', approval_step = 0, approval_steps_total = 0,
           approval_step_name = NULL, required_approvals = 0, approvals_count = 0
     WHERE id = p_invoice_id;
    RETURN jsonb_build_object('ok', true, 'status', 'not_required', 'final', true);
  END IF;

  v_idx  := LEAST(GREATEST(v_inv.approval_step, 1), v_n);
  v_step := v_plan->(v_idx - 1);

  -- Routing: only this level's approvers may act on it.
  SELECT EXISTS (SELECT 1 FROM public.eligible_step_approvers(v_tenant_id, v_step) e WHERE e.user_id = v_user_id),
         (SELECT count(*) FROM public.eligible_step_approvers(v_tenant_id, v_step))
    INTO v_is_elig, v_eligible_n;
  IF NOT v_is_elig THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER: you are not an approver for % (level % of %)',
      v_step->>'name', v_idx, v_n USING ERRCODE = 'P0001';
  END IF;

  -- Segregation of duties, with the sole-approver escape hatch.
  v_self := v_inv.created_by IS NOT NULL AND v_inv.created_by = v_user_id;
  IF v_self AND v_eligible_n > 1 THEN
    RAISE EXCEPTION 'SEGREGATION_OF_DUTIES: the approver cannot be the invoice creator'
      USING ERRCODE = 'P0001';
  END IF;

  v_note := CASE WHEN v_self AND p_decision = 'approved'
                 THEN COALESCE(p_note || ' ', '') || '[self-approved: sole eligible approver]'
                 ELSE p_note END;

  PERFORM set_config('app.invoice_approving', '1', true);

  -- ── Rejected: terminal for this round ──
  IF p_decision = 'rejected' THEN
    UPDATE public.invoices
       SET approval_status = 'rejected', approved_by = v_user_id, approved_at = now(), approval_note = v_note
     WHERE id = p_invoice_id;

    INSERT INTO public.invoice_approval_history
      (tenant_id, invoice_id, actor_id, action, note, amount_base, step_index, step_name)
    VALUES (v_tenant_id, p_invoice_id, v_user_id, 'rejected', v_note, v_base, v_idx, v_step->>'name');

    PERFORM public.notify_invoice_creator(v_inv, 'error', 'Invoice rejected',
      'Invoice ' || v_inv.invoice_number || ' was rejected at ' || (v_step->>'name') || ': ' || v_note, v_user_id);

    INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
    VALUES ('Invoice Rejected', 'invoices', p_invoice_id, v_user_id, v_tenant_id,
            jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', v_note,
                               'step', v_idx, 'step_name', v_step->>'name'));
    RETURN jsonb_build_object('ok', true, 'status', 'rejected', 'final', true);
  END IF;

  -- ── Changes requested: back to the creator, chain paused ──
  IF p_decision = 'changes_requested' THEN
    UPDATE public.invoices
       SET approval_status = 'changes_requested', approval_note = v_note
     WHERE id = p_invoice_id;

    INSERT INTO public.invoice_approval_history
      (tenant_id, invoice_id, actor_id, action, note, amount_base, step_index, step_name)
    VALUES (v_tenant_id, p_invoice_id, v_user_id, 'changes_requested', v_note, v_base, v_idx, v_step->>'name');

    PERFORM public.notify_invoice_creator(v_inv, 'warning', 'Changes requested',
      'Invoice ' || v_inv.invoice_number || ' was sent back at ' || (v_step->>'name') || ': ' || v_note, v_user_id);

    INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
    VALUES ('Invoice Changes Requested', 'invoices', p_invoice_id, v_user_id, v_tenant_id,
            jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', v_note,
                               'step', v_idx, 'step_name', v_step->>'name'));
    RETURN jsonb_build_object('ok', true, 'status', 'changes_requested', 'final', false);
  END IF;

  -- ── Approved: collect distinct sign-offs for THIS level ──
  SELECT max(created_at) INTO v_round
  FROM public.invoice_approval_history
  WHERE invoice_id = p_invoice_id AND action IN ('submitted','resubmitted');

  IF EXISTS (
    SELECT 1 FROM public.invoice_approval_history
    WHERE invoice_id = p_invoice_id AND action = 'approved' AND actor_id = v_user_id
      AND step_index = v_idx AND (v_round IS NULL OR created_at >= v_round)
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED: you have already approved this level' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(invoice_approval_require_distinct, false) INTO v_distinct
  FROM public.account_settings WHERE tenant_id = v_tenant_id;

  IF COALESCE(v_distinct, false) AND EXISTS (
    SELECT 1 FROM public.invoice_approval_history
    WHERE invoice_id = p_invoice_id AND action = 'approved' AND actor_id = v_user_id
      AND step_index IS DISTINCT FROM v_idx AND (v_round IS NULL OR created_at >= v_round)
  ) THEN
    RAISE EXCEPTION 'DISTINCT_APPROVERS_REQUIRED: you already signed another level of this invoice'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.invoice_approval_history
    (tenant_id, invoice_id, actor_id, action, note, amount_base, step_index, step_name)
  VALUES (v_tenant_id, p_invoice_id, v_user_id, 'approved', v_note, v_base, v_idx, v_step->>'name');

  SELECT count(DISTINCT actor_id) INTO v_collected
  FROM public.invoice_approval_history
  WHERE invoice_id = p_invoice_id AND action = 'approved' AND step_index = v_idx
    AND (v_round IS NULL OR created_at >= v_round);

  v_required  := GREATEST(COALESCE((v_step->>'required_approvals')::int, 1), 1);
  v_step_done := v_collected >= v_required;
  v_final     := v_step_done AND v_idx >= v_n;

  IF v_final THEN
    UPDATE public.invoices
       SET approval_status = 'approved', approved_by = v_user_id, approved_at = now(),
           approval_note = v_note, approvals_count = v_collected,
           approval_step = v_idx, approval_steps_total = v_n, approval_step_name = v_step->>'name'
     WHERE id = p_invoice_id;

    PERFORM public.notify_invoice_creator(v_inv, 'success', 'Invoice approved',
      'Invoice ' || v_inv.invoice_number || ' cleared every approval level and can now be posted.', v_user_id);

  ELSIF v_step_done THEN
    v_next := v_plan->v_idx;   -- 0-based: the step after v_idx
    UPDATE public.invoices
       SET approval_step        = v_idx + 1,
           approval_steps_total = v_n,
           approval_step_name   = v_next->>'name',
           required_approvals   = GREATEST(COALESCE((v_next->>'required_approvals')::int, 1), 1),
           approvals_count      = 0
     WHERE id = p_invoice_id
     RETURNING * INTO v_inv;

    PERFORM public.notify_invoice_step_approvers(v_inv, v_next);

  ELSE
    UPDATE public.invoices
       SET approvals_count = v_collected, approval_steps_total = v_n,
           required_approvals = v_required, approval_step_name = v_step->>'name'
     WHERE id = p_invoice_id;
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES ('Invoice Approved', 'invoices', p_invoice_id, v_user_id, v_tenant_id,
          jsonb_build_object('invoice_number', v_inv.invoice_number, 'step', v_idx,
                             'step_name', v_step->>'name', 'collected', v_collected,
                             'required', v_required, 'step_complete', v_step_done,
                             'final', v_final, 'self_approved', v_self));

  RETURN jsonb_build_object(
    'ok', true,
    'status',        CASE WHEN v_final THEN 'approved' ELSE 'pending' END,
    'collected',     v_collected,
    'required',      v_required,
    'step',          v_idx,
    'steps_total',   v_n,
    'step_name',     v_step->>'name',
    'step_complete', v_step_done,
    'next_step',     CASE WHEN v_step_done AND NOT v_final THEN v_plan->v_idx->>'name' ELSE NULL END,
    'final',         v_final
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_invoice(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- resubmit_invoice() — creator sends a sent-back/rejected invoice round again
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resubmit_invoice(
  p_invoice_id UUID,
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
  v_base      NUMERIC;
  v_plan      JSONB;
  v_n         INTEGER;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
  FROM public.users u LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND tenant_id = v_tenant_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_inv.approval_status NOT IN ('changes_requested','rejected') THEN
    RAISE EXCEPTION 'NOT_RESUBMITTABLE: invoice is %', v_inv.approval_status USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'NOT_RESUBMITTABLE: only draft invoices can be resubmitted' USING ERRCODE = 'P0001';
  END IF;

  -- The raiser, an admin, or anyone eligible to approve it may put it back in play.
  IF v_inv.created_by IS DISTINCT FROM v_user_id
     AND COALESCE(v_role, '') NOT IN ('Super Admin','Primary Admin','Company Admin')
     AND NOT EXISTS (SELECT 1 FROM public.eligible_invoice_approvers(v_tenant_id) e WHERE e.user_id = v_user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only the invoice creator or an admin can resubmit' USING ERRCODE = 'P0001';
  END IF;

  v_base := v_inv.total_amount * COALESCE(v_inv.exchange_rate, 1);
  v_plan := public.invoice_approval_plan(v_tenant_id, v_base);
  v_n    := jsonb_array_length(v_plan);

  PERFORM set_config('app.invoice_approving', '1', true);

  IF v_n = 0 THEN
    UPDATE public.invoices
       SET approval_status = 'not_required', approval_step = 0, approval_steps_total = 0,
           approval_step_name = NULL, required_approvals = 0, approvals_count = 0,
           approved_by = NULL, approved_at = NULL, approval_note = NULL
     WHERE id = p_invoice_id;
    RETURN jsonb_build_object('ok', true, 'status', 'not_required');
  END IF;

  UPDATE public.invoices
     SET approval_status      = 'pending',
         approval_step        = 1,
         approval_steps_total = v_n,
         approval_step_name   = v_plan->0->>'name',
         required_approvals   = GREATEST(COALESCE((v_plan->0->>'required_approvals')::int, 1), 1),
         approvals_count      = 0,
         approved_by          = NULL,
         approved_at          = NULL,
         approval_note        = NULL
   WHERE id = p_invoice_id
   RETURNING * INTO v_inv;

  -- Marks a fresh round: earlier sign-offs no longer count.
  INSERT INTO public.invoice_approval_history
    (tenant_id, invoice_id, actor_id, action, note, amount_base, step_index, step_name)
  VALUES (v_tenant_id, p_invoice_id, v_user_id, 'resubmitted', NULLIF(btrim(COALESCE(p_note,'')), ''),
          v_base, 1, v_plan->0->>'name');

  PERFORM public.notify_invoice_step_approvers(v_inv, v_plan->0);

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES ('Invoice Resubmitted', 'invoices', p_invoice_id, v_user_id, v_tenant_id,
          jsonb_build_object('invoice_number', v_inv.invoice_number, 'note', p_note, 'steps', v_n));

  RETURN jsonb_build_object('ok', true, 'status', 'pending', 'steps_total', v_n,
                            'step_name', v_plan->0->>'name');
END;
$$;
REVOKE ALL ON FUNCTION public.resubmit_invoice(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.resubmit_invoice(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- add_invoice_approval_comment() — discussion on the approval, same trail
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_invoice_approval_comment(
  p_invoice_id UUID,
  p_note       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_tenant_id UUID;
  v_inv       public.invoices;
  v_plan      JSONB;
  v_idx       INTEGER;
  v_step      JSONB;
  v_name      TEXT;
BEGIN
  SELECT u.id, u.tenant_id INTO v_user_id, v_tenant_id
  FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'EMPTY_COMMENT: write something first' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND tenant_id = v_tenant_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  v_plan := public.invoice_approval_plan(v_tenant_id, v_inv.total_amount * COALESCE(v_inv.exchange_rate, 1));
  v_idx  := NULLIF(v_inv.approval_step, 0);
  IF v_idx IS NOT NULL AND jsonb_array_length(v_plan) >= v_idx THEN
    v_step := v_plan->(v_idx - 1);
  END IF;

  INSERT INTO public.invoice_approval_history
    (tenant_id, invoice_id, actor_id, action, note, amount_base, step_index, step_name)
  VALUES (v_tenant_id, p_invoice_id, v_user_id, 'comment', btrim(p_note),
          v_inv.total_amount * COALESCE(v_inv.exchange_rate, 1), v_idx, v_step->>'name');

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email)
    INTO v_name FROM public.users WHERE id = v_user_id;

  -- Everyone with a stake in this approval hears about it: the raiser and the
  -- approvers of the open level.
  INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
  SELECT v_tenant_id, t.user_id, 'info', 'New comment on invoice ' || v_inv.invoice_number,
         COALESCE(v_name, 'Someone') || ': ' || btrim(p_note), '/sales/approvals'
  FROM (
    SELECT e.user_id FROM public.eligible_step_approvers(v_tenant_id, COALESCE(v_step, '{}'::jsonb)) e
    WHERE v_step IS NOT NULL
    UNION
    SELECT v_inv.created_by WHERE v_inv.created_by IS NOT NULL
  ) t
  WHERE t.user_id IS DISTINCT FROM v_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.add_invoice_approval_comment(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.add_invoice_approval_comment(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- invoice_approval_queue() — the inbox, with per-row "can I act on this?"
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoice_approval_queue()
RETURNS TABLE (
  id                   UUID,
  invoice_number       TEXT,
  customer_name        TEXT,
  total_amount         NUMERIC,
  currency             TEXT,
  base_amount          NUMERIC,
  issue_date           DATE,
  due_date             DATE,
  approval_status      TEXT,
  approval_step        INTEGER,
  approval_steps_total INTEGER,
  step_name            TEXT,
  required_approvals   INTEGER,
  approvals_count      INTEGER,
  created_at           TIMESTAMPTZ,
  created_by_name      TEXT,
  is_mine              BOOLEAN,
  can_act              BOOLEAN,
  already_approved     BOOLEAN,
  block_reason         TEXT,
  waiting_on           TEXT[],
  last_event_at        TIMESTAMPTZ,
  comment_count        INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_tenant_id UUID;
  v_rec       RECORD;
  v_plan      JSONB;
  v_n         INTEGER;
  v_idx       INTEGER;
  v_step      JSONB;
  v_elig_n    INTEGER;
  v_is_elig   BOOLEAN;
  v_round     TIMESTAMPTZ;
  v_distinct  BOOLEAN;
BEGIN
  SELECT u.id, u.tenant_id INTO v_user_id, v_tenant_id
  FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(invoice_approval_require_distinct, false) INTO v_distinct
  FROM public.account_settings WHERE tenant_id = v_tenant_id;

  FOR v_rec IN
    SELECT i.*, c.name AS cust_name,
           COALESCE(NULLIF(btrim(COALESCE(cu.first_name,'') || ' ' || COALESCE(cu.last_name,'')), ''), cu.email) AS raiser
    FROM public.invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    LEFT JOIN public.users cu    ON cu.id = i.created_by
    WHERE i.tenant_id = v_tenant_id
      AND i.approval_status IN ('pending','changes_requested','rejected')
    ORDER BY i.created_at DESC
  LOOP
    id                   := v_rec.id;
    invoice_number       := v_rec.invoice_number;
    customer_name        := v_rec.cust_name;
    total_amount         := v_rec.total_amount;
    currency             := v_rec.currency;
    base_amount          := v_rec.total_amount * COALESCE(v_rec.exchange_rate, 1);
    issue_date           := v_rec.issue_date;
    due_date             := v_rec.due_date;
    approval_status      := v_rec.approval_status;
    approval_steps_total := v_rec.approval_steps_total;
    approvals_count      := v_rec.approvals_count;
    created_at           := v_rec.created_at;
    created_by_name      := v_rec.raiser;
    is_mine              := v_rec.created_by IS NOT DISTINCT FROM v_user_id;

    v_plan := public.invoice_approval_plan(v_tenant_id, base_amount);
    v_n    := jsonb_array_length(v_plan);
    v_idx  := CASE WHEN v_n = 0 THEN 0 ELSE LEAST(GREATEST(v_rec.approval_step, 1), v_n) END;
    v_step := CASE WHEN v_idx = 0 THEN NULL ELSE v_plan->(v_idx - 1) END;

    approval_step        := v_idx;
    step_name            := COALESCE(v_step->>'name', v_rec.approval_step_name);
    required_approvals   := COALESCE(NULLIF(v_step->>'required_approvals','')::int, v_rec.required_approvals);
    IF v_n > 0 THEN approval_steps_total := v_n; END IF;

    SELECT max(h.created_at), count(*) FILTER (WHERE h.action = 'comment')
      INTO last_event_at, comment_count
    FROM public.invoice_approval_history h WHERE h.invoice_id = v_rec.id;
    comment_count := COALESCE(comment_count, 0);

    SELECT max(h.created_at) INTO v_round
    FROM public.invoice_approval_history h
    WHERE h.invoice_id = v_rec.id AND h.action IN ('submitted','resubmitted');

    IF v_step IS NULL THEN
      waiting_on := ARRAY[]::TEXT[];
      v_is_elig  := false;
      v_elig_n   := 0;
    ELSE
      SELECT array_agg(COALESCE(NULLIF(btrim(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.email)
                       ORDER BY u.first_name NULLS LAST),
             count(*),
             bool_or(u.id = v_user_id)
        INTO waiting_on, v_elig_n, v_is_elig
      FROM public.eligible_step_approvers(v_tenant_id, v_step) e
      JOIN public.users u ON u.id = e.user_id;
      waiting_on := COALESCE(waiting_on, ARRAY[]::TEXT[]);
      v_is_elig  := COALESCE(v_is_elig, false);
    END IF;

    already_approved := EXISTS (
      SELECT 1 FROM public.invoice_approval_history h
      WHERE h.invoice_id = v_rec.id AND h.action = 'approved' AND h.actor_id = v_user_id
        AND h.step_index = v_idx AND (v_round IS NULL OR h.created_at >= v_round)
    );

    -- Mirror approve_invoice()'s gate so the UI never offers a button the RPC
    -- would refuse.
    can_act      := false;
    block_reason := NULL;
    IF v_rec.approval_status <> 'pending' THEN
      block_reason := CASE WHEN v_rec.approval_status = 'changes_requested'
                           THEN 'Sent back to ' || COALESCE(v_rec.raiser, 'the raiser')
                           ELSE 'Rejected' END;
    ELSIF NOT v_is_elig THEN
      block_reason := 'Not an approver for ' || COALESCE(step_name, 'this level');
    ELSIF already_approved THEN
      block_reason := 'You already signed this level';
    ELSIF is_mine AND v_elig_n > 1 THEN
      block_reason := 'You raised this invoice';
    ELSIF COALESCE(v_distinct, false) AND EXISTS (
      SELECT 1 FROM public.invoice_approval_history h
      WHERE h.invoice_id = v_rec.id AND h.action = 'approved' AND h.actor_id = v_user_id
        AND h.step_index IS DISTINCT FROM v_idx AND (v_round IS NULL OR h.created_at >= v_round)
    ) THEN
      block_reason := 'You already signed another level';
    ELSE
      can_act := true;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.invoice_approval_queue() TO authenticated;

-- ── Backfill: give existing pending invoices a step position ─────────
-- The tamper guard blocks approval_step writes, so open it for this statement.
DO $$
BEGIN
  PERFORM set_config('app.invoice_approving', '1', true);
  UPDATE public.invoices
     SET approval_step = 1,
         approval_steps_total = GREATEST(approval_steps_total, 1),
         approval_step_name = COALESCE(approval_step_name, 'Approval')
   WHERE approval_status = 'pending' AND approval_step = 0;
END $$;

UPDATE public.invoice_approval_history
   SET step_index = 1, step_name = COALESCE(step_name, 'Approval')
 WHERE step_index IS NULL;
