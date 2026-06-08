
-- ============================================================
-- Phase 1: Chart of Accounts Hierarchy
--   • New columns: account_level, account_path, is_postable,
--                  control_account_type
--   • Backfill existing rows
--   • DB triggers: level/path auto-compute, parent postable
--                  flip, is_postable posting guard,
--                  control_account_type sync, type consistency
-- ============================================================

-- ── 1. Add columns ───────────────────────────────────────────

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_level        INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS account_path         TEXT,
  ADD COLUMN IF NOT EXISTS is_postable          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS control_account_type TEXT    NOT NULL DEFAULT 'NONE';

-- ── 2. Backfill account_path + account_level (recursive CTE) ─

WITH RECURSIVE acct_tree AS (
  -- Root accounts (no parent)
  SELECT id,
         account_code::TEXT AS account_path,
         1                  AS account_level
  FROM public.accounts
  WHERE parent_account_id IS NULL

  UNION ALL

  SELECT a.id,
         t.account_path || '.' || a.account_code,
         t.account_level + 1
  FROM public.accounts  a
  JOIN acct_tree        t ON a.parent_account_id = t.id
)
UPDATE public.accounts a
SET account_path  = t.account_path,
    account_level = t.account_level
FROM acct_tree t
WHERE a.id = t.id;

-- Fall back for any orphaned rows (should not exist, but defensive)
UPDATE public.accounts
SET account_path = account_code
WHERE account_path IS NULL;

-- Enforce NOT NULL now that all rows are populated
ALTER TABLE public.accounts
  ALTER COLUMN account_path SET NOT NULL;

-- ── 3. Set is_postable = FALSE for existing parent accounts ───

UPDATE public.accounts
SET is_postable = FALSE
WHERE id IN (
  SELECT DISTINCT parent_account_id
  FROM   public.accounts
  WHERE  parent_account_id IS NOT NULL
);

-- ── 4. Map subledger_type → control_account_type ─────────────

UPDATE public.accounts
SET control_account_type = CASE subledger_type
  WHEN 'customer'    THEN 'AR'
  WHEN 'vendor'      THEN 'AP'
  WHEN 'inventory'   THEN 'INVENTORY'
  WHEN 'fixed_asset' THEN 'FIXED_ASSETS'
  WHEN 'bank'        THEN 'BANK'
  WHEN 'payroll'     THEN 'PAYROLL'
  ELSE                    'NONE'
END;

-- ── 5. Constraints ────────────────────────────────────────────

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_level_bounds CHECK (account_level BETWEEN 1 AND 5),
  ADD CONSTRAINT accounts_control_type_values CHECK (
    control_account_type IN ('AR','AP','INVENTORY','FIXED_ASSETS','BANK','PAYROLL','NONE')
  );

-- ── 6. Trigger: auto-compute level + path on INSERT ──────────

CREATE OR REPLACE FUNCTION public.fn_set_account_level_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_level INTEGER;
  v_parent_path  TEXT;
BEGIN
  IF NEW.parent_account_id IS NOT NULL THEN
    SELECT account_level, account_path
      INTO v_parent_level, v_parent_path
    FROM public.accounts
    WHERE id = NEW.parent_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INTEGRITY_ERROR: Parent account % does not exist.', NEW.parent_account_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_parent_level >= 5 THEN
      RAISE EXCEPTION
        'DEPTH_EXCEEDED: Cannot create a sub-account under a level-5 account (max hierarchy depth is 5).'
        USING ERRCODE = 'P0002';
    END IF;

    NEW.account_level := v_parent_level + 1;
    NEW.account_path  := v_parent_path  || '.' || NEW.account_code;
  ELSE
    NEW.account_level := 1;
    NEW.account_path  := NEW.account_code;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_set_level_path ON public.accounts;
CREATE TRIGGER trg_account_set_level_path
  BEFORE INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_account_level_path();

-- Also recompute when parent_account_id or account_code changes
DROP TRIGGER IF EXISTS trg_account_update_level_path ON public.accounts;
CREATE TRIGGER trg_account_update_level_path
  BEFORE UPDATE OF parent_account_id, account_code ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_account_level_path();

-- ── 7. Trigger: flip parent is_postable when child is added ──

CREATE OR REPLACE FUNCTION public.fn_flip_parent_postable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_account_id IS NOT NULL THEN
    UPDATE public.accounts
    SET    is_postable = FALSE
    WHERE  id = NEW.parent_account_id
      AND  is_postable = TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_flip_parent_postable ON public.accounts;
CREATE TRIGGER trg_account_flip_parent_postable
  AFTER INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_flip_parent_postable();

-- ── 8. Trigger: block journal_lines from posting to non-postable accounts ──

CREATE OR REPLACE FUNCTION public.fn_prevent_posting_non_postable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_postable BOOLEAN;
  v_acct_label  TEXT;
BEGIN
  SELECT is_postable, account_code || ' ' || account_name
    INTO v_is_postable, v_acct_label
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF v_is_postable = FALSE THEN
    RAISE EXCEPTION
      'POSTING_VIOLATION: Account % is a summary/parent account (is_postable = false). Post to one of its child accounts instead.',
      v_acct_label
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_line_postable ON public.journal_lines;
CREATE TRIGGER trg_journal_line_postable
  BEFORE INSERT ON public.journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_posting_non_postable();

-- ── 9. Trigger: keep control_account_type in sync with subledger_type ──

CREATE OR REPLACE FUNCTION public.fn_sync_control_account_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.control_account_type := CASE NEW.subledger_type
    WHEN 'customer'    THEN 'AR'
    WHEN 'vendor'      THEN 'AP'
    WHEN 'inventory'   THEN 'INVENTORY'
    WHEN 'fixed_asset' THEN 'FIXED_ASSETS'
    WHEN 'bank'        THEN 'BANK'
    WHEN 'payroll'     THEN 'PAYROLL'
    ELSE                    'NONE'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_sync_control_type ON public.accounts;
CREATE TRIGGER trg_account_sync_control_type
  BEFORE INSERT OR UPDATE OF subledger_type ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_control_account_type();

-- ── 10. Trigger: enforce parent-child account_type consistency ──

CREATE OR REPLACE FUNCTION public.fn_enforce_account_type_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_type TEXT;
BEGIN
  IF NEW.parent_account_id IS NOT NULL THEN
    SELECT account_type INTO v_parent_type
    FROM   public.accounts
    WHERE  id = NEW.parent_account_id;

    IF v_parent_type IS NOT NULL AND v_parent_type <> NEW.account_type THEN
      RAISE EXCEPTION
        'TYPE_MISMATCH: Child account type "%" must match parent account type "%". Change the parent selection or the account type.',
        NEW.account_type, v_parent_type
        USING ERRCODE = 'P0004';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_type_consistency ON public.accounts;
CREATE TRIGGER trg_account_type_consistency
  BEFORE INSERT OR UPDATE OF account_type, parent_account_id ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enforce_account_type_consistency();

-- ── Column documentation ──────────────────────────────────────

COMMENT ON COLUMN public.accounts.account_level        IS 'Hierarchy depth: 1 = root, maximum 5 levels.';
COMMENT ON COLUMN public.accounts.account_path         IS 'Dot-separated path of account codes from root, e.g. 1000.1100.1110. Used for subtree queries via LIKE.';
COMMENT ON COLUMN public.accounts.is_postable          IS 'FALSE for summary/parent accounts that have children. Journal lines cannot post to non-postable accounts.';
COMMENT ON COLUMN public.accounts.control_account_type IS 'Subledger control classification: AR, AP, INVENTORY, FIXED_ASSETS, BANK, PAYROLL, or NONE. Kept in sync with subledger_type by trigger.';
