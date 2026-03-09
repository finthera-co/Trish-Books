CREATE OR REPLACE FUNCTION public.check_user_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id 
  FROM public.users 
  WHERE auth_user_id = auth.uid() LIMIT 1;

  IF TG_TABLE_NAME = 'users' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
      VALUES ('User Created', TG_TABLE_NAME, NEW.id, v_user_id, COALESCE(v_tenant_id, NEW.tenant_id), row_to_json(NEW));
    ELSIF TG_OP = 'UPDATE' AND OLD.role_id IS DISTINCT FROM NEW.role_id THEN
      INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
      VALUES ('Role Changed', TG_TABLE_NAME, NEW.id, v_user_id, COALESCE(v_tenant_id, NEW.tenant_id), jsonb_build_object('old_role', OLD.role_id, 'new_role', NEW.role_id));
    END IF;
  ELSIF TG_TABLE_NAME = 'fiscal_periods' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'open' AND NEW.status = 'closed' THEN
      INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
      VALUES ('Period Closed', TG_TABLE_NAME, NEW.id, v_user_id, v_tenant_id, row_to_json(NEW));
    END IF;
  ELSIF TG_TABLE_NAME = 'journal_entries' THEN
    IF TG_OP = 'UPDATE' AND OLD.status != 'voided' AND NEW.status = 'voided' THEN
      INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
      VALUES ('Journal Voided', TG_TABLE_NAME, NEW.id, v_user_id, v_tenant_id, row_to_json(NEW));
    END IF;
  END IF;
  
  RETURN NULL;
END;
$$;