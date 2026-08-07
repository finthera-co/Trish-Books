-- petty-cash-receipts had no tenant scoping at all: objects are stored at
-- `<voucherId>/...` and the existing policies (20260318042439) only check
-- bucket_id, so any authenticated user of any tenant can read/write any other
-- tenant's petty cash receipts. Replace with tenant-scoped policies matching
-- the pattern already used for employee-photos/invoice-attachments
-- (20260704010000_private_storage_buckets.sql), keyed on a `<tenant_id>/...`
-- path prefix.
--
-- Forward-only: usePettyCash.ts's upload path now writes
-- `<tenant_id>/<voucherId>/<file>`, but objects already stored under the old
-- flat `<voucherId>/...` path will fail the new check for everyone, including
-- their own tenant, since `(storage.foldername(name))[1]` won't equal any
-- tenant_id. Accepted trade-off: receipt links on already-posted vouchers are
-- non-critical to posted accounting figures, and a SQL migration can't move
-- Storage objects itself.

DROP POLICY IF EXISTS "Auth users can upload pc receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can view pc receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete pc receipts" ON storage.objects;

CREATE POLICY "petty_cash_receipts tenant read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'petty-cash-receipts'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "petty_cash_receipts tenant insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'petty-cash-receipts'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "petty_cash_receipts tenant update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'petty-cash-receipts'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'petty-cash-receipts'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "petty_cash_receipts tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'petty-cash-receipts'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
