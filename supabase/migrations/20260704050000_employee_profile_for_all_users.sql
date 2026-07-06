-- ═══════════════════════════════════════════════════════════════════════════
-- EMPLOYEE PROFILE FOR EVERY USER
-- Every tenant login (any role — admin, accountant, employee, …) gets a linked
-- employees row so the /me self-service portal (dashboard, leave requests,
-- remote check-in/out) works for everyone.
--
--   1. Trigger on public.users: after any user is created, link an existing
--      unlinked employee record by email, or create a bare employee profile.
--      One trigger covers every creation path (create-user, signup_provision,
--      provision-tenant, provision-google-user, provision-employee).
--   2. Backfill: link/create profiles for all existing tenant users.
--
-- Note: provision-employee now UPDATES the trigger-created row with the full
-- HR payload instead of inserting (employees.user_id has a unique index).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Auto-provision an employee profile when a user is created ────────────
CREATE OR REPLACE FUNCTION public.ensure_employee_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked_id uuid;
BEGIN
  -- Super admins (no tenant) don't get employee profiles
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Prefer linking an existing employee record with the same email that has
  -- no login yet (HR often creates the employee before the account).
  UPDATE public.employees e
  SET user_id = NEW.id
  WHERE e.id = (
    SELECT e2.id FROM public.employees e2
    WHERE e2.tenant_id = NEW.tenant_id
      AND e2.user_id IS NULL
      AND lower(e2.email) = lower(NEW.email)
    ORDER BY e2.created_at
    LIMIT 1
  )
  RETURNING e.id INTO linked_id;

  IF linked_id IS NULL THEN
    INSERT INTO public.employees (tenant_id, user_id, first_name, last_name, email)
    VALUES (NEW.tenant_id, NEW.id, NEW.first_name, COALESCE(NEW.last_name, ''), NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_employee_profile ON public.users;
CREATE TRIGGER trg_ensure_employee_profile
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.ensure_employee_profile();

-- ── 2. Backfill existing users ───────────────────────────────────────────────
-- 2a. Link unlinked employee records to users by (tenant, email) —
--     at most one employee per user (user_id has a unique index)
UPDATE public.employees e
SET user_id = m.user_id
FROM (
  SELECT DISTINCT ON (u.id) e2.id AS emp_id, u.id AS user_id
  FROM public.users u
  JOIN public.employees e2
    ON e2.tenant_id = u.tenant_id
   AND e2.user_id IS NULL
   AND lower(e2.email) = lower(u.email)
  WHERE u.tenant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.employees x WHERE x.user_id = u.id)
  ORDER BY u.id, e2.created_at
) m
WHERE e.id = m.emp_id;

-- 2b. Create bare profiles for tenant users that still have none
INSERT INTO public.employees (tenant_id, user_id, first_name, last_name, email)
SELECT u.tenant_id, u.id, u.first_name, COALESCE(u.last_name, ''), u.email
FROM public.users u
WHERE u.tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = u.id);
