-- Recreate storage policies for invoice-assets bucket with proper WITH CHECK clauses
DROP POLICY IF EXISTS "Invoice assets are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload invoice assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update invoice assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete invoice assets" ON storage.objects;

CREATE POLICY "Invoice assets public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'invoice-assets');

CREATE POLICY "Invoice assets authenticated insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'invoice-assets');

CREATE POLICY "Invoice assets authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'invoice-assets')
WITH CHECK (bucket_id = 'invoice-assets');

CREATE POLICY "Invoice assets authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'invoice-assets');