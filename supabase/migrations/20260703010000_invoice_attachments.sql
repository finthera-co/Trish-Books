-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice attachments (PO copy, signed delivery note, etc.)
-- Files live in the existing public `invoice-assets` storage bucket; this table
-- is the metadata index scoped per tenant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,      -- object path within the bucket
  file_url      TEXT NOT NULL,      -- public URL
  content_type  TEXT,
  size_bytes    BIGINT,
  uploaded_by   UUID REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_inv ON public.invoice_attachments (invoice_id);

ALTER TABLE public.invoice_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_attachments_rw ON public.invoice_attachments;
CREATE POLICY invoice_attachments_rw ON public.invoice_attachments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_attachments TO authenticated;
