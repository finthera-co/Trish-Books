-- ============================================================
-- Cascade account_level/account_path to descendants on reparent
--
-- trg_account_update_level_path (fn_set_account_level_path, BEFORE UPDATE OF
-- parent_account_id, account_code) already recomputes the MOVED row's own
-- level/path correctly. It is FOR EACH ROW on that one row only — moving a
-- node with children leaves every descendant's account_level/account_path
-- stale (still reflecting the old position in the tree).
--
-- This is reachable today, not just via a hypothetical drag-and-drop UI:
-- AccountForm.tsx's "Edit Account" dialog already sends parent_account_id
-- unconditionally on submit, so reparenting any account with children
-- through the existing Edit Account form already triggers this bug.
--
-- Fix: an AFTER UPDATE OF account_level, account_path trigger that walks the
-- moved row's subtree with a recursive CTE and recomputes every descendant
-- in one pass, seeded from the row's own just-finalized NEW values.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_cascade_account_path_to_descendants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The recursive UPDATE below re-fires this same AFTER trigger once per
  -- descendant row it touches. Only the outermost invocation (depth 1) should
  -- walk the subtree — the top-level recursive CTE already computes every
  -- descendant's final level/path in one pass, so nested invocations (depth
  -- > 1, fired by this function's own UPDATE) are re-entrant no-ops. Without
  -- this guard the walk would still converge to the same correct values
  -- (each pass is idempotent), just via a redundant amount of extra work.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.account_level IS DISTINCT FROM OLD.account_level
     OR NEW.account_path IS DISTINCT FROM OLD.account_path THEN
    WITH RECURSIVE descendants AS (
      SELECT id, account_code,
             NEW.account_level + 1 AS new_level,
             NEW.account_path || '.' || account_code AS new_path
      FROM public.accounts
      WHERE parent_account_id = NEW.id

      UNION ALL

      SELECT a.id, a.account_code,
             d.new_level + 1,
             d.new_path || '.' || a.account_code
      FROM public.accounts a
      JOIN descendants d ON a.parent_account_id = d.id
    )
    UPDATE public.accounts a
    SET account_level = d.new_level,
        account_path  = d.new_path
    FROM descendants d
    WHERE a.id = d.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_cascade_path_to_descendants ON public.accounts;
CREATE TRIGGER trg_account_cascade_path_to_descendants
  AFTER UPDATE OF account_level, account_path ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cascade_account_path_to_descendants();

COMMENT ON FUNCTION public.fn_cascade_account_path_to_descendants() IS
  'Cascades account_level/account_path to every descendant when a row''s own level/path changes (i.e. after a reparent). Companion to fn_set_account_level_path, which only fixes the moved row itself.';

-- ── Repair any accounts already left stale by a reparent before this fix ──
-- Recomputes every account's level/path bottom-up from actual parent
-- chains, independent of what is currently stored. Self-healing, not
-- incremental, so it also fixes any drift regardless of cause.
WITH RECURSIVE correct_paths AS (
  SELECT id, account_code, parent_account_id,
         1 AS correct_level,
         account_code AS correct_path
  FROM public.accounts
  WHERE parent_account_id IS NULL

  UNION ALL

  SELECT a.id, a.account_code, a.parent_account_id,
         c.correct_level + 1,
         c.correct_path || '.' || a.account_code
  FROM public.accounts a
  JOIN correct_paths c ON a.parent_account_id = c.id
)
UPDATE public.accounts a
SET account_level = c.correct_level,
    account_path  = c.correct_path
FROM correct_paths c
WHERE a.id = c.id
  AND (a.account_level IS DISTINCT FROM c.correct_level
       OR a.account_path IS DISTINCT FROM c.correct_path);
