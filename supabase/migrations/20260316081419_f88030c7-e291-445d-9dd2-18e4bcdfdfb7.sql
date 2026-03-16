
CREATE TABLE public.dashboard_kpi_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  visible_kpis text[] NOT NULL DEFAULT '{}',
  pinned_kpis text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.dashboard_kpi_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own KPI preferences"
ON public.dashboard_kpi_preferences
FOR SELECT TO authenticated
USING (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can manage own KPI preferences"
ON public.dashboard_kpi_preferences
FOR ALL TO authenticated
USING (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));
