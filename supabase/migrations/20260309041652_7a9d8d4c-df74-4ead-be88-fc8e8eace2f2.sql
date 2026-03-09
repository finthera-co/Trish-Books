-- 1. Lock down Tenant creation (limit to 1 tenant per user)
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
CREATE POLICY "Authenticated users can create tenants" ON public.tenants 
FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL AND 
  NOT EXISTS (
    SELECT 1 FROM public.users 
    WHERE auth_user_id = auth.uid() 
    AND role_id = (SELECT id FROM public.roles WHERE role_name = 'Company Admin')
  )
);

-- 2. Server-side role enforcement on User Creation (prevent privilege escalation)
CREATE OR REPLACE FUNCTION public.check_user_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF public.get_user_role_name() = 'Company Admin' THEN
    IF NEW.tenant_id != public.get_user_tenant_id() THEN
      RAISE EXCEPTION 'Cannot create users in other tenants';
    END IF;
    IF NEW.role_id = (SELECT id FROM public.roles WHERE role_name = 'Super Admin') THEN
      RAISE EXCEPTION 'Cannot create Super Admin users';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.auth_user_id = auth.uid() THEN
    IF NEW.role_id = (SELECT id FROM public.roles WHERE role_name = 'Super Admin') THEN
      RAISE EXCEPTION 'Security Error: Cannot self-register as Super Admin';
    END IF;
    
    IF NEW.role_id = (SELECT id FROM public.roles WHERE role_name = 'Company Admin') THEN
       IF EXISTS (SELECT 1 FROM public.users WHERE tenant_id = NEW.tenant_id) THEN
         RAISE EXCEPTION 'Security Error: Cannot claim Company Admin for existing tenant';
       END IF;
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unauthorized user insert';
END;
$$;

DROP TRIGGER IF EXISTS enforce_user_insert ON public.users;
CREATE TRIGGER enforce_user_insert
BEFORE INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.check_user_insert();

-- 3. Restrict Journal Entries to Accountants and Admins
DROP POLICY IF EXISTS "Authorized users can manage journal entries" ON public.journal_entries;
CREATE POLICY "Accountants and Admins can manage journal entries" ON public.journal_entries 
FOR ALL 
USING (
  tenant_id = public.get_user_tenant_id() AND 
  (public.get_user_role_name() IN ('Company Admin', 'Accountant', 'Super Admin'))
);

-- 4. Attach Audit Triggers to capture critical actions
DROP TRIGGER IF EXISTS audit_users_changes ON public.users;
CREATE TRIGGER audit_users_changes
  AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS audit_fiscal_periods_changes ON public.fiscal_periods;
CREATE TRIGGER audit_fiscal_periods_changes
  AFTER UPDATE ON public.fiscal_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS audit_journal_entries_changes ON public.journal_entries;
CREATE TRIGGER audit_journal_entries_changes
  AFTER UPDATE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.log_audit_event();