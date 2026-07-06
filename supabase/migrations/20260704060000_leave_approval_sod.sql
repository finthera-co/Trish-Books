-- ═══════════════════════════════════════════════════════════════════════════
-- LEAVE APPROVAL — SEGREGATION OF DUTIES (admins & primary admins)
-- Every tenant user (incl. Primary Admin) now has an employee profile and can
-- request leave from /me. Approval routing ("four-eyes" principle):
--
--   • Employees            → approved by any tenant admin (unchanged).
--   • Admin's own request  → must be approved by ANOTHER active admin;
--                            self-approval is blocked in the RPC.
--   • Sole-admin tenant    → no peer exists, so the admin may approve their
--                            own request (fully audited via approved_by;
--                            returned as self_approved for the UI).
--
-- Also adds notifications:
--   • new pending request → all tenant admins except the requester
--   • approve / reject    → the requester (link to /me/leave)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Approve (reserve) — now with SoD guard + requester notification ──────
CREATE OR REPLACE FUNCTION public.approve_leave_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid; v_tenant uuid; v_role text;
  v_req public.leave_requests%ROWTYPE;
  v_bal_id uuid; v_available numeric; v_allow_neg boolean; v_year int; v_overlap int;
  v_owner_user uuid; v_other_admins int; v_self boolean := false;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := public.get_user_role_name();
  IF v_role NOT IN ('Primary Admin','Company Admin','Super Admin') THEN
    RAISE EXCEPTION 'Not authorized to approve leave';
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be approved (current: %)', v_req.status; END IF;

  -- Segregation of duties: an admin may not approve their own leave while
  -- another active admin exists. A sole admin may (audited via approved_by).
  SELECT user_id INTO v_owner_user FROM public.employees WHERE id = v_req.employee_id;
  IF v_owner_user IS NOT NULL AND v_owner_user = v_user THEN
    SELECT COUNT(*) INTO v_other_admins
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE u.tenant_id = v_tenant AND u.id <> v_user
      AND r.role_name IN ('Primary Admin','Company Admin')
      AND lower(COALESCE(u.status,'active')) = 'active';
    IF v_other_admins > 0 THEN
      RAISE EXCEPTION 'You cannot approve your own leave request — another administrator must review it';
    END IF;
    v_self := true;
  END IF;

  SELECT COUNT(*) INTO v_overlap FROM public.leave_requests r
    WHERE r.employee_id = v_req.employee_id AND r.id <> v_req.id
      AND r.status IN ('approved','settled')
      AND r.start_date <= v_req.end_date AND r.end_date >= v_req.start_date;
  IF v_overlap > 0 THEN RAISE EXCEPTION 'Employee already has approved leave overlapping these dates'; END IF;

  v_year := EXTRACT(YEAR FROM v_req.start_date);
  v_bal_id := public.ensure_leave_balance(v_tenant, v_req.employee_id, v_req.leave_type_id, v_year);
  SELECT allow_negative_balance INTO v_allow_neg FROM public.leave_types WHERE id = v_req.leave_type_id;

  SELECT available INTO v_available FROM public.leave_balances WHERE id = v_bal_id FOR UPDATE;
  IF NOT COALESCE(v_allow_neg,false) AND v_available < v_req.days THEN
    RAISE EXCEPTION 'Insufficient balance: % available, % requested', v_available, v_req.days;
  END IF;

  UPDATE public.leave_balances SET reserved = reserved + v_req.days WHERE id = v_bal_id;
  UPDATE public.leave_requests SET status='approved', approved_by=v_user, approved_at=now() WHERE id = p_request_id;

  -- Tell the requester (skip when self-approved — they already know)
  IF v_owner_user IS NOT NULL AND v_owner_user <> v_user THEN
    INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
    VALUES (v_tenant, v_owner_user, 'success', 'Leave approved',
            'Your leave request for ' || v_req.start_date ||
            CASE WHEN v_req.end_date <> v_req.start_date THEN ' → ' || v_req.end_date ELSE '' END ||
            ' was approved.', '/me/leave');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status','approved', 'days', v_req.days,
                            'available_after', v_available - v_req.days, 'self_approved', v_self);
END; $$;

-- ── 2. Reject — same SoD guard + requester notification ─────────────────────
CREATE OR REPLACE FUNCTION public.reject_leave_request(p_request_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid; v_tenant uuid; v_role text;
  v_req public.leave_requests%ROWTYPE;
  v_owner_user uuid; v_other_admins int;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := public.get_user_role_name();
  IF v_role NOT IN ('Primary Admin','Company Admin','Super Admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be rejected'; END IF;

  SELECT user_id INTO v_owner_user FROM public.employees WHERE id = v_req.employee_id;
  IF v_owner_user IS NOT NULL AND v_owner_user = v_user THEN
    SELECT COUNT(*) INTO v_other_admins
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE u.tenant_id = v_tenant AND u.id <> v_user
      AND r.role_name IN ('Primary Admin','Company Admin')
      AND lower(COALESCE(u.status,'active')) = 'active';
    IF v_other_admins > 0 THEN
      RAISE EXCEPTION 'You cannot reject your own leave request — cancel it instead';
    END IF;
  END IF;

  UPDATE public.leave_requests SET status='rejected', rejected_by=v_user, rejected_at=now(),
    rejection_reason=p_reason WHERE id = p_request_id;

  IF v_owner_user IS NOT NULL AND v_owner_user <> v_user THEN
    INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
    VALUES (v_tenant, v_owner_user, 'warning', 'Leave rejected',
            'Your leave request for ' || v_req.start_date ||
            CASE WHEN v_req.end_date <> v_req.start_date THEN ' → ' || v_req.end_date ELSE '' END ||
            ' was rejected: ' || COALESCE(p_reason,'no reason given'), '/me/leave');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status','rejected');
END; $$;

-- ── 3. Notify approvers when a request is submitted ─────────────────────────
CREATE OR REPLACE FUNCTION public.notify_leave_request_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp record;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT first_name, last_name, user_id INTO v_emp FROM public.employees WHERE id = NEW.employee_id;
  INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
  SELECT NEW.tenant_id, u.id, 'info', 'Leave request pending approval',
         trim(COALESCE(v_emp.first_name,'') || ' ' || COALESCE(v_emp.last_name,'')) ||
         ' requested leave for ' || NEW.start_date ||
         CASE WHEN NEW.end_date <> NEW.start_date THEN ' → ' || NEW.end_date ELSE '' END || '.',
         '/payroll/leave'
  FROM public.users u JOIN public.roles r ON r.id = u.role_id
  WHERE u.tenant_id = NEW.tenant_id
    AND r.role_name IN ('Primary Admin','Company Admin')
    AND lower(COALESCE(u.status,'active')) = 'active'
    AND u.id IS DISTINCT FROM v_emp.user_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_leave_request_submitted ON public.leave_requests;
CREATE TRIGGER trg_notify_leave_request_submitted
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_leave_request_submitted();
