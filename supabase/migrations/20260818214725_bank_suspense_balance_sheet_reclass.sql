-- ═══════════════════════════════════════════════════════════════════════════
-- Reclassify the bank-import suspense accounts (Unrecognized Deposits /
-- Unrecognized Payments) from Income/Expense to their correct Balance Sheet
-- types, so their cumulative balances show accurately in the Trial Balance
-- and General Ledger.
--
-- A bank suspense/clearing account is a temporary HOLDING account: cash that
-- has genuinely hit the bank but whose other side is not yet known. Until it
-- is investigated and cleared, it must sit on the Balance Sheet — recognising
-- it as Income or Expense before the transaction is actually identified would
-- overstate or understate Net Income for periods where items are still open.
-- (Mirrors QuickBooks' own "Ask My Accountant" treatment: an Other Current
-- Liability / Other Current Asset holding account, not a P&L category.)
--
--   4010 Unrecognized Deposits  Income  → Liability / Other Current Liability
--        (cash received, not yet recognised as earned)
--   6010 Unrecognized Payments  Expense → Asset     / Other Current Assets
--        (cash paid out, not yet recognised as an expense)
--
-- This was typed Income/Expense to mirror one client's own workbook practice
-- (see 20260721000003_bank_import_chart_setup.sql), but it has two concrete
-- consequences fixed here:
--
--   1. rpc_trial_balance shows these balances mixed into ordinary Income/
--      Expense line items instead of the Balance Sheet section they actually
--      belong to.
--   2. isPeriodBasedAccount() (src/lib/accountTypes.ts) treats every Income/
--      Expense account as resetting each fiscal year, so Ledger.tsx and
--      AccountReport.tsx force these accounts' GL opening balance to 0 on
--      every period view — hiding a carried-forward unresolved suspense
--      balance even though the backend RPCs compute it correctly underneath.
--      Reclassifying to Asset/Liability fixes this for free: those types are
--      already treated as cumulative Balance Sheet accounts everywhere.
--
-- Liability and Asset share the same normal-balance direction as Income and
-- Expense respectively (both credit-normal, both debit-normal), so no
-- historical journal_lines amounts or signs need to change — only the
-- accounts' own classification metadata.
--
-- account_settings.bank_import_unrecognized_deposit_account_id /
-- _payment_account_id are the actual accounts the posting RPC uses (not
-- account_code or account_name), so that's what identifies the accounts to
-- reclassify here, per tenant, regardless of any local renaming.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Reclassify every tenant's existing suspense accounts ────────────────
UPDATE public.accounts a
SET account_type       = 'Liability',
    account_subtype    = 'Other Current Liability',
    parent_account_id  = NULL,
    account_level      = 1,
    account_path       = a.account_code || ' ' || a.account_name,
    normal_balance     = 'Credit'
FROM public.account_settings s
WHERE a.id = s.bank_import_unrecognized_deposit_account_id
  AND a.account_type IS DISTINCT FROM 'Liability';

UPDATE public.accounts a
SET account_type       = 'Asset',
    account_subtype    = 'Other Current Assets',
    parent_account_id  = NULL,
    account_level      = 1,
    account_path       = a.account_code || ' ' || a.account_name,
    normal_balance     = 'Debit'
FROM public.account_settings s
WHERE a.id = s.bank_import_unrecognized_payment_account_id
  AND a.account_type IS DISTINCT FROM 'Asset';

-- ── 2. Fix the template so newly-provisioned tenants get it right ──────────
-- is_postable used to be derived from "has a parent_code" (every header in
-- this template happens to be top-level, every detail account happens to
-- have one) — that coincidence breaks once 4010/6010 become top-level
-- Balance Sheet accounts with no parent header of their own, so is_postable
-- is split out into its own column instead of being inferred.
ALTER TABLE public.bank_import_chart_template
  ADD COLUMN IF NOT EXISTS is_postable boolean;

UPDATE public.bank_import_chart_template
   SET is_postable = (parent_code IS NOT NULL)
 WHERE is_postable IS NULL;

ALTER TABLE public.bank_import_chart_template
  ALTER COLUMN is_postable SET NOT NULL,
  ALTER COLUMN is_postable SET DEFAULT true;

UPDATE public.bank_import_chart_template
   SET account_type = 'Liability', account_subtype = 'Other Current Liability',
       parent_code = NULL, is_postable = true
 WHERE account_code = '4010';

UPDATE public.bank_import_chart_template
   SET account_type = 'Asset', account_subtype = 'Other Current Assets',
       parent_code = NULL, is_postable = true
 WHERE account_code = '6010';

CREATE OR REPLACE FUNCTION public.setup_bank_import_chart()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_t           RECORD;
  v_acct_id     UUID;
  v_parent_id   UUID;
  v_parent_path TEXT;
  v_created     INTEGER := 0;
  v_mapped      INTEGER := 0;
  v_deposit_id  UUID;
  v_payment_id  UUID;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot set up the chart of accounts', COALESCE(v_role, 'unknown');
  END IF;

  -- 1. Create missing accounts (existing accounts are never modified).
  FOR v_t IN SELECT * FROM public.bank_import_chart_template ORDER BY sort_order LOOP
    SELECT id INTO v_acct_id FROM public.accounts
     WHERE tenant_id = v_tenant_id AND account_code = v_t.account_code;

    IF v_acct_id IS NULL THEN
      v_parent_id := NULL;
      v_parent_path := NULL;
      IF v_t.parent_code IS NOT NULL THEN
        SELECT id, account_path INTO v_parent_id, v_parent_path FROM public.accounts
         WHERE tenant_id = v_tenant_id AND account_code = v_t.parent_code;
        IF v_parent_id IS NULL THEN
          RAISE EXCEPTION 'CHART_PARENT_MISSING: parent % for account % was not created',
            v_t.parent_code, v_t.account_code;
        END IF;
      END IF;

      INSERT INTO public.accounts
        (tenant_id, account_code, account_name, account_type, account_subtype,
         parent_account_id, account_path, account_level, normal_balance,
         is_active, is_postable, is_control_account, is_system, requires_subledger)
      VALUES
        (v_tenant_id, v_t.account_code, v_t.account_name, v_t.account_type, v_t.account_subtype,
         v_parent_id,
         COALESCE(v_parent_path || ' > ', '') || v_t.account_code || ' ' || v_t.account_name,
         CASE WHEN v_t.parent_code IS NULL THEN 1 ELSE 2 END,
         CASE WHEN v_t.account_type IN ('Asset', 'Expense', 'Cost of Goods Sold', 'Other Expense')
              THEN 'Debit' ELSE 'Credit' END,
         true,
         v_t.is_postable,
         false, false, false)
      RETURNING id INTO v_acct_id;
      v_created := v_created + 1;
    END IF;

    -- 2. Wire the canonical category → account mapping.
    IF v_t.canonical_category IS NOT NULL THEN
      INSERT INTO public.bank_category_account_map
        (tenant_id, canonical_category, account_id, expected_side, is_active, created_by)
      VALUES (v_tenant_id, v_t.canonical_category, v_acct_id, v_t.expected_side, true, v_user_id)
      ON CONFLICT (tenant_id, canonical_category) DO NOTHING;
      IF FOUND THEN v_mapped := v_mapped + 1; END IF;
    END IF;

    -- 2b. Reversal category → same account, opposite side.
    IF v_t.reversal_category IS NOT NULL THEN
      INSERT INTO public.bank_category_account_map
        (tenant_id, canonical_category, account_id, expected_side, is_active, created_by)
      VALUES (v_tenant_id, v_t.reversal_category, v_acct_id,
              CASE v_t.expected_side WHEN 'debit' THEN 'credit'
                                     WHEN 'credit' THEN 'debit'
                                     ELSE 'either' END,
              true, v_user_id)
      ON CONFLICT (tenant_id, canonical_category) DO NOTHING;
      IF FOUND THEN v_mapped := v_mapped + 1; END IF;
    END IF;

    IF v_t.account_code = '4010' THEN v_deposit_id := v_acct_id; END IF;
    IF v_t.account_code = '6010' THEN v_payment_id := v_acct_id; END IF;
  END LOOP;

  -- 3. Point the directional suspense settings at the two Unrecognized accounts.
  INSERT INTO public.account_settings
    (tenant_id, bank_import_unrecognized_deposit_account_id, bank_import_unrecognized_payment_account_id)
  VALUES (v_tenant_id, v_deposit_id, v_payment_id)
  ON CONFLICT (tenant_id) DO UPDATE SET
    bank_import_unrecognized_deposit_account_id =
      COALESCE(public.account_settings.bank_import_unrecognized_deposit_account_id, EXCLUDED.bank_import_unrecognized_deposit_account_id),
    bank_import_unrecognized_payment_account_id =
      COALESCE(public.account_settings.bank_import_unrecognized_payment_account_id, EXCLUDED.bank_import_unrecognized_payment_account_id);

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Bank Import Chart Setup', 'accounts', v_tenant_id,
          jsonb_build_object('accounts_created', v_created, 'categories_mapped', v_mapped));

  RETURN jsonb_build_object(
    'accounts_created', v_created,
    'categories_mapped', v_mapped,
    'unrecognized_deposit_account_id', v_deposit_id,
    'unrecognized_payment_account_id', v_payment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_bank_import_chart() TO authenticated;
