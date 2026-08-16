-- Restores the fix from 20260804000000, which 20260816000001/2/3 undid by
-- re-declaring these two functions with STABLE in their headers.
--
-- PostgREST reads a called function's OWN provolatile to decide whether to
-- wrap the request in a READ ONLY transaction. rpc_fs_statement and
-- rpc_fs_coverage both reach fn_fs_eval_statement, which does CREATE TEMP
-- TABLE for its fixed-point scratch state; a transaction's read-only flag is
-- per-transaction, not per-nested-call, so a STABLE entry point makes that
-- CREATE fail with "cannot execute CREATE TABLE in a read-only transaction".
-- Both entry points must therefore be VOLATILE.
--
-- This is invisible to `supabase db query`, which runs a plain SQL session and
-- never applies PostgREST's per-request transaction wrapping — so it must be
-- tested by explicitly opening a READ ONLY transaction (see the assertion at
-- the foot of this file), not by calling the function normally.
--
-- ALTER rather than CREATE OR REPLACE on purpose: the bodies are correct and
-- retyping them is how the last three migrations lost this property.

ALTER FUNCTION public.rpc_fs_statement(text, date, date, date, date) VOLATILE;
ALTER FUNCTION public.rpc_fs_coverage(text, date, date) VOLATILE;

-- rpc_fs_statement_accounts stays STABLE deliberately: it reaches only
-- fn_fs_eval_accounts, which is a pure query with no scratch state, so it is
-- genuinely safe to run in a read-only transaction.

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('rpc_fs_statement', 'rpc_fs_coverage', 'fn_fs_eval_statement')
    AND p.provolatile <> 'v';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These functions reach a CREATE TEMP TABLE and must be VOLATILE, but are not: %', v_bad;
  END IF;
END $$;
