-- ════════════════════════════════════════════════════════════════════════════
-- Migration: enforce parent linkage so sub-ledger balances roll up
-- File: supabase/migrations/20260614000001_enforce_subledger_parent_link.sql
--
-- Two layers:
--   1. A trigger on accounts that blocks creating a Fixed-Asset / Accumulated
--      Depreciation DETAIL account at the root (no parent). These must nest
--      under a control parent so the COA rollup has a target. AR/AP/Inventory
--      are intentionally excluded — they are managed via their subledger
--      modules, not GL sub-accounts.
--   2. A trigger on asset_categories that blocks pointing asset_account_id or
--      accumulated_depreciation_account_id at a parent-less (root) account.
--
-- Both are defensive backstops behind the form-level guards.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. accounts: require parent for fixed-asset detail accounts ──────────────
CREATE OR REPLACE FUNCTION public.fn_require_subledger_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtype TEXT := lower(coalesce(NEW.account_subtype, ''));
  v_requires_parent BOOLEAN;
BEGIN
  v_requires_parent :=
       v_subtype LIKE '%fixed asset%'
    OR v_subtype LIKE '%furniture%'
    OR v_subtype LIKE '%vehicle%'
    OR v_subtype LIKE '%building%'
    OR v_subtype LIKE '%accumulated depreciation%';

  IF v_requires_parent AND NEW.parent_account_id IS NULL THEN
    RAISE EXCEPTION
      'ROLLUP_INTEGRITY: Account "%" (%) is a fixed-asset detail account and must be linked to a parent control account so its balance rolls up. Set parent_account_id.',
      NEW.account_name, NEW.account_code
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_subledger_parent ON public.accounts;
CREATE TRIGGER trg_require_subledger_parent
  BEFORE INSERT OR UPDATE OF parent_account_id, account_subtype ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_require_subledger_parent();


-- ── 2. asset_categories: chosen GL accounts must be parent-linked ────────────
CREATE OR REPLACE FUNCTION public.fn_asset_category_accounts_linked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_parent UUID;
  v_accum_parent UUID;
BEGIN
  IF NEW.asset_account_id IS NOT NULL THEN
    SELECT parent_account_id INTO v_asset_parent
    FROM public.accounts WHERE id = NEW.asset_account_id;
    IF v_asset_parent IS NULL THEN
      RAISE EXCEPTION
        'ROLLUP_INTEGRITY: Asset Account for category "%" is not linked to a parent control account. Choose an account nested under a Fixed Assets / PP&E group.',
        NEW.name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.accumulated_depreciation_account_id IS NOT NULL THEN
    SELECT parent_account_id INTO v_accum_parent
    FROM public.accounts WHERE id = NEW.accumulated_depreciation_account_id;
    IF v_accum_parent IS NULL THEN
      RAISE EXCEPTION
        'ROLLUP_INTEGRITY: Accumulated Depreciation account for category "%" is not linked to a parent. Nest it under the PP&E control account.',
        NEW.name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asset_category_accounts_linked ON public.asset_categories;
CREATE TRIGGER trg_asset_category_accounts_linked
  BEFORE INSERT OR UPDATE OF asset_account_id, accumulated_depreciation_account_id ON public.asset_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_asset_category_accounts_linked();


-- ── 3. Diagnostic: list fixed-asset detail accounts currently unlinked ───────
--    Run AFTER applying to find pre-existing data that violates the rule, so it
--    can be re-parented before the triggers start blocking edits.
--
--    SELECT account_code, account_name, account_subtype
--    FROM public.accounts
--    WHERE parent_account_id IS NULL
--      AND lower(coalesce(account_subtype,'')) ~
--          '(fixed asset|furniture|vehicle|building|accumulated depreciation)';
