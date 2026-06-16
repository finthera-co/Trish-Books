-- Invoice due-date tracking + reminder cron.
--
-- Persists per-invoice payment terms (the customer default is the fallback),
-- guarantees a due_date on every invoice, and schedules a daily edge-function
-- scan that drops "due soon / overdue" notifications.

-- ── Per-invoice payment terms ───────────────────────────────────────────────
-- customers.payment_terms already exists (default 'net_30'); mirror it onto the
-- invoice so a draft keeps the term it was created with even if the customer's
-- default later changes.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'net_30';

-- term code -> days
CREATE OR REPLACE FUNCTION public.payment_term_days(p_term text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_term = 'due_on_receipt' THEN 0
    WHEN p_term ~ '^net_\d+$' THEN substring(p_term from 'net_(\d+)')::int
    ELSE 30
  END;
$$;

-- Safety net: if an invoice is inserted without a due_date, derive it from the
-- issue date + the term. The UI also computes this client-side.
CREATE OR REPLACE FUNCTION public.set_invoice_due_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := COALESCE(NEW.issue_date, CURRENT_DATE)
                    + (public.payment_term_days(NEW.payment_terms) || ' days')::interval;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_invoice_due_date ON public.invoices;
CREATE TRIGGER trg_set_invoice_due_date
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_due_date();

-- ── Reminder scan support ───────────────────────────────────────────────────
-- Fast lookup for the daily reminder scan. The scan targets still-owing
-- invoices (OPEN or PARTIALLY_PAID) within a date window, so index both.
CREATE INDEX IF NOT EXISTS idx_ar_txn_due_scan
  ON public.ar_transactions (status, due_date)
  WHERE status IN ('OPEN', 'PARTIALLY_PAID');

-- ── Daily reminder cron (08:00 UTC) ─────────────────────────────────────────
-- Requires pg_cron + pg_net (already enabled in earlier migrations) and the
-- service-role key stored in Supabase Vault under the name 'service_role_key':
--   Dashboard → Project Settings → Vault → New secret
--     name = service_role_key, value = <project service_role key>
-- Stored this way the key is never committed to the repo.
SELECT cron.unschedule('invoice-due-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoice-due-reminders');

SELECT cron.schedule(
  'invoice-due-reminders',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qaxfmvbrqypdipwokkje.supabase.co/functions/v1/invoice-due-reminders',
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
