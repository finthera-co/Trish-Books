-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY FIX — self-service privilege escalation via open users/tenants INSERT.
--
-- Before this migration, the policies "Anyone can create users during signup"
-- and "Anyone can create tenants during signup" both had WITH CHECK (true) for
-- role `public`. Combined with a world-readable `roles` table and no unique
-- constraint on users.auth_user_id, any signed-up user could INSERT a users row
-- mapping their own auth.uid() to the Super Admin role_id and any tenant_id,
-- then is_super_admin() would return true → full cross-tenant takeover.
--
-- Fix: remove the open INSERT policies and provision the signup tenant+user
-- through a SECURITY DEFINER function that forces role = Company Admin and pins
-- auth_user_id to the caller. A unique index on auth_user_id blocks the
-- "add a second Super Admin row" trick.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Remove the wide-open INSERT policies (client no longer inserts these directly).
DROP POLICY IF EXISTS "Anyone can create users during signup" ON public.users;
DROP POLICY IF EXISTS "Anyone can create tenants during signup" ON public.tenants;
-- The remaining loose tenants INSERT policy also allowed arbitrary self-service
-- tenant creation; signup now goes through signup_provision() and Super Admins
-- insert via the is_super_admin() ALL policy, so this is no longer needed.
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;

-- 2. One users row per auth user. Guarded so the migration fails loudly if a
--    duplicate somehow already exists (it should not).
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_key
  ON public.users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 3. Server-side signup provisioning. Runs as owner (SECURITY DEFINER) so it can
--    write the tenant + user row after RLS INSERT was locked down, but it forces
--    the role to Company Admin and the auth_user_id to the calling user, so it
--    cannot be used to escalate.
CREATE OR REPLACE FUNCTION public.signup_provision(
  p_company_name text,
  p_first_name   text,
  p_last_name    text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_email     text;
  v_role_id   uuid;
  v_plan_id   uuid;
  v_tenant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  -- Refuse to provision a caller who already has a user record. This blocks an
  -- existing tenant member from minting a second (higher-privileged) account.
  IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'User already provisioned';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'Company Admin' LIMIT 1;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Company Admin role not found';
  END IF;

  SELECT id INTO v_plan_id FROM public.subscription_plans WHERE name = 'Starter' LIMIT 1;

  INSERT INTO public.tenants (company_name, subscription_plan_id)
  VALUES (btrim(p_company_name), v_plan_id)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.users (auth_user_id, tenant_id, email, first_name, last_name, role_id)
  VALUES (v_uid, v_tenant_id, v_email, p_first_name, p_last_name, v_role_id);

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.signup_provision(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.signup_provision(text, text, text) TO authenticated;
