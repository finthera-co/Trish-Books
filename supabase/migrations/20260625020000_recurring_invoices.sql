-- ─────────────────────────────────────────────────────────────────────────────
-- Recurring invoices (subscriptions / retainers)
--
-- A recurring_invoices row is a TEMPLATE plus a schedule. A daily cron calls the
-- generate-recurring-invoices edge function, which clones each due template into
-- a real invoice (with a fresh IRD serial), optionally posts it, and advances the
-- schedule. Drafts are the safe default; auto_post posts straight to the GL.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recurring_invoices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id            UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  template_name          TEXT NOT NULL,
  frequency              TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  interval_count         INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date             DATE NOT NULL,
  end_date               DATE,                       -- optional hard stop
  max_occurrences        INTEGER,                    -- optional cap on count
  occurrences_generated  INTEGER NOT NULL DEFAULT 0,
  next_run_date          DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  auto_post              BOOLEAN NOT NULL DEFAULT false,
  -- Invoice header defaults carried onto every generated invoice.
  branch_code            TEXT,
  payment_terms          TEXT NOT NULL DEFAULT 'net_30',
  notes                  TEXT,
  terms                  TEXT,
  created_by             UUID REFERENCES public.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recurring_invoice_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_invoice_id   UUID NOT NULL REFERENCES public.recurring_invoices(id) ON DELETE CASCADE,
  description            TEXT,
  quantity               NUMERIC NOT NULL DEFAULT 1,
  unit_price             NUMERIC NOT NULL DEFAULT 0,
  product_id             UUID REFERENCES public.products(id),
  account_id             UUID REFERENCES public.accounts(id),
  discount_amount        NUMERIC NOT NULL DEFAULT 0,
  is_tax_inclusive       BOOLEAN NOT NULL DEFAULT false,
  tax_code_id            UUID REFERENCES public.tax_codes(id),
  tax_group_id           UUID REFERENCES public.tax_groups(id),
  sort_order             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recurring_invoices_due
  ON public.recurring_invoices (next_run_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_tenant ON public.recurring_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_items_parent ON public.recurring_invoice_items (recurring_invoice_id);

-- ── Advance a schedule's next-run date by N periods ──────────────────
CREATE OR REPLACE FUNCTION public.recurring_next_date(
  p_from DATE, p_frequency TEXT, p_interval INTEGER
)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_frequency
    WHEN 'weekly'    THEN p_from + (p_interval * 7)
    WHEN 'monthly'   THEN (p_from + (p_interval || ' months')::interval)::date
    WHEN 'quarterly' THEN (p_from + (p_interval * 3 || ' months')::interval)::date
    WHEN 'yearly'    THEN (p_from + (p_interval || ' years')::interval)::date
    ELSE p_from + (p_interval || ' months')::interval
  END;
$$;

-- ── RLS: tenant members manage their own schedules ───────────────────
ALTER TABLE public.recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_invoices_rw ON public.recurring_invoices;
CREATE POLICY recurring_invoices_rw ON public.recurring_invoices
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS recurring_items_rw ON public.recurring_invoice_items;
CREATE POLICY recurring_items_rw ON public.recurring_invoice_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recurring_invoices r
    JOIN public.users u ON u.tenant_id = r.tenant_id
    WHERE r.id = recurring_invoice_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recurring_invoices r
    JOIN public.users u ON u.tenant_id = r.tenant_id
    WHERE r.id = recurring_invoice_id AND u.auth_user_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_invoice_items TO authenticated;

-- The cron generator runs as service_role and mints invoice serials, so it needs
-- EXECUTE on the (previously authenticated-only) serial function.
GRANT EXECUTE ON FUNCTION public.next_invoice_serial(text, date) TO service_role;

-- ── Daily generation cron (02:30 UTC) ────────────────────────────────
-- Requires the service_role_key Vault secret (see schedule_forecast_cashflow).
SELECT cron.unschedule('generate-recurring-invoices-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-recurring-invoices-daily');

SELECT cron.schedule(
  'generate-recurring-invoices-daily',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qaxfmvbrqypdipwokkje.supabase.co/functions/v1/generate-recurring-invoices',
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
