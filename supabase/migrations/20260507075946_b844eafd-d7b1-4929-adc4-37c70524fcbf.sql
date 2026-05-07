
-- Seed 5210 Inventory Shrinkage account
INSERT INTO public.accounts (tenant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active)
SELECT t.id, '5210', 'Inventory Shrinkage', 'Expense', 'Operating Expense', 'debit', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id = t.id AND a.account_code = '5210');

-- ──────────────────────────────────────────────
-- stock_counts header
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  count_number text NOT NULL,
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id uuid REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_progress','counted','posted','cancelled')),
  freeze_stock boolean NOT NULL DEFAULT false,
  reason text,
  notes text,
  total_variance_qty numeric(18,4) NOT NULL DEFAULT 0,
  total_variance_value numeric(18,2) NOT NULL DEFAULT 0,
  adjustment_id uuid REFERENCES public.stock_adjustments(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid REFERENCES public.users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, count_number)
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_tenant ON public.stock_counts(tenant_id, count_date DESC);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  system_qty numeric(18,4) NOT NULL DEFAULT 0,
  counted_qty numeric(18,4),
  variance_qty numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost numeric(18,6) NOT NULL DEFAULT 0,
  variance_value numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON public.stock_count_lines(count_id);

-- Numbering trigger
CREATE OR REPLACE FUNCTION public.set_stock_count_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  IF NEW.count_number IS NULL OR NEW.count_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(count_number,'\D','','g'),'')::int),0)+1
      INTO v_n FROM public.stock_counts WHERE tenant_id = NEW.tenant_id;
    NEW.count_number := 'PC-' || lpad(v_n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_stock_count_number ON public.stock_counts;
CREATE TRIGGER trg_set_stock_count_number BEFORE INSERT ON public.stock_counts
FOR EACH ROW EXECUTE FUNCTION public.set_stock_count_number();

DROP TRIGGER IF EXISTS trg_stock_counts_updated ON public.stock_counts;
CREATE TRIGGER trg_stock_counts_updated BEFORE UPDATE ON public.stock_counts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_counts_tenant_select" ON public.stock_counts;
CREATE POLICY "stock_counts_tenant_select" ON public.stock_counts
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "stock_counts_tenant_write" ON public.stock_counts;
CREATE POLICY "stock_counts_tenant_write" ON public.stock_counts
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "stock_count_lines_tenant_select" ON public.stock_count_lines;
CREATE POLICY "stock_count_lines_tenant_select" ON public.stock_count_lines
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "stock_count_lines_tenant_write" ON public.stock_count_lines;
CREATE POLICY "stock_count_lines_tenant_write" ON public.stock_count_lines
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- ──────────────────────────────────────────────
-- start_stock_count: snapshot system qty
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_stock_count(p_count_id uuid, p_item_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_user uuid; v_count stock_counts%ROWTYPE; v_n int := 0;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_count FROM public.stock_counts
   WHERE id = p_count_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock count not found'; END IF;
  IF v_count.status NOT IN ('draft') THEN
    RAISE EXCEPTION 'Count % already started (status=%)', v_count.count_number, v_count.status;
  END IF;

  DELETE FROM public.stock_count_lines WHERE count_id = p_count_id;

  INSERT INTO public.stock_count_lines(
    tenant_id, count_id, item_id, warehouse_id, system_qty, counted_qty, unit_cost
  )
  SELECT v_tenant, p_count_id, i.id, v_count.warehouse_id,
         COALESCE(i.quantity_on_hand,0), NULL, COALESCE(i.unit_cost,0)
  FROM public.inventory_items i
  WHERE i.tenant_id = v_tenant
    AND COALESCE(i.is_active, true) = true
    AND (p_item_ids IS NULL OR i.id = ANY(p_item_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.stock_counts
    SET status = 'in_progress', updated_at = now()
    WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'lines', v_n);
END $$;

-- ──────────────────────────────────────────────
-- post_stock_count: create + post a stock_adjustment from variances
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_stock_count(p_count_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_count stock_counts%ROWTYPE;
  v_adj_id uuid;
  v_total_qty numeric(18,4) := 0;
  v_total_val numeric(18,2) := 0;
  v_lines int := 0;
  v_post jsonb;
  v_je uuid;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_count FROM public.stock_counts
   WHERE id = p_count_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock count not found'; END IF;
  IF v_count.status NOT IN ('in_progress','counted') THEN
    RAISE EXCEPTION 'Count % is not ready to post (status=%)', v_count.count_number, v_count.status;
  END IF;

  -- recalc variance per line
  UPDATE public.stock_count_lines l
     SET variance_qty   = COALESCE(l.counted_qty,0) - COALESCE(l.system_qty,0),
         variance_value = round((COALESCE(l.counted_qty,0) - COALESCE(l.system_qty,0)) * COALESCE(l.unit_cost,0), 2)
   WHERE l.count_id = p_count_id;

  SELECT COALESCE(SUM(abs(variance_qty)),0), COALESCE(SUM(abs(variance_value)),0)
    INTO v_total_qty, v_total_val
    FROM public.stock_count_lines
    WHERE count_id = p_count_id AND counted_qty IS NOT NULL AND variance_qty <> 0;

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_count_lines
    WHERE count_id = p_count_id AND counted_qty IS NOT NULL AND variance_qty <> 0
  ) THEN
    UPDATE public.stock_counts
      SET status = 'posted', total_variance_qty = 0, total_variance_value = 0,
          posted_at = now(), updated_at = now()
      WHERE id = p_count_id;
    RETURN jsonb_build_object('ok', true, 'no_variance', true);
  END IF;

  -- Create stock adjustment header
  INSERT INTO public.stock_adjustments(
    tenant_id, adjustment_date, warehouse_id, adjustment_type, reason, notes, status, total_value
  ) VALUES (
    v_tenant, v_count.count_date, v_count.warehouse_id, 'count',
    'Physical Count ' || v_count.count_number,
    v_count.notes, 'draft', v_total_val
  ) RETURNING id INTO v_adj_id;

  -- Lines from variances
  INSERT INTO public.stock_adjustment_lines(
    tenant_id, adjustment_id, item_id, warehouse_id, qty_delta, unit_cost, line_value, notes
  )
  SELECT v_tenant, v_adj_id, l.item_id, l.warehouse_id, l.variance_qty, l.unit_cost,
         round(abs(l.variance_qty) * l.unit_cost, 2),
         'PC ' || v_count.count_number
  FROM public.stock_count_lines l
  WHERE l.count_id = p_count_id AND l.counted_qty IS NOT NULL AND l.variance_qty <> 0;
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  -- Post the adjustment (creates JE)
  v_post := public.post_stock_adjustment(v_adj_id);
  v_je := (v_post->>'journal_id')::uuid;

  UPDATE public.stock_counts
    SET status = 'posted',
        adjustment_id = v_adj_id,
        journal_entry_id = v_je,
        total_variance_qty = v_total_qty,
        total_variance_value = v_total_val,
        posted_at = now(),
        updated_at = now()
    WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'adjustment_id', v_adj_id, 'journal_id', v_je,
                            'lines', v_lines, 'variance_value', v_total_val);
END $$;

-- Cancel
CREATE OR REPLACE FUNCTION public.cancel_stock_count(p_count_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.stock_counts SET status = 'cancelled', updated_at = now()
   WHERE id = p_count_id AND tenant_id = v_tenant AND status IN ('draft','in_progress','counted');
  RETURN jsonb_build_object('ok', true);
END $$;
