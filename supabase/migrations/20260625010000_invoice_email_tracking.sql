-- ─────────────────────────────────────────────────────────────────────────────
-- Server-side invoice email delivery + tracking
--
-- Until now "sending" an invoice only opened a WhatsApp/Gmail compose window and
-- asked the user to attach the PDF by hand — nothing was actually delivered or
-- recorded. This adds first-class email delivery (via the send-invoice-email
-- edge function / Resend) with a per-send audit log and open tracking.
-- ─────────────────────────────────────────────────────────────────────────────

-- Lightweight delivery metadata on the invoice itself (for list/detail badges).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS email_status    TEXT,          -- null | sent | failed | opened
  ADD COLUMN IF NOT EXISTS email_recipient TEXT,
  ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.invoices.email_status IS
  'Latest delivery state of the invoice email: sent | failed | opened (null = never emailed).';

-- Full per-send history (one row per delivery attempt).
CREATE TABLE IF NOT EXISTS public.invoice_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id          UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  recipient           TEXT NOT NULL,
  subject             TEXT,
  status              TEXT NOT NULL DEFAULT 'sending',     -- sending | sent | failed | opened
  provider_message_id TEXT,
  error               TEXT,
  opened_at           TIMESTAMPTZ,
  sent_by             UUID REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_emails_invoice  ON public.invoice_emails (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_emails_tenant   ON public.invoice_emails (tenant_id);
-- The webhook looks rows up by the provider's message id.
CREATE INDEX IF NOT EXISTS idx_invoice_emails_msgid    ON public.invoice_emails (provider_message_id);

ALTER TABLE public.invoice_emails ENABLE ROW LEVEL SECURITY;

-- Tenant members may read their own send history. Writes happen only through the
-- service-role edge functions (send + webhook), so no client write policies.
DROP POLICY IF EXISTS invoice_emails_select ON public.invoice_emails;
CREATE POLICY invoice_emails_select ON public.invoice_emails
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.invoice_emails TO authenticated;
