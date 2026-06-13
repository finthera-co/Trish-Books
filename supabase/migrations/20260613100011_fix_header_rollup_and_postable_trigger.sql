-- ============================================================================
-- Fix header roll-up display + harden the parent is_postable trigger
--
-- Context: header (non-postable) accounts roll up the sum of their postable
-- children in the Chart of Accounts UI (computeRollupBalance). That logic is
-- correct. The defect is in the data/trigger layer:
--   • Some parent accounts are still is_postable = TRUE, so the UI treats them
--     as leaves and shows their own (zero) balance instead of the roll-up.
--   • The original fn_flip_parent_postable trigger (20260608000001) only fired
--     AFTER INSERT, so re-parenting a child at runtime never flipped the NEW
--     parent to non-postable.
--
-- This migration performs ONLY safe, non-inferential fixes:
--   2a. Force is_postable = FALSE for any account that is referenced as a
--       parent. (Definitionally correct — a parent can never be postable.)
--   2b. Recreate the trigger to fire on INSERT *and* UPDATE OF parent_account_id.
--
-- It does NOT re-parent anything by code-prefix inference — that is explicit and
-- opt-in (see supabase/diagnostics/reparent_1710_under_1700.sql).
-- ============================================================================

-- ── 2a. Backfill: every parent must be non-postable ─────────────────────────
-- Scoped within the accounts table; parent and child always share tenant_id,
-- so this never crosses tenants.
UPDATE public.accounts p
SET    is_postable = FALSE
WHERE  p.is_postable = TRUE
  AND  EXISTS (
    SELECT 1
    FROM public.accounts c
    WHERE c.parent_account_id = p.id
  );

-- ── 2b. Harden the parent-flip trigger (INSERT + re-parent UPDATE) ──────────
CREATE OR REPLACE FUNCTION public.fn_flip_parent_postable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A parent account can never be postable. Whenever a child is inserted OR
  -- re-parented, force the NEW parent to is_postable = FALSE.
  --
  -- Idempotent & non-recursive: the inner UPDATE only touches is_postable
  -- (never parent_account_id), so it cannot re-fire this UPDATE OF
  -- parent_account_id trigger; the `AND is_postable = TRUE` guard makes it a
  -- no-op when the parent is already non-postable.
  IF NEW.parent_account_id IS NOT NULL THEN
    UPDATE public.accounts
    SET    is_postable = FALSE
    WHERE  id = NEW.parent_account_id
      AND  is_postable = TRUE;
  END IF;

  -- DECISION: on re-parent (UPDATE), we deliberately do NOT flip the OLD parent
  -- back to is_postable = TRUE, even when it just lost its last child. Flipping
  -- a former header back to postable would re-open it to erroneous DIRECT
  -- journal postings. Such now-childless "empty headers" are instead surfaced
  -- by the read-only diagnostic (supabase/diagnostics/header_rollup_diagnostic.sql)
  -- for explicit human review. We leave OLD parent untouched here.
  RETURN NEW;
END;
$$;

-- Recreate the trigger to cover INSERT and re-parenting UPDATEs.
DROP TRIGGER IF EXISTS trg_account_flip_parent_postable ON public.accounts;
CREATE TRIGGER trg_account_flip_parent_postable
  AFTER INSERT OR UPDATE OF parent_account_id ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_flip_parent_postable();

COMMENT ON FUNCTION public.fn_flip_parent_postable() IS
  'Forces a parent account to is_postable = FALSE when a child is inserted or re-parented. Fires AFTER INSERT OR UPDATE OF parent_account_id. Never auto-flips a former parent back to postable (see 20260613100011 migration comment).';
