-- Prune rate-limit counters nightly. They are operational telemetry, not
-- accounting data, so anything older than a couple of days is dead weight.
-- pg_cron and pg_net are already enabled on this project (verified before
-- writing this migration), so no extension is created here.
--
-- Idempotent: unschedule first so a re-run cannot raise on a duplicate jobname.

DO $$
BEGIN
  PERFORM cron.unschedule('prune-rate-limit-counters');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- not scheduled yet: nothing to remove
END;
$$;

SELECT cron.schedule(
  'prune-rate-limit-counters',
  '17 3 * * *',
  $$SELECT public.prune_rate_limit_counters(interval '2 days')$$
);
