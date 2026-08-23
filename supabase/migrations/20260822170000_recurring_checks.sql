-- ============================================================================
-- RECURRING CHECKS
--
-- Mirrors recurring_bill_templates / generate_recurring_bills()
-- (20260821090000_recurring_bills.sql) field-for-field, keyed by
-- payment_account_id and reusing payment_vouchers' existing exclusive
-- payee_id/payee_vendor_id shape. Checks have no draft state (create_check
-- always posts immediately), so there is no auto_post toggle and no
-- draft-left-behind fallback: if a template's creator has no linked login
-- to impersonate for posting, that occurrence is skipped and reported in
-- the errors array rather than silently creating anything.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_check_templates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_account_id     UUID NOT NULL REFERENCES public.accounts(id),
  payee_id               UUID REFERENCES public.customers(id),
  payee_vendor_id        UUID REFERENCES public.vendors(id),
  template_name          TEXT NOT NULL,
  frequency              TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  interval_count         INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date             DATE NOT NULL,
  end_date               DATE,
  max_occurrences        INTEGER,
  occurrences_generated  INTEGER NOT NULL DEFAULT 0,
  next_run_date          DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  payment_method         TEXT NOT NULL DEFAULT 'Cheque',
  memo                   TEXT,
  print_later            BOOLEAN NOT NULL DEFAULT false,
  mailing_address        TEXT,
  permit_number          TEXT,
  location_id            UUID REFERENCES public.locations(id),
  created_by             UUID REFERENCES public.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_check_templates_payee_exclusive CHECK (payee_id IS NULL OR payee_vendor_id IS NULL)
);

CREATE TABLE IF NOT EXISTS public.recurring_check_template_lines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_check_template_id UUID NOT NULL REFERENCES public.recurring_check_templates(id) ON DELETE CASCADE,
  account_id                  UUID NOT NULL REFERENCES public.accounts(id),
  description                 TEXT,
  amount                      NUMERIC(18,2) NOT NULL DEFAULT 0,
  customer_id                 UUID REFERENCES public.customers(id),
  is_billable                 BOOLEAN NOT NULL DEFAULT false,
  cost_center_id              UUID REFERENCES public.cost_centers(id),
  is_taxable                  BOOLEAN NOT NULL DEFAULT false,
  sort_order                  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recurring_checks_due
  ON public.recurring_check_templates (next_run_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_recurring_checks_tenant ON public.recurring_check_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_check_lines_parent ON public.recurring_check_template_lines (recurring_check_template_id);

ALTER TABLE public.recurring_check_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_check_template_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_check_templates_rw ON public.recurring_check_templates;
CREATE POLICY recurring_check_templates_rw ON public.recurring_check_templates
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS recurring_check_template_lines_rw ON public.recurring_check_template_lines;
CREATE POLICY recurring_check_template_lines_rw ON public.recurring_check_template_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recurring_check_templates t
    JOIN public.users u ON u.tenant_id = t.tenant_id
    WHERE t.id = recurring_check_template_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recurring_check_templates t
    JOIN public.users u ON u.tenant_id = t.tenant_id
    WHERE t.id = recurring_check_template_id AND u.auth_user_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_check_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_check_template_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_recurring_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant     uuid;
  v_tpl               RECORD;
  v_creator_auth_uid  uuid;
  v_lines             jsonb;
  v_voucher_id        uuid;
  v_created           int := 0;
  v_errors            jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT tenant_id INTO v_caller_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
    IF v_caller_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  END IF;

  FOR v_tpl IN
    SELECT * FROM public.recurring_check_templates
    WHERE status = 'active' AND next_run_date <= CURRENT_DATE
      AND (v_caller_tenant IS NULL OR tenant_id = v_caller_tenant)
    ORDER BY next_run_date
  LOOP
    BEGIN
      v_creator_auth_uid := NULL;
      IF v_tpl.created_by IS NOT NULL THEN
        SELECT auth_user_id INTO v_creator_auth_uid FROM public.users WHERE id = v_tpl.created_by;
      END IF;

      IF v_creator_auth_uid IS NULL THEN
        v_errors := v_errors || jsonb_build_object(
          'template_id', v_tpl.id,
          'error', 'skipped: template has no creator with a linked login to post as (checks have no draft state to fall back to)'
        );
      ELSE
        SELECT jsonb_agg(jsonb_build_object(
          'account_id', l.account_id, 'description', l.description, 'amount', l.amount,
          'customer_id', l.customer_id, 'is_billable', l.is_billable,
          'cost_center_id', l.cost_center_id, 'is_taxable', l.is_taxable, 'sort_order', l.sort_order
        ) ORDER BY l.sort_order)
        INTO v_lines
        FROM public.recurring_check_template_lines l
        WHERE l.recurring_check_template_id = v_tpl.id;

        -- Impersonate the template's creator for this call — create_check
        -- resolves the actor via auth.uid(), which is NULL under the cron's
        -- service-role context. Transaction-local, overwritten each iteration.
        PERFORM set_config('request.jwt.claim.sub', v_creator_auth_uid::text, true);

        v_voucher_id := public.create_check(
          p_payment_account_id => v_tpl.payment_account_id,
          p_payment_method => v_tpl.payment_method,
          p_payment_date => v_tpl.next_run_date,
          p_lines => COALESCE(v_lines, '[]'::jsonb),
          p_payee_id => v_tpl.payee_id,
          p_payee_vendor_id => v_tpl.payee_vendor_id,
          p_memo => v_tpl.memo,
          p_print_later => v_tpl.print_later,
          p_mailing_address => v_tpl.mailing_address,
          p_permit_number => v_tpl.permit_number,
          p_location_id => v_tpl.location_id,
          p_is_recurring => true,
          p_recurring_template_id => v_tpl.id
        );

        v_created := v_created + 1;
      END IF;

      UPDATE public.recurring_check_templates
      SET next_run_date = public.recurring_next_date(v_tpl.next_run_date, v_tpl.frequency, v_tpl.interval_count),
          occurrences_generated = v_tpl.occurrences_generated + 1,
          status = CASE
            WHEN v_tpl.max_occurrences IS NOT NULL AND v_tpl.occurrences_generated + 1 >= v_tpl.max_occurrences THEN 'completed'
            WHEN v_tpl.end_date IS NOT NULL AND public.recurring_next_date(v_tpl.next_run_date, v_tpl.frequency, v_tpl.interval_count) > v_tpl.end_date THEN 'completed'
            ELSE 'active'
          END,
          updated_at = now()
      WHERE id = v_tpl.id;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('template_id', v_tpl.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'checks_created', v_created, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_checks() FROM public;
GRANT EXECUTE ON FUNCTION public.generate_recurring_checks() TO authenticated, service_role;
