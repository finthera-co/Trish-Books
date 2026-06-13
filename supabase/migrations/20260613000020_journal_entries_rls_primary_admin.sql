-- Fix: opening-balance posting failed with "new row violates row-level security
-- policy for table journal_entries". Provisioned tenant admins are assigned the
-- "Primary Admin" role, but the journal_entries manage-policy only permitted
-- 'Company Admin', 'Accountant', and 'Super Admin' — so Primary Admins could not
-- insert journal entries (the OBE offset posting). Add 'Primary Admin' to the
-- allowed roles. (journal_lines and audit_logs are gated only by tenant, so they
-- were not affected.)
DROP POLICY IF EXISTS "Accountants and Admins can manage journal entries" ON public.journal_entries;

CREATE POLICY "Accountants and Admins can manage journal entries"
  ON public.journal_entries
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role_name() = ANY (ARRAY['Primary Admin', 'Company Admin', 'Accountant', 'Super Admin'])
  );
