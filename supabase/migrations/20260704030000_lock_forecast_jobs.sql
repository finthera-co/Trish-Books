-- ═══════════════════════════════════════════════════════════════════════════
-- Restrict forecast_jobs visibility to Super Admins.
--
-- forecast_jobs is a GLOBAL cron/operational log (run times, rows processed,
-- error_message, logs) — not per-tenant customer data. Its SELECT policy was
-- `USING (true)` for every authenticated user, so any tenant user could read
-- internal error strings and job logs. Inserts are done by the cron/service
-- role (which bypasses RLS), so tightening reads has no functional impact.
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Authenticated users can view forecast_jobs" ON public.forecast_jobs;

CREATE POLICY "Super admins can view forecast_jobs" ON public.forecast_jobs
  FOR SELECT TO authenticated
  USING (is_super_admin());
