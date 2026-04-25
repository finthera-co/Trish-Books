-- Create public bucket for invoice logos and assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-assets', 'invoice-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "Invoice assets are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'invoice-assets');

-- Authenticated users can upload to their tenant folder
CREATE POLICY "Authenticated users can upload invoice assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can update invoice assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can delete invoice assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'invoice-assets');