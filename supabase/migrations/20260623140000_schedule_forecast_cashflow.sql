-- Schedule the daily financial forecasting engine.
--
-- The forecast-cashflow edge function populates public.financial_forecasts
-- (revenue / expense / cash streams), which powers the "Cash Balance Forecast
-- with Confidence Bands" chart and the Forecast dashboard. The function was
-- deployed but never scheduled, so financial_forecasts stayed empty and the
-- chart always rendered its "No forecast data yet. The forecasting engine runs
-- daily at 02:00 UTC." empty state. This migration adds that 02:00 UTC schedule.
--
-- Requires pg_cron + pg_net (enabled in earlier migrations) and the service-role
-- key stored in Supabase Vault under the name 'service_role_key':
--   Dashboard → Project Settings → Vault → New secret
--     name = service_role_key, value = <project service_role key>
-- Stored this way the key is never committed to the repo.
SELECT cron.unschedule('forecast-cashflow-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'forecast-cashflow-daily');

SELECT cron.schedule(
  'forecast-cashflow-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qaxfmvbrqypdipwokkje.supabase.co/functions/v1/forecast-cashflow',
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
