-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — resolve statement rows by their ledger ACCOUNT NAME.
--
-- The canonical variant map was seeded only with the messy abbreviations from
-- the original Sampath workbook ("salary", "harvset", "bank fee"). A clean
-- chart-based statement instead puts the proper account name in the Account
-- Type column ("Salaries", "Electricity", "Guava sales") — none of which were
-- in the map, so the never-guess engine sent every one to Suspense.
--
-- Fix: every account that is a bank-import posting target should also resolve
-- from its own name. We seed the GLOBAL canonical map (tenant_id IS NULL) with
-- normalize(account_name) → canonical_category for the whole chart template, so
-- it works for every tenant, present and future, with no per-tenant setup.
--
-- Also: seven accounts had no canonical category at all (the six PPE detail
-- accounts and Customer Deposits), so they could never map even by name. Give
-- them categories, then backfill the account map for tenants already set up.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Categorize the previously-uncategorized detail accounts ─────────────
UPDATE public.bank_import_chart_template SET canonical_category = 'land'               WHERE account_code = '1610';
UPDATE public.bank_import_chart_template SET canonical_category = 'ppe_building'        WHERE account_code = '1620';
UPDATE public.bank_import_chart_template SET canonical_category = 'office_equipment'    WHERE account_code = '1630';
UPDATE public.bank_import_chart_template SET canonical_category = 'other_equipment'     WHERE account_code = '1640';
UPDATE public.bank_import_chart_template SET canonical_category = 'furniture_fittings'  WHERE account_code = '1650';
UPDATE public.bank_import_chart_template SET canonical_category = 'name_board'          WHERE account_code = '1660';
UPDATE public.bank_import_chart_template SET canonical_category = 'customer_deposits'   WHERE account_code = '4020';

-- ── 2. Global name → category variants for the whole standard chart ────────
-- Dynamic from the template so it stays correct as the chart evolves. Account
-- names are distinct, so their normalized forms do not collide.
INSERT INTO public.bank_category_canonical_map (tenant_id, raw_variant, canonical_category)
SELECT NULL, public.bank_normalize_text(account_name), canonical_category
  FROM public.bank_import_chart_template
 WHERE canonical_category IS NOT NULL
ON CONFLICT (tenant_id, raw_variant) DO NOTHING;

-- Note: rows whose Account Type is not a standard account name — genuine typos
-- ("Consultaion charges"), unknown vendors ("Miscellaneous Stuff"), or blank
-- inflows ("Fund transfer inward") — deliberately still go to Suspense. The
-- engine never guesses; the human maps those once via "teach the engine" or a
-- Tier-2 rule, and they resolve automatically thereafter.

-- ── 3. Backfill the account map for tenants already set up ─────────────────
-- Adds every template category (including the seven new ones) to any tenant
-- that has previously run setup, pointing at that tenant's own account rows.
INSERT INTO public.bank_category_account_map
  (tenant_id, canonical_category, account_id, expected_side, is_active)
SELECT a.tenant_id, tpl.canonical_category, a.id, tpl.expected_side, true
  FROM public.accounts a
  JOIN public.bank_import_chart_template tpl ON tpl.account_code = a.account_code
 WHERE tpl.canonical_category IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.bank_category_account_map m WHERE m.tenant_id = a.tenant_id)
ON CONFLICT (tenant_id, canonical_category) DO NOTHING;

-- ── 4. Reversal maps for the newly-categorized accounts are unchanged; none
--       of the seven take reversals, so nothing to add there.

-- ── 5. setup_bank_import_chart: also seed per-tenant name variants ─────────
-- Covers tenants who RENAME accounts (their custom name won't be in the global
-- map). Appended to the existing category/mapping wiring; still idempotent.
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
         v_t.parent_code IS NOT NULL,
         false, false, false)
      RETURNING id INTO v_acct_id;
      v_created := v_created + 1;
    END IF;

    IF v_t.canonical_category IS NOT NULL THEN
      INSERT INTO public.bank_category_account_map
        (tenant_id, canonical_category, account_id, expected_side, is_active, created_by)
      VALUES (v_tenant_id, v_t.canonical_category, v_acct_id, v_t.expected_side, true, v_user_id)
      ON CONFLICT (tenant_id, canonical_category) DO NOTHING;
      IF FOUND THEN v_mapped := v_mapped + 1; END IF;

      -- Per-tenant name variant: resolve this account by its (possibly renamed)
      -- name. Global name variants already cover the standard names.
      INSERT INTO public.bank_category_canonical_map
        (tenant_id, raw_variant, canonical_category, created_by)
      VALUES (v_tenant_id, public.bank_normalize_text(v_t.account_name), v_t.canonical_category, v_user_id)
      ON CONFLICT (tenant_id, raw_variant) DO NOTHING;
    END IF;

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

-- ── 6. Raise the default per-line ceiling for LKR books ────────────────────
-- LKR amounts are naturally large; a 100M ceiling flagged legitimate fixed-
-- asset purchases (e.g. a 125M land plot). 1B is a more sensible default for
-- LKR-denominated ledgers. Existing tenants still on the old default are moved
-- up too; any tenant that deliberately set a lower ceiling is left alone.
ALTER TABLE public.account_settings
  ALTER COLUMN bank_import_amount_ceiling SET DEFAULT 1000000000;

UPDATE public.account_settings
   SET bank_import_amount_ceiling = 1000000000
 WHERE bank_import_amount_ceiling = 100000000;
