-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-SERVICE PROFILE UPDATE
-- public.users has no self-UPDATE policy, and adding one would be a privesc
-- hole: RLS cannot restrict *which columns* a row-level policy lets through,
-- so any "users can update their own row" policy also lets them rewrite their
-- own role_id / tenant_id / status. This RPC is the narrow alternative — it
-- touches first_name / last_name only, always on the caller's own row.
--
-- It also re-syncs users.email from auth.users on every call. A Supabase email
-- change only lands in auth.users (after the user confirms via the emailed
-- links), leaving the app record stale; the profile page calls this with no
-- arguments when it notices the two have diverged.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_first_name text DEFAULT NULL,
  p_last_name  text DEFAULT NULL
)
RETURNS TABLE (id uuid, first_name text, last_name text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth  uuid := auth.uid();
  v_first text := nullif(btrim(p_first_name), '');
  v_last  text := nullif(btrim(p_last_name), '');
  v_email text;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- A supplied-but-blank name is a mistake, not "leave it alone".
  IF p_first_name IS NOT NULL AND v_first IS NULL THEN
    RAISE EXCEPTION 'First name cannot be empty';
  END IF;
  IF p_last_name IS NOT NULL AND v_last IS NULL THEN
    RAISE EXCEPTION 'Last name cannot be empty';
  END IF;
  IF length(v_first) > 100 OR length(v_last) > 100 THEN
    RAISE EXCEPTION 'Name is too long (100 characters max)';
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_auth;

  RETURN QUERY
  UPDATE public.users usr
     SET first_name = COALESCE(v_first, usr.first_name),
         last_name  = COALESCE(v_last,  usr.last_name),
         email      = COALESCE(v_email, usr.email),
         updated_at = now()
   WHERE usr.auth_user_id = v_auth
  RETURNING usr.id, usr.first_name, usr.last_name, usr.email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile found for the signed-in user';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated;

COMMENT ON FUNCTION public.update_my_profile(text, text) IS
  'Self-service: updates the caller''s own first/last name and re-syncs email from auth.users. Called with no arguments it only syncs the email.';
