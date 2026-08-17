-- Restore a voided journal entry to posted.
--
-- The reverse of the void path, which is spread across three triggers that only
-- run in one direction:
--   * sync_journal_to_transactions rebuilds the `transactions` feed on the way
--     back to 'posted', so that half is handled for us by the UPDATE below;
--   * recalc_budget_on_je_change only fires on void, so consumption is recomputed
--     here explicitly;
--   * log_audit_event only records 'Journal Voided', so the restore is logged here.
--
-- Re-posting into a closed period would move balances that have been signed off,
-- so that is refused.

CREATE OR REPLACE FUNCTION public.unvoid_journal_entry(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid;
  v_tenant_id   uuid;
  v_role        text;
  v_entry       public.journal_entries%ROWTYPE;
  v_pl_accounts uuid[];
  r             uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'You are not signed in to a company.';
  END IF;

  v_role := public.get_user_role_name();
  IF v_role IS NULL OR v_role NOT IN ('Primary Admin', 'Company Admin', 'Accountant', 'Super Admin') THEN
    RAISE EXCEPTION 'You do not have permission to restore journal entries.';
  END IF;

  SELECT * INTO v_entry FROM public.journal_entries
  WHERE id = p_entry_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found.';
  END IF;

  IF v_entry.status <> 'voided' THEN
    RAISE EXCEPTION 'This entry is not voided.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fiscal_periods
    WHERE tenant_id = v_tenant_id AND status = 'closed'
      AND v_entry.entry_date BETWEEN period_start AND period_end
  ) THEN
    RAISE EXCEPTION 'This entry falls in a closed accounting period and cannot be restored.';
  END IF;

  -- Restoring an entry whose accounts have since been retired would put movement
  -- back onto something the chart no longer allows postings against.
  IF EXISTS (
    SELECT 1 FROM public.journal_lines jl
    JOIN public.accounts a ON a.id = jl.account_id
    WHERE jl.journal_entry_id = p_entry_id
      AND (COALESCE(a.is_active, true) = false OR COALESCE(a.is_postable, true) = false)
  ) THEN
    RAISE EXCEPTION 'This entry posts to an account that is no longer active. Reactivate the account first.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT jl.account_id), '{}')
  INTO v_pl_accounts
  FROM public.journal_lines jl
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = p_entry_id
    AND a.account_type IN ('Expense', 'Cost of Goods Sold', 'Other Expense', 'Income', 'Other Income');

  -- Clears the void record; the sync trigger rebuilds the transactions feed.
  UPDATE public.journal_entries
  SET status      = 'posted',
      voided_at   = NULL,
      voided_by   = NULL,
      void_reason = NULL
  WHERE id = p_entry_id AND tenant_id = v_tenant_id;

  FOREACH r IN ARRAY v_pl_accounts LOOP
    PERFORM public.recalc_budget_consumption(
      v_tenant_id, r,
      public.derive_period(v_entry.entry_date, 'monthly'), 'monthly', NULL, NULL, NULL);
  END LOOP;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES ('Journal Restored', 'journal_entries', p_entry_id, v_user_id, v_tenant_id,
          jsonb_build_object(
            'reference', v_entry.reference,
            'entry_date', v_entry.entry_date,
            'previous_void_reason', v_entry.void_reason,
            'previously_voided_at', v_entry.voided_at));

  RETURN jsonb_build_object('id', p_entry_id, 'reference', v_entry.reference, 'status', 'posted');
END;
$$;

REVOKE ALL ON FUNCTION public.unvoid_journal_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unvoid_journal_entry(uuid) TO authenticated;

COMMENT ON FUNCTION public.unvoid_journal_entry(uuid) IS
  'Restores a voided journal entry to posted, rebuilding the transactions feed and budget consumption. Refuses closed periods and inactive accounts.';
