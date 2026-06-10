-- ================================================================
-- Migration: account_settings expanded — full GL control account coverage
-- Parts: A) Add columns  B) Backfill from COA  C) Completeness RPC
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- PART A — Add missing columns to public.account_settings
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.account_settings
  -- Inventory & Procurement
  ADD COLUMN IF NOT EXISTS inventory_account_id               uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS cogs_account_id                    uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS grni_clearing_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS purchase_price_variance_account_id uuid REFERENCES public.accounts(id),

  -- Fixed Assets (global fallback — category-level takes priority)
  ADD COLUMN IF NOT EXISTS depreciation_expense_account_id    uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS accumulated_depreciation_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS disposal_gain_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS disposal_loss_account_id           uuid REFERENCES public.accounts(id),

  -- Equity & Period-Close
  ADD COLUMN IF NOT EXISTS retained_earnings_account_id       uuid REFERENCES public.accounts(id),

  -- FX (multi-currency — IAS 21)
  ADD COLUMN IF NOT EXISTS fx_gain_account_id                 uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS fx_loss_account_id                 uuid REFERENCES public.accounts(id),

  -- Payroll (global fallback — component-level mapping takes priority)
  ADD COLUMN IF NOT EXISTS wages_expense_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS payroll_clearing_account_id        uuid REFERENCES public.accounts(id);


-- ────────────────────────────────────────────────────────────────
-- PART B — Backfill new columns from existing COA where possible
-- ────────────────────────────────────────────────────────────────

-- inventory_account_id → code 1300
UPDATE public.account_settings AS s
SET inventory_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code = '1300'
  AND a.is_active = true
  AND s.inventory_account_id IS NULL;

-- cogs_account_id → code 5000
UPDATE public.account_settings AS s
SET cogs_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code = '5000'
  AND a.is_active = true
  AND s.cogs_account_id IS NULL;

-- grni_clearing_account_id → code 2150
UPDATE public.account_settings AS s
SET grni_clearing_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code = '2150'
  AND a.is_active = true
  AND s.grni_clearing_account_id IS NULL;

-- purchase_price_variance_account_id → code 5100
UPDATE public.account_settings AS s
SET purchase_price_variance_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code = '5100'
  AND a.is_active = true
  AND s.purchase_price_variance_account_id IS NULL;

-- depreciation_expense_account_id → code 6500
UPDATE public.account_settings AS s
SET depreciation_expense_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code = '6500'
  AND a.is_active = true
  AND s.depreciation_expense_account_id IS NULL;

-- accumulated_depreciation_account_id → account_subtype ilike 'accumulated depreciation'
-- Tie-break: smallest id wins (deterministic single-row pick)
UPDATE public.account_settings AS s
SET accumulated_depreciation_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND lower(a.account_subtype) = 'accumulated depreciation'
  AND a.is_active = true
  AND s.accumulated_depreciation_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a2
    WHERE a2.tenant_id = s.tenant_id
      AND lower(a2.account_subtype) = 'accumulated depreciation'
      AND a2.is_active = true
      AND a2.id < a.id
  );

-- retained_earnings_account_id → code 3100 or name like '%retained earnings%'
-- Tie-break: smallest id wins
UPDATE public.account_settings AS s
SET retained_earnings_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND (a.account_code = '3100' OR lower(a.account_name) LIKE '%retained earnings%')
  AND a.is_active = true
  AND s.retained_earnings_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a2
    WHERE a2.tenant_id = s.tenant_id
      AND (a2.account_code = '3100' OR lower(a2.account_name) LIKE '%retained earnings%')
      AND a2.is_active = true
      AND a2.id < a.id
  );

-- wages_expense_account_id → code 6100 (Salaries & Wages)
UPDATE public.account_settings AS s
SET wages_expense_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code = '6100'
  AND a.is_active = true
  AND s.wages_expense_account_id IS NULL;


-- ────────────────────────────────────────────────────────────────
-- PART C — RPC: get_account_settings_completeness
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_account_settings_completeness(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.account_settings%ROWTYPE;
  v_critical_missing    text[] := '{}';
  v_recommended_missing text[] := '{}';
BEGIN
  SELECT * INTO v_row
  FROM public.account_settings
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'configured',          false,
      'critical_missing',    ARRAY['No account_settings row found'],
      'recommended_missing', '[]'::jsonb
    );
  END IF;

  -- Critical: these block posting if absent
  IF v_row.ar_account_id                IS NULL THEN v_critical_missing := v_critical_missing || 'ar_account_id'; END IF;
  IF v_row.ap_account_id                IS NULL THEN v_critical_missing := v_critical_missing || 'ap_account_id'; END IF;
  IF v_row.sales_account_id             IS NULL THEN v_critical_missing := v_critical_missing || 'sales_account_id'; END IF;
  IF v_row.bank_account_id              IS NULL THEN v_critical_missing := v_critical_missing || 'bank_account_id'; END IF;
  IF v_row.tax_payable_account_id       IS NULL THEN v_critical_missing := v_critical_missing || 'tax_payable_account_id'; END IF;
  IF v_row.retained_earnings_account_id IS NULL THEN v_critical_missing := v_critical_missing || 'retained_earnings_account_id'; END IF;

  -- Recommended: needed for full module coverage
  IF v_row.inventory_account_id               IS NULL THEN v_recommended_missing := v_recommended_missing || 'inventory_account_id'; END IF;
  IF v_row.cogs_account_id                    IS NULL THEN v_recommended_missing := v_recommended_missing || 'cogs_account_id'; END IF;
  IF v_row.grni_clearing_account_id           IS NULL THEN v_recommended_missing := v_recommended_missing || 'grni_clearing_account_id'; END IF;
  IF v_row.purchase_price_variance_account_id IS NULL THEN v_recommended_missing := v_recommended_missing || 'purchase_price_variance_account_id'; END IF;
  IF v_row.depreciation_expense_account_id    IS NULL THEN v_recommended_missing := v_recommended_missing || 'depreciation_expense_account_id'; END IF;
  IF v_row.accumulated_depreciation_account_id IS NULL THEN v_recommended_missing := v_recommended_missing || 'accumulated_depreciation_account_id'; END IF;
  IF v_row.disposal_gain_account_id           IS NULL THEN v_recommended_missing := v_recommended_missing || 'disposal_gain_account_id'; END IF;
  IF v_row.disposal_loss_account_id           IS NULL THEN v_recommended_missing := v_recommended_missing || 'disposal_loss_account_id'; END IF;
  IF v_row.wages_expense_account_id           IS NULL THEN v_recommended_missing := v_recommended_missing || 'wages_expense_account_id'; END IF;
  IF v_row.payroll_clearing_account_id        IS NULL THEN v_recommended_missing := v_recommended_missing || 'payroll_clearing_account_id'; END IF;
  IF v_row.fx_gain_account_id                 IS NULL THEN v_recommended_missing := v_recommended_missing || 'fx_gain_account_id'; END IF;
  IF v_row.fx_loss_account_id                 IS NULL THEN v_recommended_missing := v_recommended_missing || 'fx_loss_account_id'; END IF;

  RETURN jsonb_build_object(
    'configured',          true,
    'critical_missing',    to_jsonb(v_critical_missing),
    'recommended_missing', to_jsonb(v_recommended_missing),
    'critical_complete',   (array_length(v_critical_missing,    1) IS NULL),
    'fully_complete',      (array_length(v_critical_missing,    1) IS NULL
                        AND array_length(v_recommended_missing, 1) IS NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_settings_completeness(uuid) TO authenticated;
