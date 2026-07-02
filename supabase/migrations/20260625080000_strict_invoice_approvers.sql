-- ─────────────────────────────────────────────────────────────────────────────
-- Strict approver routing
--
-- When a tenant appoints specific approvers, ONLY those appointed users may
-- approve — owners and other employees cannot (unless they are appointed).
-- Only when NO approvers are appointed does approval fall back to the owner(s):
-- Primary Admin / Super Admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eligible_invoice_approvers(p_tenant_id UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH appointed AS (
    SELECT invoice_approver_ids AS ids FROM public.account_settings WHERE tenant_id = p_tenant_id
  ),
  has_appointed AS (
    SELECT (ids IS NOT NULL AND array_length(ids, 1) > 0) AS yes FROM appointed
  ),
  appointed_users AS (
    -- Exactly the appointed users (active, in this tenant).
    SELECT u.id FROM public.users u, appointed a
    WHERE u.tenant_id = p_tenant_id
      AND a.ids IS NOT NULL AND array_length(a.ids, 1) > 0
      AND u.id = ANY(a.ids)
  ),
  owner_fallback AS (
    -- Only used when nobody is appointed.
    SELECT u.id FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.tenant_id = p_tenant_id
      AND r.role_name IN ('Primary Admin','Super Admin')
      AND NOT (SELECT yes FROM has_appointed)
  )
  SELECT id FROM appointed_users
  UNION
  SELECT id FROM owner_fallback;
$$;
GRANT EXECUTE ON FUNCTION public.eligible_invoice_approvers(UUID) TO authenticated, service_role;
