-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY FIX — sensitive files were world-readable in public storage buckets.
--
-- `invoice-assets` (public) held invoice attachments (financial documents) and
-- `employee-photos` (public) held staff photos (PII). A public bucket serves
-- every object over an unauthenticated URL with no tenant isolation.
--
-- Fix:
--   • Invoice attachments move to a NEW private bucket `invoice-attachments`.
--     `invoice-assets` stays public — it only holds company logos / branding
--     that must render in invoices emailed to external customers.
--   • `employee-photos` becomes private.
--   • Both private buckets get tenant-scoped RLS keyed on the first path segment
--     (uploads are written under `<tenant_id>/...`), and are read via short-lived
--     signed URLs from the app.
--
-- Safe to run: at migration time there are 0 invoice_attachments rows and 0
-- employee photos, so nothing needs to be relocated.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Private bucket for invoice attachments.
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-attachments', 'invoice-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Make employee-photos private.
UPDATE storage.buckets SET public = false WHERE id = 'employee-photos';

-- 3. Replace the old employee-photos policies (public read + unscoped writes)
--    with tenant-scoped ones. Path layout: <tenant_id>/<uuid>.<ext>.
DROP POLICY IF EXISTS "Employee photos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete employee photos" ON storage.objects;

CREATE POLICY "employee_photos tenant read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'employee-photos'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "employee_photos tenant insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-photos'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "employee_photos tenant update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-photos'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'employee-photos'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "employee_photos tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'employee-photos'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- 4. Tenant-scoped policies for invoice-attachments.
--    Path layout: <tenant_id>/invoices/<invoice_id>/<file>.
CREATE POLICY "invoice_attachments tenant read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invoice-attachments'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "invoice_attachments tenant insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoice-attachments'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "invoice_attachments tenant update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'invoice-attachments'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'invoice-attachments'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "invoice_attachments tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'invoice-attachments'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
