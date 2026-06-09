-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5: Fixed Asset Register (IAS 16)
-- Creates: asset_categories, fixed_assets, asset_depreciation,
--          asset_disposals, asset_subledger
-- Adds:    asset_id column to journal_lines
--          calculate_gl_balance_for_account RPC (used by post-asset-transaction)
--          seed_fixed_asset_coa_accounts helper
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. asset_categories — one row per category, defines all GL accounts + method
CREATE TABLE IF NOT EXISTS asset_categories (
  id                                   UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                            UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                                 TEXT         NOT NULL,
  depreciation_method                  TEXT         NOT NULL DEFAULT 'straight_line'
                                         CHECK (depreciation_method IN ('straight_line','declining_balance','double_declining')),
  default_useful_life_months           INTEGER      NOT NULL DEFAULT 60,
  proration_method                     TEXT         NOT NULL DEFAULT 'full_month'
                                         CHECK (proration_method IN ('full_month','proportional','none')),
  asset_account_id                     UUID         REFERENCES accounts(id),
  accumulated_depreciation_account_id  UUID         REFERENCES accounts(id),
  depreciation_expense_account_id      UUID         REFERENCES accounts(id),
  disposal_gain_account_id             UUID         REFERENCES accounts(id),
  disposal_loss_account_id             UUID         REFERENCES accounts(id),
  is_active                            BOOLEAN      NOT NULL DEFAULT true,
  created_at                           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. fixed_assets — one record per physical asset (IAS 16 asset register)
CREATE TABLE IF NOT EXISTS fixed_assets (
  id                       UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_name               TEXT         NOT NULL,
  description              TEXT,
  category_id              UUID         REFERENCES asset_categories(id),
  asset_account_id         UUID         REFERENCES accounts(id),
  depreciation_account_id  UUID         REFERENCES accounts(id),
  depr_expense_account_id  UUID         REFERENCES accounts(id),
  cost                     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  salvage_value            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months       INTEGER      NOT NULL DEFAULT 60 CHECK (useful_life_months > 0),
  depreciation_method      TEXT         NOT NULL DEFAULT 'straight_line',
  acquisition_date         DATE,
  start_date               DATE,
  accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                   TEXT         NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','disposed','fully_depreciated','impaired')),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fa_salvage_lte_cost CHECK (salvage_value <= cost)
);

-- 3. asset_depreciation — per-period schedule rows (one per asset per month)
CREATE TABLE IF NOT EXISTS asset_depreciation (
  id                       UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id                 UUID         NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period                   TEXT         NOT NULL,  -- YYYY-MM
  depreciation_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_book_value           NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                   TEXT         NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processing','posted','cancelled')),
  journal_entry_id         UUID         REFERENCES journal_entries(id),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT asset_depreciation_unique_period UNIQUE (asset_id, period)
);

-- 4. asset_disposals — one record per disposal event
CREATE TABLE IF NOT EXISTS asset_disposals (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id         UUID         NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  disposal_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
  sale_value       NUMERIC(15,2) NOT NULL DEFAULT 0,
  gain_loss        NUMERIC(15,2) NOT NULL DEFAULT 0,
  journal_entry_id UUID         REFERENCES journal_entries(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 5. asset_subledger — enriched GL-linked sub-ledger for every asset movement
CREATE TABLE IF NOT EXISTS asset_subledger (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id         UUID         NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  journal_line_id  UUID         NOT NULL REFERENCES journal_lines(id),
  journal_id       UUID         REFERENCES journal_entries(id),
  debit            NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit           NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount           NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost             NUMERIC(15,2) NOT NULL DEFAULT 0,
  salvage          NUMERIC(15,2) NOT NULL DEFAULT 0,
  life_years       INTEGER,
  transaction_type TEXT,    -- 'acquisition' | 'depreciation' | 'disposal' | 'adjustment'
  document_id      UUID,
  document_type    TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 6. asset_id on journal_lines (for per-line asset drilldown)
ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES fixed_assets(id);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_ac_tenant       ON asset_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fa_tenant       ON fixed_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fa_status       ON fixed_assets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fa_category     ON fixed_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_adep_asset      ON asset_depreciation(asset_id);
CREATE INDEX IF NOT EXISTS idx_adep_period     ON asset_depreciation(tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_adep_status     ON asset_depreciation(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_adisp_asset     ON asset_disposals(asset_id);
CREATE INDEX IF NOT EXISTS idx_asl_asset       ON asset_subledger(tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_jl_asset        ON journal_lines(asset_id) WHERE asset_id IS NOT NULL;

-- 8. RLS
ALTER TABLE asset_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_depreciation ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_disposals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_subledger    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_iso_asset_categories  ON asset_categories  USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenant_iso_fixed_assets       ON fixed_assets       USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenant_iso_asset_depreciation ON asset_depreciation USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenant_iso_asset_disposals    ON asset_disposals    USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenant_iso_asset_subledger    ON asset_subledger    USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. calculate_gl_balance_for_account RPC
--    Called by the post-asset-transaction edge function for non-blocking
--    reconciliation checks. Returns { balance } = sum(debit - credit) for
--    debit-normal accounts (Assets/Expense) on all posted journal entries.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calculate_gl_balance_for_account(
  p_account_id UUID,
  p_tenant_id  UUID
)
RETURNS TABLE (balance NUMERIC) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::NUMERIC AS balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.tenant_id  = p_tenant_id
    AND je.status     = 'posted';
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_gl_balance_for_account(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_gl_balance_for_account(UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. seed_fixed_asset_coa_accounts — idempotent helper to ensure PP&E accounts
--     exist for a given tenant. Called when the first asset category is created
--     or via the seed-chart-of-accounts edge function.
--     Accounts: 1600 PP&E Cost, 1650 Accum Depreciation, 7100 Depr Expense,
--               8100 Gain on Disposal, 8200 Loss on Disposal
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_fixed_asset_coa_accounts(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_ppe_parent UUID;
BEGIN
  -- Find or create a PP&E parent group under Fixed Assets (account 1500 range)
  SELECT id INTO v_ppe_parent
  FROM accounts
  WHERE tenant_id = p_tenant_id
    AND account_code = '1500'
    AND is_postable = false
  LIMIT 1;

  -- PP&E Cost control account (1600)
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, account_subtype,
    is_active, is_postable, account_level, parent_account_id)
  VALUES (p_tenant_id, '1600', 'Property, Plant & Equipment — Cost',
    'Asset', 'Fixed Asset', true, false, 2, v_ppe_parent)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Accumulated Depreciation (1650) — contra asset, credit-normal
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, account_subtype,
    is_active, is_postable, account_level, parent_account_id)
  SELECT p_tenant_id, '1650', 'Accumulated Depreciation',
    'Asset', 'Accumulated Depreciation', true, true, 3,
    id FROM accounts WHERE tenant_id = p_tenant_id AND account_code = '1600'
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Depreciation Expense (7100)
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, account_subtype,
    is_active, is_postable, account_level)
  VALUES (p_tenant_id, '7100', 'Depreciation Expense',
    'Expense', 'Depreciation & Amortization', true, true, 2)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Gain on Disposal (8100)
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, account_subtype,
    is_active, is_postable, account_level)
  VALUES (p_tenant_id, '8100', 'Gain on Disposal of Assets',
    'Income', 'Other Income', true, true, 2)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Loss on Disposal (8200)
  INSERT INTO accounts (tenant_id, account_code, account_name, account_type, account_subtype,
    is_active, is_postable, account_level)
  VALUES (p_tenant_id, '8200', 'Loss on Disposal of Assets',
    'Expense', 'Other Expense', true, true, 2)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION seed_fixed_asset_coa_accounts(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Trigger: auto-update fixed_assets.updated_at on change
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_touch_fixed_asset_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_fixed_asset ON fixed_assets;
CREATE TRIGGER trg_touch_fixed_asset
  BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION fn_touch_fixed_asset_updated_at();

DROP TRIGGER IF EXISTS trg_touch_asset_category ON asset_categories;
CREATE TRIGGER trg_touch_asset_category
  BEFORE UPDATE ON asset_categories
  FOR EACH ROW EXECUTE FUNCTION fn_touch_fixed_asset_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Trigger: mark asset fully_depreciated when accumulated = (cost - salvage)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_asset_fully_depreciated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active'
     AND NEW.cost > 0
     AND NEW.accumulated_depreciation >= (NEW.cost - NEW.salvage_value) THEN
    NEW.status := 'fully_depreciated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_fully_depreciated ON fixed_assets;
CREATE TRIGGER trg_check_fully_depreciated
  BEFORE UPDATE OF accumulated_depreciation ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION fn_check_asset_fully_depreciated();

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. asset_reconciliation_check RPC
--     Returns sub-ledger total (sum of active asset costs) vs GL balance
--     for the PP&E cost account. Used for balance sheet sign-off.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION asset_reconciliation_check()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id     UUID;
  v_subledger_val NUMERIC(15,2);
  v_subledger_dep NUMERIC(15,2);
  v_gl_cost       NUMERIC(15,2);
  v_gl_dep        NUMERIC(15,2);
  v_cost_var      NUMERIC(15,2);
  v_dep_var       NUMERIC(15,2);
BEGIN
  v_tenant_id := get_user_tenant_id();

  -- Sub-ledger totals from fixed_assets
  SELECT
    COALESCE(SUM(cost), 0),
    COALESCE(SUM(accumulated_depreciation), 0)
  INTO v_subledger_val, v_subledger_dep
  FROM fixed_assets
  WHERE tenant_id = v_tenant_id
    AND status IN ('active', 'fully_depreciated');

  -- GL: sum of debit - credit on all PP&E cost accounts (account_subtype = 'Fixed Asset')
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_gl_cost
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.tenant_id = v_tenant_id
    AND a.account_subtype = 'Fixed Asset'
    AND a.account_type = 'Asset'
    AND je.status = 'posted';

  -- GL: sum of credit - debit on accumulated depreciation accounts (contra-asset)
  SELECT COALESCE(SUM(jl.credit - jl.debit), 0) INTO v_gl_dep
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.tenant_id = v_tenant_id
    AND a.account_subtype = 'Accumulated Depreciation'
    AND je.status = 'posted';

  v_cost_var := ROUND(v_subledger_val - v_gl_cost, 2);
  v_dep_var  := ROUND(v_subledger_dep - v_gl_dep,  2);

  RETURN json_build_object(
    'subledger_cost',          v_subledger_val,
    'subledger_accum_dep',     v_subledger_dep,
    'gl_cost_balance',         v_gl_cost,
    'gl_accum_dep_balance',    v_gl_dep,
    'cost_variance',           v_cost_var,
    'dep_variance',            v_dep_var,
    'status', CASE
      WHEN ABS(v_cost_var) < 0.01 AND ABS(v_dep_var) < 0.01
        THEN 'RECONCILED'
      ELSE 'VARIANCE_DETECTED'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION asset_reconciliation_check() TO authenticated;
