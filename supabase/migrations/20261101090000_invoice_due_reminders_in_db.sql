-- Invoice due-date reminders, run inside the database.
--
-- The original cron (20260615000001) POSTed to the invoice-due-reminders edge
-- function on the DEAD project ref, authenticated with a Vault secret
-- ('service_role_key') that was never created, so every run 401'd and not a
-- single reminder was ever sent. The scan is pure SQL (read ar_transactions,
-- insert notifications), so pg_cron now calls it directly: no HTTP hop, no
-- secret, no project URL to drift.
--
-- Behaviour changes vs the edge function:
--   • Band catch-up instead of exact-day matching. Each invoice gets one alert
--     per band (due ≤7d, ≤3d, ≤1d, today, 1d/7d/14d/30d overdue); a missed cron
--     day no longer silently skips a milestone. Dedupe is a log keyed on
--     (ar_transaction, band) rather than matching message text.
--   • Voided / draft invoices are excluded (a voided invoice can still have an
--     OPEN ar_transactions row).
--   • The link opens the specific invoice (/sales/invoices?invoice=<id>).

CREATE TABLE IF NOT EXISTS public.invoice_reminder_log (
  ar_transaction_id uuid NOT NULL REFERENCES public.ar_transactions(id) ON DELETE CASCADE,
  milestone         int  NOT NULL,
  tenant_id         uuid NOT NULL,
  notified_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ar_transaction_id, milestone)
);

-- Internal bookkeeping only: RLS on with no policies, no client grants.
ALTER TABLE public.invoice_reminder_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_reminder_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_invoice_due_reminders(p_today date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanned int;
  v_created int;
BEGIN
  DROP TABLE IF EXISTS _reminder_due;
  CREATE TEMP TABLE _reminder_due ON COMMIT DROP AS
  SELECT a.id, a.tenant_id, a.document_id, a.document_ref, a.outstanding_amount,
         (a.due_date - p_today) AS off,
         -- band = the nearest milestone at or after today's offset
         (SELECT min(m) FROM unnest(ARRAY[7, 3, 1, 0, -1, -7, -14, -30]) m
           WHERE m >= (a.due_date - p_today)) AS milestone
    FROM ar_transactions a
    JOIN invoices i ON i.id = a.document_id AND i.status = 'posted'
   WHERE a.transaction_type = 'INVOICE'
     AND a.status IN ('OPEN', 'PARTIALLY_PAID')
     AND a.outstanding_amount > 0
     AND a.due_date BETWEEN p_today - 30 AND p_today + 7;

  GET DIAGNOSTICS v_scanned = ROW_COUNT;

  WITH logged AS (
    INSERT INTO invoice_reminder_log (ar_transaction_id, milestone, tenant_id)
    SELECT id, milestone, tenant_id FROM _reminder_due
    ON CONFLICT DO NOTHING
    RETURNING ar_transaction_id
  )
  INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
  SELECT d.tenant_id,
         NULL,                         -- tenant-wide broadcast
         'warning',
         CASE WHEN d.off < 0 THEN 'Invoice overdue' ELSE 'Invoice due soon' END,
         format('Invoice %s (outstanding %s) %s.',
                coalesce(d.document_ref, ''),
                to_char(d.outstanding_amount, 'FM999,999,999,999,990.00'),
                CASE
                  WHEN d.off = 0  THEN 'is due today'
                  WHEN d.off = -1 THEN 'is 1 day overdue'
                  WHEN d.off < 0  THEN format('is %s days overdue', -d.off)
                  WHEN d.off = 1  THEN 'is due tomorrow'
                  ELSE format('is due in %s days', d.off)
                END),
         '/sales/invoices?invoice=' || d.document_id
    FROM _reminder_due d
    JOIN logged l ON l.ar_transaction_id = d.id;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'scanned', v_scanned, 'created', v_created);
END $$;

REVOKE EXECUTE ON FUNCTION public.run_invoice_due_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_invoice_due_reminders(date) TO service_role;

-- ── Reschedule (08:00 UTC daily) ────────────────────────────────────────────
SELECT cron.unschedule('invoice-due-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoice-due-reminders');

SELECT cron.schedule(
  'invoice-due-reminders',
  '0 8 * * *',
  $$ SELECT public.run_invoice_due_reminders(); $$
);
