-- Schedule the storage-quota-reconcile edge function.
--
-- It lists every tenant-scoped Storage bucket and sums object sizes into
-- tenant_storage_usage, then fires an in-app notification at 80% (warning)
-- and 100% (full) of the tenant's plan quota. Runs every 6 hours rather than
-- daily like the other cron jobs: this is an O(all objects) listing scan per
-- tenant per bucket, materially heavier than a row-scan job, but storage
-- usage doesn't need minute-level freshness either.
--
-- Requires pg_cron + pg_net (enabled in earlier migrations) and the
-- service-role key stored in Supabase Vault under 'service_role_key' (see
-- schedule_forecast_cashflow.sql for how to set it).
SELECT cron.unschedule('storage-quota-reconcile')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-quota-reconcile');

SELECT cron.schedule(
  'storage-quota-reconcile',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://nvelymrdytmoxfokxnka.supabase.co/functions/v1/storage-quota-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
