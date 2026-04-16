
-- Create system_error_logs table
CREATE TABLE public.system_error_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  severity text NOT NULL DEFAULT 'info',
  module text NOT NULL DEFAULT 'system',
  message text NOT NULL,
  stack_trace text,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamp with time zone,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata jsonb
);

-- Enable RLS
ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;

-- Super Admins can view all error logs
CREATE POLICY "Super admins can view all error logs"
  ON public.system_error_logs
  FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- Super Admins can update error logs (mark as resolved)
CREATE POLICY "Super admins can update error logs"
  ON public.system_error_logs
  FOR UPDATE
  TO authenticated
  USING (is_super_admin());

-- Authenticated users can insert error logs (for error reporting)
CREATE POLICY "Authenticated users can insert error logs"
  ON public.system_error_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Index for common queries
CREATE INDEX idx_system_error_logs_severity ON public.system_error_logs(severity);
CREATE INDEX idx_system_error_logs_created_at ON public.system_error_logs(created_at DESC);
CREATE INDEX idx_system_error_logs_resolved ON public.system_error_logs(resolved);
