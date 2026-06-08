
-- ============================================================
-- Phase 2: Posting Profile Engine
--   • posting_profiles table
--   • RLS policies
--   • Performance indices
--   • resolve_posting_profile RPC function
--   • posting_status lifecycle column on sub-ledger tables
-- ============================================================

-- ── 1. posting_profiles table ────────────────────────────────

CREATE TABLE public.posting_profiles (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module           TEXT        NOT NULL,
  transaction_type TEXT        NOT NULL,
  account_role     TEXT        NOT NULL,
  gl_account_id    UUID        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  entity_scope     JSONB       DEFAULT NULL,
  effective_from   DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  priority         INTEGER     NOT NULL DEFAULT 100,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pp_module_values CHECK (module IN (
    'AR', 'AP', 'INVENTORY', 'FIXED_ASSETS', 'BANK'
  )),
  CONSTRAINT pp_transaction_type_values CHECK (transaction_type IN (
    -- AR
    'INVOICE', 'PAYMENT', 'CREDIT_NOTE',
    -- AP
    'BILL', 'BILL_PAYMENT', 'DEBIT_NOTE',
    -- INVENTORY
    'GOODS_RECEIPT', 'INV_ADJUSTMENT', 'STOCK_WRITE_OFF',
    -- FIXED_ASSETS
    'ASSET_ACQUISITION', 'DEPRECIATION', 'DISPOSAL',
    'ASSET_WRITE_OFF', 'ASSET_ADJUSTMENT',
    -- BANK
    'BANK_TRANSFER', 'BANK_FEE', 'BANK_INTEREST'
  )),
  CONSTRAINT pp_account_role_values CHECK (account_role IN (
    'CONTROL_DEBIT', 'CONTROL_CREDIT', 'REVENUE', 'COGS',
    'TAX', 'CLEARING', 'EXPENSE', 'ASSET'
  )),
  CONSTRAINT pp_effective_dates CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT pp_priority_positive CHECK (priority >= 1)
);

-- ── 2. updated_at auto-touch ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_touch_posting_profile_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_posting_profile_updated_at
  BEFORE UPDATE ON public.posting_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_posting_profile_updated_at();

-- ── 3. Indices ────────────────────────────────────────────────

-- Main lookup index (module + transaction type + role + is_active + date)
CREATE INDEX idx_pp_lookup ON public.posting_profiles
  (tenant_id, module, transaction_type, account_role, is_active, effective_from);

-- GIN index for entity_scope containment queries (@>)
CREATE INDEX idx_pp_entity_scope ON public.posting_profiles
  USING GIN (entity_scope)
  WHERE entity_scope IS NOT NULL;

-- ── 4. RLS ────────────────────────────────────────────────────

ALTER TABLE public.posting_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_select ON public.posting_profiles
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY pp_insert ON public.posting_profiles
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY pp_update ON public.posting_profiles
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY pp_delete ON public.posting_profiles
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- ── 5. RPC: resolve_posting_profile ──────────────────────────
--
-- Resolution order per account_role:
--   1. Entity-specific: entity_scope @> p_entity_scope (highest priority)
--   2. Org-wide default: entity_scope IS NULL (lowest priority)
-- First match for each role wins; missing roles are omitted from result.
--
-- Returns: JSONB { role: { gl_account_id, account_code, account_name, matched_by } }

CREATE OR REPLACE FUNCTION public.resolve_posting_profile(
  p_module           TEXT,
  p_transaction_type TEXT,
  p_date             DATE  DEFAULT CURRENT_DATE,
  p_entity_scope     JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID   := public.get_user_tenant_id();
  v_result    JSONB  := '{}'::JSONB;
  v_roles     TEXT[] := ARRAY[
    'CONTROL_DEBIT', 'CONTROL_CREDIT', 'REVENUE', 'COGS',
    'TAX', 'CLEARING', 'EXPENSE', 'ASSET'
  ];
  v_role TEXT;
  v_acct UUID;
  v_code TEXT;
  v_name TEXT;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'resolve_posting_profile: tenant not found for current user';
  END IF;

  FOREACH v_role IN ARRAY v_roles LOOP
    -- ── Priority 1: entity-specific profile ──────────────────
    IF p_entity_scope IS NOT NULL AND p_entity_scope != '{}'::JSONB THEN
      SELECT pp.gl_account_id, a.account_code, a.account_name
        INTO v_acct, v_code, v_name
      FROM public.posting_profiles pp
      JOIN public.accounts a ON a.id = pp.gl_account_id
      WHERE pp.tenant_id        = v_tenant_id
        AND pp.module           = p_module
        AND pp.transaction_type = p_transaction_type
        AND pp.account_role     = v_role
        AND pp.is_active        = TRUE
        AND pp.effective_from  <= p_date
        AND (pp.effective_to IS NULL OR pp.effective_to >= p_date)
        AND pp.entity_scope IS NOT NULL
        AND pp.entity_scope @> p_entity_scope
      ORDER BY pp.priority ASC
      LIMIT 1;

      IF FOUND THEN
        v_result := v_result || jsonb_build_object(v_role, jsonb_build_object(
          'gl_account_id', v_acct,
          'account_code',  v_code,
          'account_name',  v_name,
          'matched_by',    'entity_scope'
        ));
        CONTINUE;
      END IF;
    END IF;

    -- ── Priority 2: org-wide default ─────────────────────────
    SELECT pp.gl_account_id, a.account_code, a.account_name
      INTO v_acct, v_code, v_name
    FROM public.posting_profiles pp
    JOIN public.accounts a ON a.id = pp.gl_account_id
    WHERE pp.tenant_id        = v_tenant_id
      AND pp.module           = p_module
      AND pp.transaction_type = p_transaction_type
      AND pp.account_role     = v_role
      AND pp.is_active        = TRUE
      AND pp.effective_from  <= p_date
      AND (pp.effective_to IS NULL OR pp.effective_to >= p_date)
      AND (pp.entity_scope IS NULL OR pp.entity_scope = '{}'::JSONB)
    ORDER BY pp.priority ASC
    LIMIT 1;

    IF FOUND THEN
      v_result := v_result || jsonb_build_object(v_role, jsonb_build_object(
        'gl_account_id', v_acct,
        'account_code',  v_code,
        'account_name',  v_name,
        'matched_by',    'default'
      ));
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_posting_profile(TEXT, TEXT, DATE, JSONB) TO authenticated;

COMMENT ON FUNCTION public.resolve_posting_profile IS
  'Resolves GL accounts for a sub-ledger posting event. Returns a JSON object mapping each '
  'account_role to { gl_account_id, account_code, account_name, matched_by }. '
  'Resolution order: entity-specific > org-wide default. Missing roles are omitted.';

-- ── 6. posting_status lifecycle column ───────────────────────
-- Parallel lifecycle tracking alongside the existing status column.
-- Existing status values (draft/posted/voided) continue to control UI
-- while posting_status tracks the formal approval workflow.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT invoices_posting_status_values
      CHECK (posting_status IN ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REVERSED','VOID'));

ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT supplier_bills_posting_status_values
      CHECK (posting_status IN ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REVERSED','VOID'));

-- Backfill posting_status from existing status
UPDATE public.invoices
SET posting_status = CASE status
  WHEN 'posted' THEN 'POSTED'
  WHEN 'voided' THEN 'VOID'
  ELSE 'DRAFT'
END;

UPDATE public.supplier_bills
SET posting_status = CASE status
  WHEN 'posted' THEN 'POSTED'
  WHEN 'voided' THEN 'VOID'
  ELSE 'DRAFT'
END;

-- ── 7. Trigger: keep posting_status in sync with status ──────
-- When status transitions to posted/voided, sync posting_status.

CREATE OR REPLACE FUNCTION public.fn_sync_posting_status_invoices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.posting_status := CASE NEW.status
      WHEN 'posted' THEN 'POSTED'
      WHEN 'voided' THEN 'VOID'
      ELSE NEW.posting_status  -- preserve existing lifecycle state
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_posting_status_invoices
  BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_posting_status_invoices();

CREATE OR REPLACE FUNCTION public.fn_sync_posting_status_bills()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.posting_status := CASE NEW.status
      WHEN 'posted' THEN 'POSTED'
      WHEN 'voided' THEN 'VOID'
      ELSE NEW.posting_status
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_posting_status_bills
  BEFORE UPDATE OF status ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_posting_status_bills();

-- ── Column documentation ──────────────────────────────────────

COMMENT ON TABLE public.posting_profiles IS
  'Configurable GL account mappings for each sub-ledger module and transaction type. '
  'Resolution order: entity-specific first, then org-wide default.';

COMMENT ON COLUMN public.posting_profiles.module IS 'Sub-ledger module: AR, AP, INVENTORY, FIXED_ASSETS, or BANK.';
COMMENT ON COLUMN public.posting_profiles.transaction_type IS 'Event within the module: e.g. INVOICE, PAYMENT, DEPRECIATION.';
COMMENT ON COLUMN public.posting_profiles.account_role IS 'What role this account plays in the journal entry: CONTROL_DEBIT, REVENUE, COGS, etc.';
COMMENT ON COLUMN public.posting_profiles.entity_scope IS 'NULL = org-wide default. {customer_id:...} = customer-specific. {vendor_id:...} = vendor-specific.';
COMMENT ON COLUMN public.posting_profiles.priority IS 'Lower value wins when multiple profiles match the same module/type/role/scope. Default 100.';
COMMENT ON COLUMN public.invoices.posting_status IS 'Formal lifecycle state: DRAFT > PENDING_APPROVAL > APPROVED > POSTED > REVERSED/VOID.';
COMMENT ON COLUMN public.supplier_bills.posting_status IS 'Formal lifecycle state: DRAFT > PENDING_APPROVAL > APPROVED > POSTED > REVERSED/VOID.';
