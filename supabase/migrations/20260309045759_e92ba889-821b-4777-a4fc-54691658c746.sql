
CREATE OR REPLACE FUNCTION public.check_user_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role and postgres (used by admin client) to bypass checks
  IF current_setting('role', true) = 'service_role' OR current_setting('request.jwt.claims', true) IS NULL THEN
    RETURN NEW;
  END IF;

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
$function$;
