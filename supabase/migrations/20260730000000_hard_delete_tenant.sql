-- Permanent (hard) deletion of a company by a Super Admin.
--
-- Archiving a tenant (tenants.deleted_at) is reversible. This adds the
-- irreversible step: erase every row of that tenant's data across the whole
-- schema, then the tenant row itself.
--
-- Auth accounts and storage objects live outside Postgres, so they are cleaned
-- up by the `delete-tenant` edge function, which calls this RPC first and uses
-- the auth_user_ids it returns.

-- ---------------------------------------------------------------------------
-- 1. Deletion log — outlives the tenant it describes, so it carries no tenant_id
--    (a tenant_id column would make hard_delete_tenant erase its own audit trail).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_deletion_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref          uuid NOT NULL,
  company_name        text NOT NULL,
  tenant_snapshot     jsonb NOT NULL,
  row_counts          jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_rows_deleted  bigint NOT NULL DEFAULT 0,
  auth_user_ids       uuid[] NOT NULL DEFAULT '{}',
  external_cleanup    jsonb,
  performed_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  performed_by_email  text,
  performed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_deletion_log_performed_at
  ON public.tenant_deletion_log (performed_at DESC);

ALTER TABLE public.tenant_deletion_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can read tenant deletion log" ON public.tenant_deletion_log;
CREATE POLICY "Super admins can read tenant deletion log"
  ON public.tenant_deletion_log FOR SELECT
  USING (public.is_super_admin());

-- Writes only through the security-definer function below / the service role.
-- No INSERT / UPDATE / DELETE policies on purpose: the log is append-only.

-- ---------------------------------------------------------------------------
-- 2. The purge
-- ---------------------------------------------------------------------------
-- p_actor_auth_id: the Super Admin performing the deletion, as auth.users.id.
-- Only consulted when there is no end-user JWT (i.e. the service role calling on
-- a Super Admin's behalf from the delete-tenant edge function, which needs the
-- service role's longer statement_timeout — the `authenticated` role's default is
-- far too short to purge a large company, and statement_timeout cannot be raised
-- from inside an already-running statement).
CREATE OR REPLACE FUNCTION public.hard_delete_tenant(
  p_tenant_id      uuid,
  p_confirmation   text,
  p_actor_auth_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Child tables that carry no tenant_id: '<table>|<where clause using $1>'.
  -- Ordered deepest-first so foreign keys stay satisfied as we go.
  c_child_specs text[] := ARRAY[
    'payroll_item_details|run_item_id in (select ri.id from public.payroll_run_items ri join public.payroll_runs r on r.id = ri.run_id where r.tenant_id = $1) or run_item_id in (select ri.id from public.payroll_run_items ri join public.employees e on e.id = ri.employee_id where e.tenant_id = $1)',
    'reconciliation_transactions|reconciliation_id in (select id from public.bank_reconciliations where tenant_id = $1) or journal_line_id in (select jl.id from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id where je.tenant_id = $1)',
    'reconciliation_adjustments|reconciliation_id in (select id from public.bank_reconciliations where tenant_id = $1) or journal_entry_id in (select id from public.journal_entries where tenant_id = $1)',
    'reconciliation_logs|reconciliation_id in (select id from public.bank_reconciliations where tenant_id = $1) or user_id in (select id from public.users where tenant_id = $1)',
    'payroll_run_items|run_id in (select id from public.payroll_runs where tenant_id = $1) or employee_id in (select id from public.employees where tenant_id = $1)',
    'budget_variances|budget_item_id in (select id from public.budget_items where tenant_id = $1)',
    'invoice_items|invoice_id in (select id from public.invoices where tenant_id = $1)',
    'quote_items|quote_id in (select id from public.quotes where tenant_id = $1)',
    'recurring_invoice_items|recurring_invoice_id in (select id from public.recurring_invoices where tenant_id = $1)',
    'payment_voucher_lines|voucher_id in (select id from public.payment_vouchers where tenant_id = $1)',
    'petty_cash_voucher_lines|voucher_id in (select id from public.petty_cash_vouchers where tenant_id = $1)',
    'petty_cash_count_denominations|count_id in (select id from public.petty_cash_counts where tenant_id = $1)',
    'stock_transfer_lines|transfer_id in (select id from public.stock_transfers where tenant_id = $1)',
    'payments_received|invoice_id in (select id from public.invoices where tenant_id = $1) or journal_entry_id in (select id from public.journal_entries where tenant_id = $1) or ar_account_id in (select id from public.accounts where tenant_id = $1) or bank_account_id in (select id from public.accounts where tenant_id = $1)',
    'payroll_records|employee_id in (select id from public.employees where tenant_id = $1)',
    'apit_brackets|schedule_id in (select id from public.apit_schedules where tenant_id = $1)',
    'ledger_balances|account_id in (select id from public.accounts where tenant_id = $1)',
    'journal_lines|journal_entry_id in (select id from public.journal_entries where tenant_id = $1) or account_id in (select id from public.accounts where tenant_id = $1) or cost_center_id in (select id from public.cost_centers where tenant_id = $1)',
    'payments|subscription_id in (select id from public.subscriptions where tenant_id = $1)',
    'dashboard_kpi_preferences|user_id in (select id from public.users where tenant_id = $1)',
    'user_permissions|user_id in (select id from public.users where tenant_id = $1)'
  ];

  v_tenant        public.tenants;
  v_claims        text;
  v_jwt_role      text;
  v_actor_auth    uuid;
  v_actor_id      uuid;
  v_actor_email   text;
  v_actor_tenant  uuid;
  v_actor_role    text;
  v_auth_ids      uuid[];
  v_user_emails   text[];

  v_scoped        text[];   -- tables that have a tenant_id column
  v_disabled      text[] := '{}';
  v_remaining     text[];
  v_blocked       text[];
  v_leftovers     text[] := '{}';

  v_spec          text;
  v_table         text;
  v_clause        text;
  v_deleted       bigint;
  v_left          bigint;
  v_counts        jsonb := '{}'::jsonb;
  v_total         bigint := 0;
  v_pass          int := 0;
  v_progress      boolean;
  v_log_id        uuid;
BEGIN
  -- ---- Who is asking, and are they allowed? --------------------------------
  v_claims   := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_role := CASE WHEN v_claims IS NULL THEN NULL
                     ELSE v_claims::jsonb ->> 'role' END;

  IF auth.uid() IS NOT NULL THEN
    -- End-user call: the JWT owner is the actor, never p_actor_auth_id.
    v_actor_auth := auth.uid();
  ELSIF v_claims IS NULL THEN
    -- Direct database session (psql / SQL editor): already privileged.
    v_actor_auth := p_actor_auth_id;
  ELSIF v_jwt_role = 'service_role' THEN
    IF p_actor_auth_id IS NULL THEN
      RAISE EXCEPTION 'p_actor_auth_id is required when calling with the service role';
    END IF;
    v_actor_auth := p_actor_auth_id;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_actor_auth IS NOT NULL THEN
    SELECT u.id, u.email, u.tenant_id, r.role_name
      INTO v_actor_id, v_actor_email, v_actor_tenant, v_actor_role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE u.auth_user_id = v_actor_auth;

    IF v_actor_role IS DISTINCT FROM 'Super Admin' THEN
      RAISE EXCEPTION 'Only a Super Admin can permanently delete a company';
    END IF;
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company % not found', p_tenant_id;
  END IF;

  IF v_actor_tenant IS NOT NULL AND v_actor_tenant = p_tenant_id THEN
    RAISE EXCEPTION 'You cannot permanently delete the company your own account belongs to';
  END IF;

  IF v_tenant.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Archive "%" before deleting it permanently', v_tenant.company_name;
  END IF;

  -- Typed confirmation must match the company name exactly.
  IF p_confirmation IS DISTINCT FROM v_tenant.company_name THEN
    RAISE EXCEPTION 'Confirmation text does not match the company name';
  END IF;

  -- Fail fast instead of stalling the app behind our table locks. lock_timeout is
  -- re-read on every lock wait, so setting it here does apply to the work below.
  SET LOCAL lock_timeout = '10s';

  -- Auth accounts to remove afterwards (captured before public.users is purged).
  SELECT coalesce(array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL), '{}'),
         coalesce(array_agg(email) FILTER (WHERE email IS NOT NULL), '{}')
    INTO v_auth_ids, v_user_emails
  FROM public.users
  WHERE tenant_id = p_tenant_id;

  -- Every base table in public that is tenant-scoped, discovered at runtime so
  -- new tables are covered without touching this function.
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
    INTO v_scoped
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
                     AND a.attname = 'tenant_id'
                     AND a.attnum > 0
                     AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> 'tenants';

  -- Suspend user triggers on everything we touch: several tables block DELETE
  -- outright (reconciliation snapshots/invariant log) and others recompute
  -- balances or write audit rows we are in the middle of erasing. FK triggers
  -- are internal and stay active, so referential integrity is still enforced.
  FOREACH v_table IN ARRAY (
    v_scoped || ARRAY(SELECT split_part(s.spec, '|', 1)
                      FROM unnest(c_child_specs) AS s(spec))
  ) LOOP
    IF EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c2 ON c2.oid = t.tgrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = 'public' AND c2.relname = v_table AND NOT t.tgisinternal
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
      v_disabled := v_disabled || v_table;
    END IF;
  END LOOP;

  -- Pass 1: child tables with no tenant_id of their own.
  FOREACH v_spec IN ARRAY c_child_specs LOOP
    v_table  := split_part(v_spec, '|', 1);
    v_clause := substr(v_spec, strpos(v_spec, '|') + 1);

    IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DELETE FROM public.%I WHERE %s', v_table, v_clause)
      USING p_tenant_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted > 0 THEN
      v_counts := v_counts || jsonb_build_object(
        v_table, coalesce((v_counts ->> v_table)::bigint, 0) + v_deleted);
      v_total := v_total + v_deleted;
    END IF;
  END LOOP;

  -- Pass 2: tenant-scoped tables. Order is unknown, so retry the ones that are
  -- still referenced until a full pass makes no progress.
  v_remaining := v_scoped;
  WHILE coalesce(array_length(v_remaining, 1), 0) > 0 LOOP
    v_pass := v_pass + 1;
    v_progress := false;
    v_blocked := '{}';

    FOREACH v_table IN ARRAY v_remaining LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table)
          USING p_tenant_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;

        IF v_deleted > 0 THEN
          v_counts := v_counts || jsonb_build_object(
            v_table, coalesce((v_counts ->> v_table)::bigint, 0) + v_deleted);
          v_total := v_total + v_deleted;
        END IF;
        v_progress := true;
      EXCEPTION WHEN foreign_key_violation THEN
        v_blocked := v_blocked || v_table;
      END;
    END LOOP;

    IF NOT v_progress OR v_pass > 100 THEN
      RAISE EXCEPTION 'Could not purge % — rows still referenced in: %',
        v_tenant.company_name, array_to_string(v_blocked, ', ');
    END IF;

    v_remaining := v_blocked;
  END LOOP;

  -- Guard: nothing tenant-scoped may survive.
  FOREACH v_table IN ARRAY v_scoped LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', v_table)
      INTO v_left USING p_tenant_id;
    IF v_left > 0 THEN
      v_leftovers := v_leftovers || format('%s (%s)', v_table, v_left);
    END IF;
  END LOOP;

  IF coalesce(array_length(v_leftovers, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Purge incomplete, rolling back. Rows remain in: %',
      array_to_string(v_leftovers, ', ');
  END IF;

  DELETE FROM public.tenants WHERE id = p_tenant_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Failed to delete the company record for %', v_tenant.company_name;
  END IF;
  v_counts := v_counts || jsonb_build_object('tenants', 1);
  v_total := v_total + 1;

  FOREACH v_table IN ARRAY v_disabled LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
  END LOOP;

  INSERT INTO public.tenant_deletion_log (
    tenant_ref, company_name, tenant_snapshot, row_counts,
    total_rows_deleted, auth_user_ids, performed_by, performed_by_email
  ) VALUES (
    p_tenant_id, v_tenant.company_name, to_jsonb(v_tenant), v_counts,
    v_total, coalesce(v_auth_ids, '{}'), v_actor_id, v_actor_email
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'tenant_id', p_tenant_id,
    'company_name', v_tenant.company_name,
    'tables_purged', (SELECT count(*) FROM jsonb_object_keys(v_counts)),
    'total_rows_deleted', v_total,
    'row_counts', v_counts,
    'auth_user_ids', to_jsonb(coalesce(v_auth_ids, '{}')),
    'user_emails', to_jsonb(coalesce(v_user_emails, '{}'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_tenant(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hard_delete_tenant(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hard_delete_tenant(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_tenant(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.hard_delete_tenant(uuid, text, uuid) IS
  'Irreversibly erases all data for an archived tenant. Super Admin only; '
  'p_confirmation must equal tenants.company_name. Returns the auth user ids '
  'the delete-tenant edge function must remove from auth.users.';
