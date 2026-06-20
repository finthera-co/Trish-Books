-- ════════════════════════════════════════════════════════════════════════════
-- PAYSLIP PUBLISH GATE
-- Posting a payroll run to the GL no longer makes payslips visible to employees.
-- The admin must explicitly "Publish payslips" (sets payslips_published_at), and
-- only then do the Employee self-SELECT policies expose the slip. Admin/standard
-- visibility is unchanged.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS payslips_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES public.users(id);

-- Re-create the three Employee self-SELECT policies to additionally require the
-- parent run to be published.
DROP POLICY IF EXISTS "Employees read own payroll items" ON public.payroll_run_items;
CREATE POLICY "Employees read own payroll items"
  ON public.payroll_run_items FOR SELECT TO authenticated
  USING (employee_id = public.get_user_employee_id()
         AND run_id IN (SELECT id FROM public.payroll_runs WHERE payslips_published_at IS NOT NULL));

DROP POLICY IF EXISTS "Employees read own payroll runs" ON public.payroll_runs;
CREATE POLICY "Employees read own payroll runs"
  ON public.payroll_runs FOR SELECT TO authenticated
  USING (payslips_published_at IS NOT NULL
         AND id IN (SELECT run_id FROM public.payroll_run_items
                    WHERE employee_id = public.get_user_employee_id()));

DROP POLICY IF EXISTS "Employees read own payroll item details" ON public.payroll_item_details;
CREATE POLICY "Employees read own payroll item details"
  ON public.payroll_item_details FOR SELECT TO authenticated
  USING (run_item_id IN (
           SELECT pri.id FROM public.payroll_run_items pri
           JOIN public.payroll_runs pr ON pr.id = pri.run_id
           WHERE pri.employee_id = public.get_user_employee_id()
             AND pr.payslips_published_at IS NOT NULL));
