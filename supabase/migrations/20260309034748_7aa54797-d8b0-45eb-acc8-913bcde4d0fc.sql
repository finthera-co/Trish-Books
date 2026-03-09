
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own tenant notifications (either targeted to them or broadcast to tenant)
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (user_id IS NULL OR user_id IN (
      SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    ))
  );

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users can mark notifications as read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (user_id IS NULL OR user_id IN (
      SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    ))
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
  );

-- Authenticated users can insert notifications for their tenant
CREATE POLICY "Users can create notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Super admins can manage all notifications
CREATE POLICY "Super admins can manage notifications"
  ON public.notifications FOR ALL
  TO authenticated
  USING (is_super_admin());
