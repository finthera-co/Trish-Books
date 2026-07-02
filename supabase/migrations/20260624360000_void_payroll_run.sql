-- Void a payroll run correctly: reverse the GL journal entry and restore loan
-- balances. Previously voiding only flipped the status, leaving the posted journal
-- on the books and loan repayments applied.
CREATE OR REPLACE FUNCTION public.rpc_void_payroll_run(p_run_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_role text;
  v_run RECORD; v_rev_je uuid; v_l RECORD; v_rep RECORD; v_loans int := 0;
BEGIN
  SELECT u.id, u.tenant_id INTO v_user, v_tenant FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := public.get_user_role_name();
  IF v_role NOT IN ('Primary Admin','Company Admin','Super Admin') THEN
    RAISE EXCEPTION 'Voiding a payroll run requires a tenant admin role';
  END IF;

  SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_run_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF v_run.status = 'voided' THEN RAISE EXCEPTION 'Run is already voided'; END IF;
  IF v_run.status = 'finalized' THEN RAISE EXCEPTION 'Finalized runs are immutable — cannot void'; END IF;

  -- 1. Reverse the GL journal entry (swap debit/credit), void the original.
  IF v_run.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (tenant_id, entry_date, description, reference, status, posted_at,
      created_by, source_type, source_id, is_system_generated, reversal_of)
    VALUES (v_tenant, CURRENT_DATE, 'Reversal of payroll ' || COALESCE(v_run.run_number,''), v_run.run_number,
      'posted', now(), v_user, 'payroll_void', v_run.id, true, v_run.journal_entry_id)
    RETURNING id INTO v_rev_je;

    FOR v_l IN SELECT account_id, debit, credit FROM public.journal_lines WHERE journal_entry_id = v_run.journal_entry_id LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_rev_je, v_l.account_id, v_l.credit, v_l.debit);
    END LOOP;

    UPDATE public.journal_entries SET status = 'voided', voided_at = now(), voided_by = v_user
      WHERE id = v_run.journal_entry_id;
  END IF;

  -- 2. Restore loan balances and remove this run's repayments.
  FOR v_rep IN SELECT * FROM public.loan_repayments WHERE payroll_run_id = p_run_id LOOP
    UPDATE public.employee_loans
      SET balance = balance + v_rep.amount, status = 'active'
      WHERE id = v_rep.loan_id;
    v_loans := v_loans + 1;
  END LOOP;
  DELETE FROM public.loan_repayments WHERE payroll_run_id = p_run_id;

  -- 3. Mark the run voided.
  UPDATE public.payroll_runs
    SET status = 'voided', notes = COALESCE(notes,'') ||
        CASE WHEN p_reason IS NOT NULL THEN ' [voided: ' || p_reason || ']' ELSE ' [voided]' END
    WHERE id = p_run_id;

  RETURN jsonb_build_object('ok', true, 'reversal_journal_id', v_rev_je, 'loans_restored', v_loans);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_void_payroll_run(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_void_payroll_run(uuid, text) TO authenticated;
