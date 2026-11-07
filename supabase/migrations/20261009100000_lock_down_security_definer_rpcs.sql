-- Lock down SECURITY DEFINER RPCs.
--
-- Supabase grants EXECUTE on every public function to anon + authenticated by
-- default, and SECURITY DEFINER bypasses RLS. 47 definer functions trusted a
-- caller-supplied p_tenant_id (or batch/account id) without checking who was
-- calling, so anyone holding the public anon key could read or mutate another
-- tenant's ledger via /rest/v1/rpc/... (verified: calculate_gl_balance_for_account
-- returned a real balance to anon). Tenant ids are not secret — they appear in
-- every public invoice-assets logo URL.
--
--   1. assert_tenant_access(): one guard for "caller belongs to this tenant".
--   2. Guard the 15 such functions the app / user-JWT edge functions call.
--   3. Revoke the other 32 from anon + authenticated (internal / service-role only).
--   4. Revoke anon from every public SECURITY DEFINER function — nothing runs
--      before login except the signup_requests insert, which uses no functions.
--   5. Stop new functions being granted to anon/PUBLIC by default.

-- ─── 1. Guard ──────────────────────────────────────────────────────────────
-- Trusted (returns true): service_role, cron and migrations — any context that
-- is not a PostgREST anon/authenticated request. Checks both the JWT role claim
-- and the session role (PostgREST does SET ROLE; SECURITY DEFINER does not
-- change it). NULL tenant passes: it addresses no tenant's data, and the
-- callers already handle NULL themselves.
CREATE OR REPLACE FUNCTION public.assert_tenant_access(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
    RETURN true;
  END IF;
  IF p_tenant_id IS NULL THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NOT NULL
     AND (p_tenant_id = public.get_user_tenant_id() OR public.is_super_admin()) THEN
    RETURN true;
  END IF;
  RAISE EXCEPTION 'TENANT_ACCESS_DENIED' USING ERRCODE = '42501';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assert_tenant_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_tenant_access(uuid) TO service_role;

-- ─── 2a. Guard the plpgsql functions (one BEGIN each, verified) ────────────
DO $$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('ensure_current_fiscal_period', 'fx_rate', 'generate_tax_periods',
                        'get_account_settings_completeness', 'invoice_approval_plan',
                        'next_credit_note_number', 'next_quote_number', 'next_tenant_number',
                        'pc_next_document_number', 'validate_voucher_budget')
      AND pg_get_function_identity_arguments(p.oid) LIKE 'p_tenant_id uuid%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%assert_tenant_access%' THEN
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, '\mBEGIN\M', 'g')) <> 1 THEN
      RAISE EXCEPTION 'expected exactly one BEGIN in %', r.oid::regprocedure;
    END IF;
    v_new := regexp_replace(v_def, '\mBEGIN\M',
                            E'BEGIN\n  PERFORM public.assert_tenant_access(p_tenant_id);');
    EXECUTE v_new;
  END LOOP;
END;
$$;

-- ─── 2b. Guard the SQL-language functions ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.budget_vs_actual(p_tenant_id uuid, p_fiscal_year integer DEFAULT NULL::integer, p_department_id uuid DEFAULT NULL::uuid, p_account_type text DEFAULT NULL::text)
 RETURNS TABLE(budget_id uuid, budget_name text, account_id uuid, account_code text, account_name text, account_type text, period text, period_type text, department_id uuid, allocated numeric, actual numeric, variance numeric, variance_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lines AS (
    SELECT bi.*, b.name AS budget_name, b.status AS budget_status,
           a.account_code, a.account_name, a.account_type
    FROM budget_items bi
    JOIN budgets b ON b.id = bi.budget_id
    JOIN accounts a ON a.id = bi.account_id
    WHERE public.assert_tenant_access(p_tenant_id)
      AND bi.tenant_id = p_tenant_id
      AND b.status IN ('active','closed')
      AND (p_fiscal_year IS NULL OR EXTRACT(YEAR FROM b.period_start) = p_fiscal_year)
      AND (p_department_id IS NULL OR bi.department_id = p_department_id)
      AND (p_account_type IS NULL OR a.account_type = p_account_type)
  )
  SELECT
    l.budget_id, l.budget_name, l.account_id, l.account_code, l.account_name, l.account_type,
    l.period, l.period_type, l.department_id,
    l.allocated_amount AS allocated,
    COALESCE(bc.consumed_amount, public.recalc_budget_consumption(
      p_tenant_id, l.account_id, l.period, l.period_type,
      l.class_id, l.department_id, l.project_id
    )) AS actual,
    l.allocated_amount - COALESCE(bc.consumed_amount, 0) AS variance,
    CASE WHEN l.allocated_amount > 0
         THEN round((COALESCE(bc.consumed_amount, 0) / l.allocated_amount) * 100, 2)
         ELSE 0 END AS variance_pct
  FROM lines l
  LEFT JOIN budget_consumptions bc
    ON bc.tenant_id = p_tenant_id
   AND bc.account_id = l.account_id
   AND bc.period = l.period
   AND COALESCE(bc.class_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(l.class_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND COALESCE(bc.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(l.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND COALESCE(bc.project_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(l.project_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY l.account_code, l.period;
$function$;

-- Keyed by account, not tenant: guard each returned budget's tenant.
CREATE OR REPLACE FUNCTION public.calculate_budget_usage(p_account_id uuid, p_start_date date, p_end_date date, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(allocated_amount numeric, actual_amount numeric, remaining_amount numeric, utilization_percentage numeric, warning_threshold numeric, budget_line_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    bi.allocated_amount,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN a.normal_balance = 'debit' THEN jl.debit - jl.credit
          ELSE jl.credit - jl.debit
        END
      )
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.account_id = p_account_id
        AND je.status = 'posted'
        AND je.entry_date BETWEEN p_start_date AND p_end_date
        AND je.tenant_id = b.tenant_id
    ), 0) AS actual_amount,
    bi.allocated_amount - COALESCE((
      SELECT SUM(
        CASE
          WHEN a.normal_balance = 'debit' THEN jl.debit - jl.credit
          ELSE jl.credit - jl.debit
        END
      )
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.account_id = p_account_id
        AND je.status = 'posted'
        AND je.entry_date BETWEEN p_start_date AND p_end_date
        AND je.tenant_id = b.tenant_id
    ), 0) AS remaining_amount,
    CASE
      WHEN bi.allocated_amount > 0 THEN
        ROUND(COALESCE((
          SELECT SUM(
            CASE
              WHEN a.normal_balance = 'debit' THEN jl.debit - jl.credit
              ELSE jl.credit - jl.debit
            END
          )
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.journal_entry_id
          JOIN accounts a ON a.id = jl.account_id
          WHERE jl.account_id = p_account_id
            AND je.status = 'posted'
            AND je.entry_date BETWEEN p_start_date AND p_end_date
            AND je.tenant_id = b.tenant_id
        ), 0) / bi.allocated_amount * 100, 2)
      ELSE 0
    END AS utilization_percentage,
    bi.warning_threshold,
    bi.id AS budget_line_id
  FROM budget_items bi
  JOIN budgets b ON b.id = bi.budget_id
  WHERE bi.account_id = p_account_id
    AND b.status = 'active'
    AND b.period_start <= p_end_date
    AND b.period_end >= p_start_date
    AND (p_department_id IS NULL OR bi.department_id = p_department_id)
    AND public.assert_tenant_access(b.tenant_id)
  LIMIT 1;
$function$;

-- FROM-less outer SELECT: the WHERE runs exactly once, before anything is counted.
CREATE OR REPLACE FUNCTION public.generate_pcr_number(p_tenant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'PCR-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || LPAD((COALESCE(
    (SELECT COUNT(*)::int + 1 FROM public.petty_cash_replenishments
     WHERE tenant_id = p_tenant_id
     AND replenishment_number LIKE 'PCR-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-%'),
    1
  ))::text, 4, '0')
  WHERE public.assert_tenant_access(p_tenant_id);
$function$;

CREATE OR REPLACE FUNCTION public.generate_pcv_number(p_tenant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'PCV-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || LPAD((COALESCE(
    (SELECT COUNT(*)::int + 1 FROM public.petty_cash_vouchers
     WHERE tenant_id = p_tenant_id
     AND voucher_number LIKE 'PCV-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-%'),
    1
  ))::text, 4, '0')
  WHERE public.assert_tenant_access(p_tenant_id);
$function$;

CREATE OR REPLACE FUNCTION public.generate_wht_certificate_no(p_tenant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'WHT-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
    LPAD((
      COALESCE((
        SELECT COUNT(*)::int + 1 FROM public.bill_payments
        WHERE tenant_id = p_tenant_id
          AND wht_certificate_no LIKE 'WHT-' || to_char(CURRENT_DATE, 'YYYY') || '-%'
      ), 1)
    )::text, 5, '0')
  WHERE public.assert_tenant_access(p_tenant_id);
$function$;

-- ─── 3. Internal / service-role-only: no client access at all ──────────────
-- None are called via .rpc() from the app or with a user JWT; the only
-- in-database callers are SECURITY DEFINER functions (which run as owner).
-- calculate_gl_balance_for_account, reverse_tax_transactions,
-- next_receipt_number and get_category_time_series are called by edge
-- functions with the service-role client only.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'calculate_gl_balance_for_account', 'reverse_tax_transactions',
        'next_receipt_number', 'get_category_time_series',
        'eligible_invoice_approvers', 'eligible_step_approvers',
        'ensure_cash_over_short_account', 'ensure_leave_balance', 'ensure_tax_account',
        'generate_bill_number', 'generate_voucher_number',
        'get_tax_members', 'get_tax_rate', 'get_user_permission',
        'is_attendance_period_locked', 'is_cash_or_bank_account', 'is_period_closed',
        'next_pcv_serial_block', 'notify_invoice_creator', 'notify_invoice_step_approvers',
        'pc_locked_ledger_balance', 'recalc_budget_consumption',
        'recalc_budget_for_bank_batch', 'recalc_budget_for_pc_import_batch',
        'recalc_daily_balances_from', 'recalculate_daily_balance', 'rls_auto_enable',
        'seed_default_leave_types', 'seed_default_payroll_engine', 'seed_tax_engine_for_tenant',
        'sync_bank_batch_transactions', 'sync_pc_import_batch_transactions')
      AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.fn);
  END LOOP;
END;
$$;

-- ─── 4. No SECURITY DEFINER function is callable before login ──────────────
-- Make authenticated's grant explicit first so dropping PUBLIC doesn't take it.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
  LOOP
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.fn);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
  END LOOP;
END;
$$;

-- ─── 5. Future functions: no automatic anon / PUBLIC execute ───────────────
-- authenticated + service_role keep their schema-level default grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
