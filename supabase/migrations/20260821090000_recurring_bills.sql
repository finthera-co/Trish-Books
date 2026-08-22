-- ============================================================================
-- RECURRING BILLS (AP)
--
-- Mirrors recurring_invoices / recurring_invoice_items
-- (supabase/migrations/20260625020000_recurring_invoices.sql) field-for-field
-- for vendors instead of customers, reusing the existing generic
-- recurring_next_date() schedule-advance function as-is.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_bill_templates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_id              UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  template_name          TEXT NOT NULL,
  frequency              TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  interval_count         INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date             DATE NOT NULL,
  end_date               DATE,
  max_occurrences        INTEGER,
  occurrences_generated  INTEGER NOT NULL DEFAULT 0,
  next_run_date          DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  auto_post              BOOLEAN NOT NULL DEFAULT false,
  -- Bill header defaults carried onto every generated bill.
  payment_terms          TEXT NOT NULL DEFAULT 'net_30',
  vendor_ref             TEXT,
  notes                  TEXT,
  created_by             UUID REFERENCES public.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recurring_bill_template_lines (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_bill_template_id UUID NOT NULL REFERENCES public.recurring_bill_templates(id) ON DELETE CASCADE,
  account_id                UUID NOT NULL REFERENCES public.accounts(id),
  description               TEXT,
  qty                       NUMERIC(18,4) NOT NULL DEFAULT 1,
  unit_cost                 NUMERIC(18,4) NOT NULL DEFAULT 0,
  customer_id               UUID REFERENCES public.customers(id),
  is_billable               BOOLEAN NOT NULL DEFAULT false,
  cost_center_id            UUID REFERENCES public.cost_centers(id),
  sort_order                INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recurring_bills_due
  ON public.recurring_bill_templates (next_run_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_recurring_bills_tenant ON public.recurring_bill_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_bill_lines_parent ON public.recurring_bill_template_lines (recurring_bill_template_id);

-- ── RLS: tenant members manage their own schedules ───────────────────
ALTER TABLE public.recurring_bill_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_bill_template_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_bill_templates_rw ON public.recurring_bill_templates;
CREATE POLICY recurring_bill_templates_rw ON public.recurring_bill_templates
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS recurring_bill_template_lines_rw ON public.recurring_bill_template_lines;
CREATE POLICY recurring_bill_template_lines_rw ON public.recurring_bill_template_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recurring_bill_templates t
    JOIN public.users u ON u.tenant_id = t.tenant_id
    WHERE t.id = recurring_bill_template_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recurring_bill_templates t
    JOIN public.users u ON u.tenant_id = t.tenant_id
    WHERE t.id = recurring_bill_template_id AND u.auth_user_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_bill_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_bill_template_lines TO authenticated;

-- The cron generator runs as service_role and needs to insert bills/lines and
-- call post_supplier_bill; RLS is bypassed for service_role already, but the
-- SECURITY DEFINER RPC below needs EXECUTE from service_role too.
GRANT EXECUTE ON FUNCTION public.recurring_next_date(date, text, integer) TO service_role;

-- ── generate_recurring_bills(): pure-SQL generator, callable by the cron's
--    edge function (service_role — no auth.uid(), processes every tenant)
--    OR directly by an authenticated user for a manual "run now" trigger
--    (scoped strictly to their own tenant — this function must never let one
--    tenant's session generate another tenant's bills). Mirrors what
--    generate-recurring-invoices/index.ts does, but as one SECURITY DEFINER
--    RPC (bill posting is already a plain SQL RPC, so no need for an edge
--    function to orchestrate an edge-function chain like AR does).
CREATE OR REPLACE FUNCTION public.generate_recurring_bills()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant uuid;
  v_tpl RECORD;
  v_bill_id uuid;
  v_creator_auth_uid uuid;
  v_created int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  -- auth.uid() is NULL under the cron's service-role context; a real user
  -- session must only ever touch their own tenant's templates.
  IF auth.uid() IS NOT NULL THEN
    SELECT tenant_id INTO v_caller_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
    IF v_caller_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  END IF;

  FOR v_tpl IN
    SELECT * FROM public.recurring_bill_templates
    WHERE status = 'active' AND next_run_date <= CURRENT_DATE
      AND (v_caller_tenant IS NULL OR tenant_id = v_caller_tenant)
    ORDER BY next_run_date
  LOOP
    BEGIN
      -- due_date and bill_number are left unset — trg_set_bill_due_date and
      -- trg_set_bill_number (both BEFORE INSERT) fill them the same way a
      -- manually entered bill would get them.
      INSERT INTO public.supplier_bills (
        tenant_id, vendor_id, bill_date, status, payment_terms, vendor_ref, notes
      ) VALUES (
        v_tpl.tenant_id, v_tpl.vendor_id, v_tpl.next_run_date,
        'draft', v_tpl.payment_terms, v_tpl.vendor_ref, v_tpl.notes
      )
      RETURNING id INTO v_bill_id;

      INSERT INTO public.supplier_bill_lines (
        tenant_id, bill_id, account_id, description, qty, unit_cost, line_total, customer_id, is_billable, cost_center_id
      )
      SELECT v_tpl.tenant_id, v_bill_id, l.account_id, l.description, l.qty, l.unit_cost,
             round(l.qty * l.unit_cost, 2), l.customer_id, l.is_billable, l.cost_center_id
      FROM public.recurring_bill_template_lines l
      WHERE l.recurring_bill_template_id = v_tpl.id
      ORDER BY l.sort_order;

      -- Template lines carry no tax (mirrors the columns actually copied
      -- above — no tax_code_id/tax_group_id on recurring_bill_template_lines),
      -- so subtotal = total_amount here. post_supplier_bill recomputes both
      -- from scratch anyway when auto_post posts the bill below; this only
      -- matters so a *draft* bill doesn't sit at the DB default of 0 in the
      -- Bills list until someone opens and re-saves it.
      UPDATE public.supplier_bills b
      SET subtotal = t.total, total_amount = t.total
      FROM (SELECT COALESCE(SUM(line_total), 0) AS total FROM public.supplier_bill_lines WHERE bill_id = v_bill_id) t
      WHERE b.id = v_bill_id;

      IF v_tpl.auto_post THEN
        -- post_supplier_bill resolves the poster via auth.uid(), which is
        -- NULL under the cron's service-role context. Impersonate the
        -- template's creator for the duration of this posting call
        -- (transaction-local set_config, overwritten fresh each iteration —
        -- the same technique used to test these RPCs directly) so the
        -- resulting journal entry attributes correctly instead of failing
        -- 'Not authenticated'. Falls back to leaving the bill as a draft
        -- (with a note in the result) if the creator has no linked login.
        v_creator_auth_uid := NULL;
        IF v_tpl.created_by IS NOT NULL THEN
          SELECT auth_user_id INTO v_creator_auth_uid FROM public.users WHERE id = v_tpl.created_by;
        END IF;
        IF v_creator_auth_uid IS NOT NULL THEN
          PERFORM set_config('request.jwt.claim.sub', v_creator_auth_uid::text, true);
          PERFORM public.post_supplier_bill(v_bill_id);
        ELSE
          v_errors := v_errors || jsonb_build_object(
            'template_id', v_tpl.id,
            'error', 'auto_post skipped (bill left as draft): template has no creator with a linked login to post as'
          );
        END IF;
      END IF;

      UPDATE public.recurring_bill_templates
      SET next_run_date = public.recurring_next_date(v_tpl.next_run_date, v_tpl.frequency, v_tpl.interval_count),
          occurrences_generated = v_tpl.occurrences_generated + 1,
          status = CASE
            WHEN v_tpl.max_occurrences IS NOT NULL AND v_tpl.occurrences_generated + 1 >= v_tpl.max_occurrences THEN 'completed'
            WHEN v_tpl.end_date IS NOT NULL AND public.recurring_next_date(v_tpl.next_run_date, v_tpl.frequency, v_tpl.interval_count) > v_tpl.end_date THEN 'completed'
            ELSE 'active'
          END,
          updated_at = now()
      WHERE id = v_tpl.id;

      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('template_id', v_tpl.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'bills_created', v_created, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_bills() FROM public;
GRANT EXECUTE ON FUNCTION public.generate_recurring_bills() TO authenticated, service_role;
