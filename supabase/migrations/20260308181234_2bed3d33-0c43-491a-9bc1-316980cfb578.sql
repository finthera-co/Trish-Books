
-- Create storage bucket for CSV exports
INSERT INTO storage.buckets (id, name, public) VALUES ('csv-exports', 'csv-exports', false);

-- Create export_logs table to track exports
CREATE TABLE public.export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  export_type text NOT NULL DEFAULT 'weekly',
  tables_included text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.export_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant export logs"
  ON public.export_logs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Service role can insert export logs"
  ON public.export_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Storage RLS: authenticated users can read their tenant's exports
CREATE POLICY "Users can read own tenant exports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'csv-exports' AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.tenants WHERE id = get_user_tenant_id()
  ));

-- Service role can insert exports (edge function uses service role)
CREATE POLICY "Service role can insert exports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'csv-exports');

-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
