-- ── Part A: Add 14 new columns to account_settings ───────────────────────────

ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS inventory_account_id               uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS cogs_account_id                    uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS grni_clearing_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS purchase_price_variance_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS depreciation_expense_account_id    uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS accumulated_depreciation_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS disposal_gain_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS disposal_loss_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS retained_earnings_account_id       uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS fx_gain_account_id                 uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS fx_loss_account_id                 uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS wages_expense_account_id           uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS payroll_clearing_account_id        uuid REFERENCES public.accounts(id);

-- ── Part B: Backfill from existing COA accounts (by canonical code) ───────────

UPDATE public.account_settings AS s
SET inventory_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code = '1300' AND a.is_active = true
  AND s.inventory_account_id IS NULL;

UPDATE public.account_settings AS s
SET cogs_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code IN ('5000','5010') AND a.is_active = true
  AND s.cogs_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a2
    WHERE a2.tenant_id = s.tenant_id AND a2.account_code IN ('5000','5010')
      AND a2.is_active = true AND a2.id < a.id
  );

UPDATE public.account_settings AS s
SET grni_clearing_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code = '2150' AND a.is_active = true
  AND s.grni_clearing_account_id IS NULL;

UPDATE public.account_settings AS s
SET purchase_price_variance_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code = '5100' AND a.is_active = true
  AND s.purchase_price_variance_account_id IS NULL;

UPDATE public.account_settings AS s
SET depreciation_expense_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code IN ('6500','7100') AND a.is_active = true
  AND s.depreciation_expense_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a2
    WHERE a2.tenant_id = s.tenant_id AND a2.account_code IN ('6500','7100')
      AND a2.is_active = true AND a2.id < a.id
  );

UPDATE public.account_settings AS s
SET accumulated_depreciation_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code IN ('1650','1600')
  AND lower(a.account_subtype) = 'accumulated depreciation'
  AND a.is_active = true
  AND s.accumulated_depreciation_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a2
    WHERE a2.tenant_id = s.tenant_id
      AND lower(a2.account_subtype) = 'accumulated depreciation'
      AND a2.is_active = true AND a2.id < a.id
  );

UPDATE public.account_settings AS s
SET disposal_gain_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code = '8100' AND a.is_active = true
  AND s.disposal_gain_account_id IS NULL;

UPDATE public.account_settings AS s
SET disposal_loss_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code = '8200' AND a.is_active = true
  AND s.disposal_loss_account_id IS NULL;

UPDATE public.account_settings AS s
SET retained_earnings_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id
  AND a.account_code IN ('3020','3100')
  AND a.account_type = 'Equity'
  AND a.is_active = true
  AND s.retained_earnings_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a2
    WHERE a2.tenant_id = s.tenant_id
      AND a2.account_code IN ('3020','3100')
      AND a2.is_active = true AND a2.id < a.id
  );

UPDATE public.account_settings AS s
SET wages_expense_account_id = a.id
FROM public.accounts a
WHERE a.tenant_id = s.tenant_id AND a.account_code = '6100' AND a.is_active = true
  AND s.wages_expense_account_id IS NULL;

-- ── Part C: RPC get_account_settings_completeness ─────────────────────────────

CREATE OR REPLACE FUNCTION public.get_account_settings_completeness(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row public.account_settings%ROWTYPE;
  v_crit text[] := '{}';
  v_rec  text[] := '{}';
BEGIN
  SELECT * INTO v_row FROM public.account_settings WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configured', false,
      'critical_missing', '["No account_settings row found"]'::jsonb,
      'recommended_missing', '[]'::jsonb,
      'critical_complete', false, 'fully_complete', false);
  END IF;

  -- Critical
  IF v_row.ar_account_id                IS NULL THEN v_crit := v_crit || 'ar_account_id'; END IF;
  IF v_row.ap_account_id                IS NULL THEN v_crit := v_crit || 'ap_account_id'; END IF;
  IF v_row.sales_account_id             IS NULL THEN v_crit := v_crit || 'sales_account_id'; END IF;
  IF v_row.bank_account_id              IS NULL THEN v_crit := v_crit || 'bank_account_id'; END IF;
  IF v_row.tax_payable_account_id       IS NULL THEN v_crit := v_crit || 'tax_payable_account_id'; END IF;
  IF v_row.retained_earnings_account_id IS NULL THEN v_crit := v_crit || 'retained_earnings_account_id'; END IF;

  -- Recommended
  IF v_row.inventory_account_id               IS NULL THEN v_rec := v_rec || 'inventory_account_id'; END IF;
  IF v_row.cogs_account_id                    IS NULL THEN v_rec := v_rec || 'cogs_account_id'; END IF;
  IF v_row.grni_clearing_account_id           IS NULL THEN v_rec := v_rec || 'grni_clearing_account_id'; END IF;
  IF v_row.purchase_price_variance_account_id IS NULL THEN v_rec := v_rec || 'purchase_price_variance_account_id'; END IF;
  IF v_row.depreciation_expense_account_id    IS NULL THEN v_rec := v_rec || 'depreciation_expense_account_id'; END IF;
  IF v_row.accumulated_depreciation_account_id IS NULL THEN v_rec := v_rec || 'accumulated_depreciation_account_id'; END IF;
  IF v_row.disposal_gain_account_id           IS NULL THEN v_rec := v_rec || 'disposal_gain_account_id'; END IF;
  IF v_row.disposal_loss_account_id           IS NULL THEN v_rec := v_rec || 'disposal_loss_account_id'; END IF;
  IF v_row.wages_expense_account_id           IS NULL THEN v_rec := v_rec || 'wages_expense_account_id'; END IF;
  IF v_row.payroll_clearing_account_id        IS NULL THEN v_rec := v_rec || 'payroll_clearing_account_id'; END IF;
  IF v_row.fx_gain_account_id                 IS NULL THEN v_rec := v_rec || 'fx_gain_account_id'; END IF;
  IF v_row.fx_loss_account_id                 IS NULL THEN v_rec := v_rec || 'fx_loss_account_id'; END IF;

  RETURN jsonb_build_object(
    'configured',          true,
    'critical_missing',    to_jsonb(v_crit),
    'recommended_missing', to_jsonb(v_rec),
    'critical_complete',   (array_length(v_crit, 1) IS NULL),
    'fully_complete',      (array_length(v_crit, 1) IS NULL AND array_length(v_rec, 1) IS NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_settings_completeness(uuid) TO authenticated;
