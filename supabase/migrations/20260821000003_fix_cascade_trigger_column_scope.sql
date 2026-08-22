-- ============================================================
-- Fix: trg_account_cascade_path_to_descendants never fired
--
-- 20260821000002 scoped the trigger to AFTER UPDATE OF account_level,
-- account_path. Postgres's "UPDATE OF <cols>" trigger filter matches the
-- SET-clause column list of the ISSUED statement, not which columns a
-- BEFORE trigger ends up changing in NEW as a side effect. The actual
-- reparent statement only sets parent_account_id (fn_set_account_level_path
-- — a BEFORE trigger — is what derives account_level/account_path from it),
-- so a trigger scoped to those two columns can never fire from a real
-- reparent. Verified empirically: an impersonated-tenant probe reparenting
-- a 2-level subtree showed the descendant's account_path completely
-- unchanged after the move.
--
-- Fix: scope the cascade trigger to the same columns as
-- trg_account_update_level_path (parent_account_id, account_code) — exactly
-- the columns whose change actually causes fn_set_account_level_path to
-- recompute level/path. This also correctly cascades on a plain account_code
-- rename, which changes every descendant's account_path too (it is a
-- dot-join of CODES, not ids), and which the original design missed.
--
-- The nested cascade UPDATE (SET account_level, account_path only) no longer
-- matches this trigger's column list at all, so the whole subtree is walked
-- in the single recursive CTE from the one top-level invocation — the
-- pg_trigger_depth() guard in the function body is now unreachable but kept
-- as documentation/defense-in-depth in case the column list ever changes.
-- ============================================================

DROP TRIGGER IF EXISTS trg_account_cascade_path_to_descendants ON public.accounts;
CREATE TRIGGER trg_account_cascade_path_to_descendants
  AFTER UPDATE OF parent_account_id, account_code ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cascade_account_path_to_descendants();
