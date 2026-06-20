-- ════════════════════════════════════════════════════════════════════════════
-- EMPLOYEE SELF-SERVICE PORTAL
-- Each employee gets a login (role 'Employee') linked via employees.user_id and
-- sees ONLY their own attendance / leave / payslips. RLS is the real boundary:
-- the existing "tenant members read/write" policies treat an Employee as a tenant
-- member and would expose everyone, so we carve the Employee role OUT of every
-- broad policy and add narrow self-scoped policies keyed on get_user_employee_id().
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. employees: login link, middle name, photo ────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS photo_url   text,
  ADD COLUMN IF NOT EXISTS user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_user_id
  ON public.employees (user_id) WHERE user_id IS NOT NULL;

-- ── 2. Employee role ────────────────────────────────────────────────────────
INSERT INTO public.roles (role_name, description)
VALUES ('Employee', 'Self-service portal: own attendance, payslips and leave')
ON CONFLICT DO NOTHING;

-- ── 3. employee-photos storage bucket (public, mirrors invoice-assets) ───────
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-photos', 'employee-photos', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Employee photos are publicly readable"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'employee-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can upload employee photos"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'employee-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can update employee photos"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'employee-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can delete employee photos"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'employee-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Resolve the logged-in user's own employee row ────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM public.employees e
  JOIN public.users u ON u.id = e.user_id
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_user_employee_id() TO authenticated;

-- ── 4b. employees: an Employee may read ONLY their own profile (not coworkers'
--       salaries / NIC / bank details) and may not manage records. ─────────────
DROP POLICY IF EXISTS "Users can view own tenant employees" ON public.employees;
CREATE POLICY "Users can view own tenant employees"
  ON public.employees FOR SELECT
  USING ((tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Authorized users can manage employees" ON public.employees;
CREATE POLICY "Authorized users can manage employees"
  ON public.employees FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

DO $$ BEGIN
  CREATE POLICY "Employees read own profile"
    ON public.employees FOR SELECT TO authenticated
    USING (id = public.get_user_employee_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. attendance_records: exclude Employee from broad policies, add self read ─
DROP POLICY IF EXISTS "Tenant members read attendance" ON public.attendance_records;
CREATE POLICY "Tenant members read attendance"
  ON public.attendance_records FOR SELECT TO authenticated
  USING ((tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Tenant members write attendance" ON public.attendance_records;
CREATE POLICY "Tenant members write attendance"
  ON public.attendance_records FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

DO $$ BEGIN
  CREATE POLICY "Employees read own attendance"
    ON public.attendance_records FOR SELECT TO authenticated
    USING (employee_id = public.get_user_employee_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. leave_requests: exclude Employee broadly, add self read + self apply ──
DROP POLICY IF EXISTS "Tenant members read leave requests" ON public.leave_requests;
CREATE POLICY "Tenant members read leave requests"
  ON public.leave_requests FOR SELECT TO authenticated
  USING ((tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Tenant members write leave requests" ON public.leave_requests;
CREATE POLICY "Tenant members write leave requests"
  ON public.leave_requests FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

DO $$ BEGIN
  CREATE POLICY "Employees read own leave requests"
    ON public.leave_requests FOR SELECT TO authenticated
    USING (employee_id = public.get_user_employee_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Employees may file (and only file) their own pending requests.
DO $$ BEGIN
  CREATE POLICY "Employees apply for own leave"
    ON public.leave_requests FOR INSERT TO authenticated
    WITH CHECK (tenant_id = public.get_user_tenant_id()
                AND employee_id = public.get_user_employee_id()
                AND status = 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 7. leave_balances: exclude Employee broadly, add self read ──────────────
DROP POLICY IF EXISTS "leave_balances_select" ON public.leave_balances;
CREATE POLICY "leave_balances_select"
  ON public.leave_balances FOR SELECT TO authenticated
  USING ((tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
         OR public.is_super_admin());

DROP POLICY IF EXISTS "leave_balances_manage" ON public.leave_balances;
CREATE POLICY "leave_balances_manage"
  ON public.leave_balances FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

DO $$ BEGIN
  CREATE POLICY "Employees read own leave balances"
    ON public.leave_balances FOR SELECT TO authenticated
    USING (employee_id = public.get_user_employee_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 8. leave_types & holidays: employees may READ (catalogue + holiday calendar),
--      but only non-Employee tenant members may WRITE. SELECT stays open. ─────
DROP POLICY IF EXISTS "Tenant members write leave types" ON public.leave_types;
CREATE POLICY "Tenant members write leave types"
  ON public.leave_types FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

DROP POLICY IF EXISTS "Tenant members write holidays" ON public.holidays;
CREATE POLICY "Tenant members write holidays"
  ON public.holidays FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

-- ── 9. payroll: exclude Employee from broad read/manage, add own-payslip read ─
DROP POLICY IF EXISTS "Users can view own tenant payroll runs" ON public.payroll_runs;
CREATE POLICY "Users can view own tenant payroll runs"
  ON public.payroll_runs FOR SELECT TO authenticated
  USING ((tenant_id = get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
         OR is_super_admin());

DROP POLICY IF EXISTS "Authorized users can manage payroll runs" ON public.payroll_runs;
CREATE POLICY "Authorized users can manage payroll runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id() AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (tenant_id = get_user_tenant_id() AND public.get_user_role_name() <> 'Employee');

DROP POLICY IF EXISTS "Users can view own tenant payroll run items" ON public.payroll_run_items;
CREATE POLICY "Users can view own tenant payroll run items"
  ON public.payroll_run_items FOR SELECT TO authenticated
  USING ((run_id IN (SELECT id FROM public.payroll_runs WHERE tenant_id = get_user_tenant_id())
          AND public.get_user_role_name() <> 'Employee')
         OR is_super_admin());

DROP POLICY IF EXISTS "Authorized users can manage payroll run items" ON public.payroll_run_items;
CREATE POLICY "Authorized users can manage payroll run items"
  ON public.payroll_run_items FOR ALL TO authenticated
  USING (run_id IN (SELECT id FROM public.payroll_runs WHERE tenant_id = get_user_tenant_id())
         AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (run_id IN (SELECT id FROM public.payroll_runs WHERE tenant_id = get_user_tenant_id())
              AND public.get_user_role_name() <> 'Employee');

-- Own payslip rows
DO $$ BEGIN
  CREATE POLICY "Employees read own payroll items"
    ON public.payroll_run_items FOR SELECT TO authenticated
    USING (employee_id = public.get_user_employee_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Runs that contain one of the employee's payslip rows
DO $$ BEGIN
  CREATE POLICY "Employees read own payroll runs"
    ON public.payroll_runs FOR SELECT TO authenticated
    USING (id IN (SELECT run_id FROM public.payroll_run_items
                  WHERE employee_id = public.get_user_employee_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payroll_item_details: exclude Employee from broad, add own-payslip detail read
DROP POLICY IF EXISTS "Authorized users can manage payroll item details" ON public.payroll_item_details;
CREATE POLICY "Authorized users can manage payroll item details"
  ON public.payroll_item_details FOR ALL TO authenticated
  USING (run_item_id IN (
           SELECT pri.id FROM public.payroll_run_items pri
           JOIN public.payroll_runs pr ON pr.id = pri.run_id
           WHERE pr.tenant_id = get_user_tenant_id()
         ) AND public.get_user_role_name() <> 'Employee')
  WITH CHECK (run_item_id IN (
           SELECT pri.id FROM public.payroll_run_items pri
           JOIN public.payroll_runs pr ON pr.id = pri.run_id
           WHERE pr.tenant_id = get_user_tenant_id()
         ) AND public.get_user_role_name() <> 'Employee');

DROP POLICY IF EXISTS "Users can view own tenant payroll item details" ON public.payroll_item_details;
CREATE POLICY "Users can view own tenant payroll item details"
  ON public.payroll_item_details FOR SELECT TO authenticated
  USING (run_item_id IN (
           SELECT pri.id FROM public.payroll_run_items pri
           JOIN public.payroll_runs pr ON pr.id = pri.run_id
           WHERE pr.tenant_id = get_user_tenant_id()
         ) AND public.get_user_role_name() <> 'Employee');

DO $$ BEGIN
  CREATE POLICY "Employees read own payroll item details"
    ON public.payroll_item_details FOR SELECT TO authenticated
    USING (run_item_id IN (
             SELECT id FROM public.payroll_run_items
             WHERE employee_id = public.get_user_employee_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
