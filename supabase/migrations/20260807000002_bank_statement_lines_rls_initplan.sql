-- Hoist get_user_tenant_id() out of the bank_statement_lines row filter.
--
-- Same fix, same reasoning as 20260729000007 — that migration hoisted the
-- policies on the journal read path and noted every other table wants the same
-- treatment. bank_statement_lines is now on that path: the account register
-- reads it for the cheque number / payee, and searching the register scans it
-- for a matching cheque or payee. Measured as `authenticated` with the
-- unhoisted policy, that scan alone was 530ms of a 679ms query:
--
--   Bitmap Heap Scan on bank_statement_lines (actual time=13.117..530.629 rows=21)
--     Filter: ((tenant_id = get_user_tenant_id()) AND (voucher_no ~~* '%…%' OR name ~~* '%…%'))
--     Rows Removed by Filter: 34970
--
-- get_user_tenant_id() is STABLE and takes no arguments, so wrapping it in a
-- scalar subquery changes only when it is evaluated (once, as an InitPlan),
-- never what it returns. The policy grants and denies exactly what it did.
DROP POLICY IF EXISTS "bank_statement_lines tenant all" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines tenant all"
  ON public.bank_statement_lines FOR ALL
  USING (tenant_id = (SELECT public.get_user_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.get_user_tenant_id()));
