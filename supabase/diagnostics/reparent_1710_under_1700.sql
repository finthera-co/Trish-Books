-- ============================================================================
-- EXPLICIT, OPT-IN RE-PARENTING — 1710 (Name Board) under 1700 (PP&E)
--
-- This is the ONLY confirmed real case. It is intentionally NOT a migration and
-- NOT applied automatically, because re-parenting is data-destructive if wrong.
--
-- Procedure:
--   1. Run the DRY RUN below and review the output (old parent → proposed parent).
--   2. Only after explicit approval, run the APPLY block (uncomment it).
--   3. The hardened trigger from migration 20260613100011 will then automatically
--      flip 1700 to is_postable = FALSE. Verify with the post-checks at the end.
--
-- Multi-tenant: both statements join child↔header on tenant_id, so each tenant's
-- 1710 is linked only to that same tenant's 1700. No cross-tenant writes.
-- ============================================================================

-- ── DRY RUN (review output; changes nothing) ────────────────────────────────
SELECT
  c.tenant_id,
  c.account_code        AS child,
  c.account_name,
  c.parent_account_id   AS current_parent,
  p.id                  AS proposed_parent,
  p.account_code        AS proposed_parent_code
FROM public.accounts c
JOIN public.accounts p
  ON  p.tenant_id    = c.tenant_id
  AND p.account_code = '1700'
WHERE c.account_code = '1710'
  AND (c.parent_account_id IS DISTINCT FROM p.id);


-- ── APPLY (uncomment and run ONLY after the dry-run is approved) ─────────────
-- UPDATE public.accounts c
-- SET    parent_account_id = p.id
-- FROM   public.accounts p
-- WHERE  p.tenant_id    = c.tenant_id
--   AND  p.account_code = '1700'
--   AND  c.account_code = '1710'
--   AND  (c.parent_account_id IS DISTINCT FROM p.id);


-- ── POST-CHECK (run after APPLY) ────────────────────────────────────────────
-- Expect: 1710.parent_account_id = 1700.id, and 1700.is_postable = FALSE
-- (auto-flipped by trg_account_flip_parent_postable).
-- SELECT a.account_code, a.account_name, a.is_postable, a.parent_account_id
-- FROM public.accounts a
-- WHERE a.account_code IN ('1700', '1710')
-- ORDER BY a.tenant_id, a.account_code;
