
CREATE TABLE public.invoice_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'standard',
  layout_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_settings JSONB NOT NULL DEFAULT '{"size":"A4","orientation":"portrait","margins":{"top":40,"bottom":40,"left":40,"right":40}}'::jsonb,
  table_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant invoice templates"
  ON public.invoice_templates FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage invoice templates"
  ON public.invoice_templates FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());
