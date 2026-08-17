-- Hard-delete a manual journal entry together with both sides of its double entry.
--
-- journal_lines cascades off journal_entries, so removing the header removes every
-- debit/credit line (and the AR/AP/asset/inventory subledger rows that cascade off
-- those lines). Everything else that a posted entry touches -- the denormalised
-- `transactions` feed and budget consumption -- is maintained by triggers that only
-- fire on INSERT/UPDATE, so this function unwinds them explicitly.
--
-- Deletion is restricted to manual entries. Entries produced by a source document
-- (invoice, payment, bank/petty-cash import, ...) must be removed from that document,
-- and their FKs are ON DELETE NO ACTION so a direct delete would fail anyway.

CREATE OR REPLACE FUNCTION public.delete_journal_entry(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid;
  v_tenant_id  uuid;
  v_role       text;
  v_entry      public.journal_entries%ROWTYPE;
  v_lines      jsonb;
  v_line_count integer;
  v_source     text;
  v_pl_accounts uuid[];
  r            uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'You are not signed in to a company.';
  END IF;

  v_role := public.get_user_role_name();
  IF v_role IS NULL OR v_role NOT IN ('Primary Admin', 'Company Admin', 'Accountant', 'Super Admin') THEN
    RAISE EXCEPTION 'You do not have permission to delete journal entries.';
  END IF;

  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = p_entry_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found.';
  END IF;

  -- Source-linked entries belong to their document, not to the journal.
  v_source := COALESCE(v_entry.source_type, v_entry.entry_type, 'manual');
  IF COALESCE(v_entry.is_system_generated, false) OR v_source <> 'manual' THEN
    RAISE EXCEPTION 'This entry was generated from a % and cannot be deleted here. Delete or amend the source document instead.',
      replace(v_source, '_', ' ');
  END IF;

  -- A reversal points back at what it reversed; removing the target orphans it.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE reversal_of = p_entry_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'This entry has already been reversed. Delete the reversing entry first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND status = 'closed'
      AND v_entry.entry_date BETWEEN period_start AND period_end
  ) THEN
    RAISE EXCEPTION 'This entry falls in a closed accounting period and cannot be deleted.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bank_feed_transactions bft
    JOIN public.journal_lines jl ON jl.id = bft.matched_journal_line_id
    WHERE jl.journal_entry_id = p_entry_id
      AND bft.status = 'matched'
  ) OR EXISTS (
    SELECT 1
    FROM public.reconciliation_transactions rt
    JOIN public.journal_lines jl ON jl.id = rt.journal_line_id
    WHERE jl.journal_entry_id = p_entry_id
  ) THEN
    RAISE EXCEPTION 'This entry is linked to reconciled bank records and cannot be deleted.';
  END IF;

  -- Snapshot before the cascade takes the lines with it.
  SELECT jsonb_agg(to_jsonb(jl) ORDER BY jl.seq NULLS LAST, jl.id), count(*)
  INTO v_lines, v_line_count
  FROM public.journal_lines jl
  WHERE jl.journal_entry_id = p_entry_id;

  DELETE FROM public.transactions
  WHERE source_type = 'journal_entry' AND source_id = p_entry_id;

  -- Collect the P&L accounts first: after the delete the lines are gone.
  SELECT COALESCE(array_agg(DISTINCT jl.account_id), '{}')
  INTO v_pl_accounts
  FROM public.journal_lines jl
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = p_entry_id
    AND a.account_type IN ('Expense', 'Cost of Goods Sold', 'Other Expense', 'Income', 'Other Income');

  BEGIN
    DELETE FROM public.journal_entries
    WHERE id = p_entry_id AND tenant_id = v_tenant_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'This entry is still referenced by another record and cannot be deleted.';
  END;

  IF v_entry.status = 'posted' THEN
    FOREACH r IN ARRAY v_pl_accounts LOOP
      PERFORM public.recalc_budget_consumption(
        v_tenant_id, r,
        public.derive_period(v_entry.entry_date, 'monthly'), 'monthly',
        NULL, NULL, NULL);
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES ('Journal Deleted', 'journal_entries', p_entry_id, v_user_id, v_tenant_id,
          jsonb_build_object('entry', to_jsonb(v_entry), 'lines', COALESCE(v_lines, '[]'::jsonb)));

  RETURN jsonb_build_object(
    'id', p_entry_id,
    'reference', v_entry.reference,
    'lines_deleted', COALESCE(v_line_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_journal_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_journal_entry(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_journal_entry(uuid) IS
  'Permanently deletes a manual journal entry and all of its debit/credit lines, unwinding the transactions feed and budget consumption. Blocks source-generated, reversed, closed-period and reconciled entries.';
