-- Schedule the generate-recurring-bills edge function.
--
-- Daily at 02:35 UTC (5 minutes after generate-recurring-invoices, its AR
-- counterpart, to avoid both jobs hitting pg_cron/pg_net at the exact same
-- second). Mints draft bills from active recurring_bill_templates that are
-- due, auto-posting the ones flagged auto_post.
--
-- IMPORTANT: targets the LIVE project ref (nvelymrdytmoxfokxnka), unlike
-- generate-recurring-invoices-daily and 2 other existing cron jobs, which
-- mistakenly POST to a dead project ref (qaxfmvbrqypdipwokkje) and silently
-- fail — do not copy that URL by mistake if this job is ever touched again.
SELECT cron.unschedule('generate-recurring-bills-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-recurring-bills-daily');

SELECT cron.schedule(
  'generate-recurring-bills-daily',
  '35 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://nvelymrdytmoxfokxnka.supabase.co/functions/v1/generate-recurring-bills',
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
