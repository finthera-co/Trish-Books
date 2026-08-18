-- ═══════════════════════════════════════════════════════════════════════════
-- Fixed Asset Register — automatic adoption from the Chart of Accounts
--
-- After a bank statement import every asset purchase lands as a debit on a
-- PP&E ledger, but nothing lands in the asset register: no asset rows, no
-- categories, no accumulated-depreciation contra accounts, no depreciation
-- expense accounts, and therefore no depreciation charge in the final
-- accounts. This migration closes that gap end to end.
--
--   fn_asset_class_profile        name  → class / useful life / method (IAS 16)
--   fn_next_free_account_code     next unused code inside a numbering band
--   fn_ppe_cost_accounts          which ledgers hold capitalised asset cost
--   ensure_asset_gl_accounts      create the accum-dep + depreciation ledgers
--   ensure_asset_categories_from_coa  one asset category per PP&E ledger
--   analyze_coa_assets            dry-run preview of everything that would happen
--   post_depreciation_period      set-based monthly depreciation posting
--   adopt_coa_assets              the one-click orchestrator
--
-- Accounting rules encoded here:
--   • IAS 16.58 — land is not depreciated (unlimited useful life).
--   • IAS 16.55 — depreciation begins when the asset is available for use;
--     the full-month convention charges from the month of acquisition.
--   • IAS 16.50/53 — depreciable amount = cost − residual value, allocated
--     over the useful life; rounding is absorbed by the final period so the
--     schedule closes exactly on the depreciable amount.
--   • The contra account is credited (never the cost account), so cost and
--     accumulated depreciation stay separately disclosable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Schema additions
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS is_depreciable         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source                 TEXT    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_journal_line_id UUID    REFERENCES journal_lines(id);

COMMENT ON COLUMN fixed_assets.is_depreciable IS
  'False for land and other indefinite-life items (IAS 16.58) — no schedule is generated.';
COMMENT ON COLUMN fixed_assets.source_journal_line_id IS
  'The already-posted GL debit this asset was adopted from. Adoption never re-posts the cost; this column is what makes the run idempotent.';

-- Land carries a zero useful life, so the original "> 0" check has to become
-- conditional. Drop whatever the check is called in this database first.
DO $$
DECLARE v_con TEXT;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'fixed_assets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%useful_life_months%'
  LOOP
    EXECUTE format('ALTER TABLE fixed_assets DROP CONSTRAINT %I', v_con);
  END LOOP;
END $$;

ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fa_life_positive_when_depreciable;
ALTER TABLE fixed_assets ADD  CONSTRAINT fa_life_positive_when_depreciable
  CHECK (is_depreciable = false OR useful_life_months > 0);

-- One asset per source GL line: re-running adoption can never duplicate the register.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_source_journal_line
  ON fixed_assets(source_journal_line_id) WHERE source_journal_line_id IS NOT NULL;

ALTER TABLE asset_categories
  ADD COLUMN IF NOT EXISTS is_depreciable    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_account_id UUID REFERENCES accounts(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ac_source_account
  ON asset_categories(tenant_id, source_account_id) WHERE source_account_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. fn_asset_class_profile — asset class, useful life and method from a name
--
-- Ordered most-specific first: "Computer & Equipments" must resolve as IT
-- (4 years), not as generic equipment (8 years). Lives follow common IAS 16
-- practice; they are defaults the user can override per category afterwards.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_asset_class_profile(p_name TEXT)
RETURNS TABLE (class_key TEXT, life_months INTEGER, method TEXT, depreciable BOOLEAN)
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v TEXT := lower(coalesce(p_name, ''));
BEGIN
  -- IAS 16.58: land has an unlimited useful life and is not depreciated.
  IF v ~ '(^|[^a-z])land|freehold|(^|[^a-z])estate|watta' THEN
    RETURN QUERY SELECT 'land'::TEXT, 0, 'straight_line'::TEXT, false; RETURN;
  END IF;
  IF v ~ 'build|construct|premise|structure|warehouse|factory' THEN
    RETURN QUERY SELECT 'building'::TEXT, 240, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'tunnel|politanel|polytanel|greenhouse|green house|nursery|(^|[^a-z])shed' THEN
    RETURN QUERY SELECT 'structure'::TEXT, 120, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'vehicle|lorry|truck|(^|[^a-z])van|motor|tractor|(^|[^a-z])bus|(^|[^a-z])cab|bike|cycle' THEN
    RETURN QUERY SELECT 'vehicle'::TEXT, 60, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'computer|laptop|desktop|server|printer|scanner|network|router|software|(^|[^a-z])it ' THEN
    RETURN QUERY SELECT 'it_equipment'::TEXT, 48, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'mobile|phone|tablet|(^|[^a-z])ipad' THEN
    RETURN QUERY SELECT 'mobile_device'::TEXT, 36, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'cctv|camera|surveillance|security|alarm|(^|[^a-z])lock' THEN
    RETURN QUERY SELECT 'security_equipment'::TEXT, 60, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'name board|signage|sign board|hoarding|banner' THEN
    RETURN QUERY SELECT 'signage'::TEXT, 60, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'generator|machine|machinery|(^|[^a-z])plant|pump|compressor|boiler|motor unit' THEN
    RETURN QUERY SELECT 'plant_machinery'::TEXT, 120, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'container|cylinder|ceylinder|(^|[^a-z])tank|barrel|drum' THEN
    RETURN QUERY SELECT 'containers'::TEXT, 120, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'furniture|fitting|fixture|partition|cabinet|chair|table|rack|(^|[^a-z])bed|mattress|carpet' THEN
    RETURN QUERY SELECT 'furniture_fittings'::TEXT, 120, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'intangible|goodwill|licen|trademark|patent|website|web site|app develop' THEN
    -- IAS 38 amortisation, carried through the same schedule machinery.
    RETURN QUERY SELECT 'intangible'::TEXT, 48, 'straight_line'::TEXT, true; RETURN;
  END IF;
  IF v ~ 'equipment|equipments|instrument|tool|appliance|air condition|(^|[^a-z])ac |fridge|refriger|oven|projector' THEN
    RETURN QUERY SELECT 'equipment'::TEXT, 96, 'straight_line'::TEXT, true; RETURN;
  END IF;

  RETURN QUERY SELECT 'other'::TEXT, 60, 'straight_line'::TEXT, true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_asset_class_profile(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. fn_next_free_account_code — first unused code walking a numbering band
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_next_free_account_code(
  p_tenant_id UUID, p_start INTEGER, p_max INTEGER, p_step INTEGER
)
RETURNS TEXT LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE c INTEGER := p_start;
BEGIN
  WHILE c <= p_max LOOP
    IF NOT EXISTS (
      SELECT 1 FROM accounts WHERE tenant_id = p_tenant_id AND account_code = c::TEXT
    ) THEN
      RETURN c::TEXT;
    END IF;
    c := c + p_step;
  END LOOP;
  -- Band exhausted at the requested step — fall back to single increments.
  IF p_step > 1 THEN
    RETURN public.fn_next_free_account_code(p_tenant_id, p_start, p_max, 1);
  END IF;
  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. fn_ppe_cost_accounts — the ledgers that hold capitalised asset cost
--
-- Matches on detail type first and falls back to the 1500–1799 numbering
-- band, so it works both for the standard seeded COA and for imported charts
-- that use their own subtype wording ("Property, Plant & Equipment").
-- Contra and accumulated-depreciation ledgers are excluded by construction.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ppe_cost_accounts(p_tenant_id UUID)
RETURNS TABLE (account_id UUID, account_code TEXT, account_name TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT a.id, a.account_code, a.account_name
  FROM accounts a
  WHERE a.tenant_id   = p_tenant_id
    AND a.account_type = 'Asset'
    AND a.is_active
    AND a.is_postable
    AND NOT a.is_contra
    AND lower(coalesce(a.account_subtype, '')) NOT LIKE '%accumulated depreciation%'
    AND lower(a.account_name)                  NOT LIKE '%accumulated depreciation%'
    AND (
          lower(coalesce(a.account_subtype, '')) ~ 'fixed asset|property, plant|plant & equipment|plant and equipment|furniture|vehicle|building|machinery|equipment|intangible'
       OR (a.account_code ~ '^[0-9]+$' AND a.account_code::INTEGER BETWEEN 1500 AND 1799)
    )
  ORDER BY a.account_code;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ppe_cost_accounts(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. fs_link_depreciation_account — keep the P&L complete
--
-- The statement engine only totals ledgers that are mapped to a statement
-- line, so a brand-new depreciation ledger would otherwise be invisible in
-- the final accounts. Map it to a depreciation line when the tenant has one,
-- otherwise to administrative expenses (presentation by function).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_link_depreciation_account(
  p_tenant_id UUID, p_account_id UUID
)
RETURNS VOID LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_line UUID;
BEGIN
  SELECT l.id INTO v_line
  FROM fs_lines l
  JOIN fs_statements s ON s.id = l.statement_id
  WHERE l.tenant_id = p_tenant_id
    AND l.line_type = 'detail'
    AND (
      lower(l.label) LIKE '%depreciation%'
      OR lower(l.label) LIKE '%administrat%'
      OR l.line_code IN ('DEPRECIATION', 'DEPRECIATION_AMORT', 'ADMIN_EXP')
    )
  ORDER BY
    CASE WHEN lower(l.label) LIKE '%depreciation%' THEN 0 ELSE 1 END,
    l.sort_order
  LIMIT 1;

  IF v_line IS NULL THEN RETURN; END IF;

  INSERT INTO fs_line_accounts (tenant_id, line_id, account_id)
  SELECT p_tenant_id, v_line, p_account_id
  WHERE NOT EXISTS (
    SELECT 1 FROM fs_line_accounts
    WHERE tenant_id = p_tenant_id AND line_id = v_line AND account_id = p_account_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. ensure_asset_gl_accounts — the contra and expense ledgers IAS 16 needs
--
-- For every depreciable PP&E cost ledger this creates (idempotently):
--   "Accumulated Depreciation – <class>"  contra asset, credit-normal
--   "Depreciation – <class>"              expense
-- both hung under a header so the balance sheet and P&L roll them up into a
-- single line while the note keeps the per-class detail.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_asset_gl_accounts(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r               RECORD;
  v_prof          RECORD;
  v_ppe_parent    UUID;
  v_accum_parent  UUID;
  v_exp_parent    UUID;
  v_code          TEXT;
  v_name          TEXT;
  v_id            UUID;
  v_created       INTEGER := 0;
BEGIN
  -- ── PP&E header (parent for the accumulated depreciation header) ──
  SELECT id INTO v_ppe_parent FROM accounts
  WHERE tenant_id = p_tenant_id AND account_type = 'Asset' AND is_postable = false
    AND (lower(account_name) LIKE '%property, plant%'
      OR lower(account_name) LIKE '%property plant%'
      OR lower(account_name) LIKE '%fixed asset%')
  ORDER BY account_code LIMIT 1;

  IF v_ppe_parent IS NULL THEN
    v_code := public.fn_next_free_account_code(p_tenant_id, 1500, 1799, 100);
    INSERT INTO accounts (tenant_id, account_code, account_name, account_type,
                          account_subtype, is_postable, created_from)
    VALUES (p_tenant_id, v_code, 'Property, Plant & Equipment', 'Asset',
            'Property, Plant & Equipment', false, 'asset_adoption')
    RETURNING id INTO v_ppe_parent;
    v_created := v_created + 1;
  END IF;

  -- ── Accumulated depreciation header (contra, sits inside PP&E) ──
  SELECT id INTO v_accum_parent FROM accounts
  WHERE tenant_id = p_tenant_id AND account_type = 'Asset' AND is_postable = false
    AND lower(account_name) LIKE '%accumulated depreciation%'
  ORDER BY account_code LIMIT 1;

  IF v_accum_parent IS NULL THEN
    v_code := public.fn_next_free_account_code(p_tenant_id, 1800, 1990, 100);
    INSERT INTO accounts (tenant_id, account_code, account_name, account_type,
                          account_subtype, is_postable, is_contra, parent_account_id, created_from)
    VALUES (p_tenant_id, v_code, 'Accumulated Depreciation', 'Asset',
            'Accumulated Depreciation', false, true, v_ppe_parent, 'asset_adoption')
    RETURNING id INTO v_accum_parent;
    v_created := v_created + 1;
  END IF;

  -- ── Depreciation expense header ──
  SELECT id INTO v_exp_parent FROM accounts
  WHERE tenant_id = p_tenant_id AND account_type = 'Expense' AND is_postable = false
    AND lower(account_name) LIKE '%depreciation%'
  ORDER BY account_code LIMIT 1;

  IF v_exp_parent IS NULL THEN
    v_code := public.fn_next_free_account_code(p_tenant_id, 6800, 6990, 100);
    INSERT INTO accounts (tenant_id, account_code, account_name, account_type,
                          account_subtype, is_postable, created_from)
    VALUES (p_tenant_id, v_code, 'Depreciation & Amortisation', 'Expense',
            'Depreciation', false, 'asset_adoption')
    RETURNING id INTO v_exp_parent;
    v_created := v_created + 1;
  END IF;

  -- ── One contra + one expense ledger per depreciable class ──
  FOR r IN SELECT * FROM public.fn_ppe_cost_accounts(p_tenant_id) LOOP
    SELECT * INTO v_prof FROM public.fn_asset_class_profile(r.account_name);
    CONTINUE WHEN NOT v_prof.depreciable;

    v_name := 'Accumulated Depreciation – ' || r.account_name;
    SELECT id INTO v_id FROM accounts
    WHERE tenant_id = p_tenant_id AND lower(account_name) = lower(v_name);
    IF v_id IS NULL THEN
      v_code := public.fn_next_free_account_code(p_tenant_id, 1810, 1990, 10);
      INSERT INTO accounts (tenant_id, account_code, account_name, account_type,
                            account_subtype, is_postable, is_contra, parent_account_id, created_from)
      VALUES (p_tenant_id, v_code, v_name, 'Asset',
              'Accumulated Depreciation', true, true, v_accum_parent, 'asset_adoption');
      v_created := v_created + 1;
    END IF;

    v_name := 'Depreciation – ' || r.account_name;
    SELECT id INTO v_id FROM accounts
    WHERE tenant_id = p_tenant_id AND lower(account_name) = lower(v_name);
    IF v_id IS NULL THEN
      v_code := public.fn_next_free_account_code(p_tenant_id, 6810, 6990, 10);
      INSERT INTO accounts (tenant_id, account_code, account_name, account_type,
                            account_subtype, is_postable, parent_account_id, created_from)
      VALUES (p_tenant_id, v_code, v_name, 'Expense',
              'Depreciation', true, v_exp_parent, 'asset_adoption')
      RETURNING id INTO v_id;
      v_created := v_created + 1;
    END IF;
    PERFORM public.fs_link_depreciation_account(p_tenant_id, v_id);
  END LOOP;

  RETURN jsonb_build_object('accounts_created', v_created);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. ensure_asset_categories_from_coa — one category per PP&E ledger
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_asset_categories_from_coa(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  v_prof   RECORD;
  v_accum  UUID;
  v_exp    UUID;
  v_id     UUID;
  v_new    INTEGER := 0;
  v_upd    INTEGER := 0;
BEGIN
  FOR r IN SELECT * FROM public.fn_ppe_cost_accounts(p_tenant_id) LOOP
    SELECT * INTO v_prof FROM public.fn_asset_class_profile(r.account_name);

    SELECT id INTO v_accum FROM accounts
    WHERE tenant_id = p_tenant_id
      AND lower(account_name) = lower('Accumulated Depreciation – ' || r.account_name);
    SELECT id INTO v_exp FROM accounts
    WHERE tenant_id = p_tenant_id
      AND lower(account_name) = lower('Depreciation – ' || r.account_name);

    SELECT id INTO v_id FROM asset_categories
    WHERE tenant_id = p_tenant_id AND source_account_id = r.account_id;

    IF v_id IS NULL THEN
      INSERT INTO asset_categories (
        tenant_id, name, depreciation_method, default_useful_life_months,
        proration_method, asset_account_id, accumulated_depreciation_account_id,
        depreciation_expense_account_id, is_active, is_depreciable, source_account_id
      ) VALUES (
        p_tenant_id, r.account_name, v_prof.method,
        GREATEST(v_prof.life_months, 1), 'full_month',
        r.account_id, v_accum, v_exp, true, v_prof.depreciable, r.account_id
      );
      v_new := v_new + 1;
    ELSE
      -- Only fill gaps: never overwrite a life or method the user has tuned.
      UPDATE asset_categories SET
        accumulated_depreciation_account_id = COALESCE(accumulated_depreciation_account_id, v_accum),
        depreciation_expense_account_id     = COALESCE(depreciation_expense_account_id, v_exp),
        asset_account_id                    = COALESCE(asset_account_id, r.account_id),
        updated_at                          = NOW()
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('categories_created', v_new, 'categories_updated', v_upd);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. fn_asset_name_from_je — readable register names from the GL narrative
--    "Bank import: Sameera Furniture" → "Furniture & Fittings – Sameera Furniture"
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_asset_name_from_je(p_class TEXT, p_description TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT left(
    CASE
      WHEN t.d = '' OR lower(t.d) = lower(p_class) THEN p_class
      ELSE p_class || ' – ' || t.d
    END, 160)
  FROM (
    SELECT btrim(regexp_replace(
      coalesce(p_description, ''),
      '^(bank import|bank statement|petty cash|payment voucher|journal entry|journal)\s*[:\-–]\s*',
      '', 'i')) AS d
  ) t;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. analyze_coa_assets — dry run
--
-- One row per posted PP&E debit, with the class the engine would assign, the
-- useful life, and the depreciation that would be caught up to the chosen
-- period. Writes nothing, so the user sees the whole outcome before agreeing.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analyze_coa_assets(p_through_period TEXT DEFAULT NULL)
RETURNS TABLE (
  account_id            UUID,
  account_code          TEXT,
  account_name          TEXT,
  class_key             TEXT,
  useful_life_months    INTEGER,
  depreciation_method   TEXT,
  is_depreciable        BOOLEAN,
  journal_line_id       UUID,
  journal_entry_id      UUID,
  entry_date            DATE,
  proposed_name         TEXT,
  cost                  NUMERIC,
  months_to_charge      INTEGER,
  est_depreciation      NUMERIC,
  est_net_book_value    NUMERIC,
  already_adopted       BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT get_user_tenant_id() AS tenant_id
  ),
  through AS (
    SELECT COALESCE(
      NULLIF(p_through_period, ''),
      (SELECT to_char(MAX(je.entry_date), 'YYYY-MM')
         FROM journal_entries je, me
        WHERE je.tenant_id = me.tenant_id AND je.status = 'posted'),
      to_char(CURRENT_DATE, 'YYYY-MM')
    ) AS period
  ),
  src AS (
    SELECT
      ppe.account_id,
      ppe.account_code,
      ppe.account_name,
      prof.class_key,
      prof.life_months,
      prof.method,
      prof.depreciable,
      jl.id          AS journal_line_id,
      je.id          AS journal_entry_id,
      je.entry_date,
      jl.debit       AS cost,
      EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.source_journal_line_id = jl.id)
                     AS already_adopted,
      public.fn_asset_name_from_je(ppe.account_name, je.description) AS proposed_name,
      (SELECT period FROM through) AS through_period
    FROM me
    CROSS JOIN LATERAL public.fn_ppe_cost_accounts(me.tenant_id) ppe
    CROSS JOIN LATERAL public.fn_asset_class_profile(ppe.account_name) prof
    JOIN journal_lines   jl ON jl.account_id = ppe.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = me.tenant_id
      AND je.status    = 'posted'
      AND jl.debit     > 0
  ),
  calc AS (
    SELECT src.*,
      CASE WHEN NOT src.depreciable OR src.life_months <= 0 THEN 0
           ELSE GREATEST(0, LEAST(
             src.life_months,
             ( (split_part(src.through_period, '-', 1)::INT * 12 + split_part(src.through_period, '-', 2)::INT)
             - (EXTRACT(YEAR FROM src.entry_date)::INT * 12 + EXTRACT(MONTH FROM src.entry_date)::INT)
             ) + 1
           ))
      END AS months_to_charge
    FROM src
  )
  SELECT
    calc.account_id,
    calc.account_code,
    calc.account_name,
    calc.class_key,
    calc.life_months,
    calc.method,
    calc.depreciable,
    calc.journal_line_id,
    calc.journal_entry_id,
    calc.entry_date,
    calc.proposed_name,
    calc.cost,
    calc.months_to_charge,
    -- LEAST() ignores NULLs, so the non-depreciable case is branched, not divided.
    CASE WHEN calc.months_to_charge = 0 OR calc.life_months = 0 THEN 0::NUMERIC
         ELSE LEAST(calc.cost, ROUND(calc.cost / calc.life_months, 2) * calc.months_to_charge)
    END AS est_depreciation,
    calc.cost - CASE WHEN calc.months_to_charge = 0 OR calc.life_months = 0 THEN 0::NUMERIC
                     ELSE LEAST(calc.cost, ROUND(calc.cost / calc.life_months, 2) * calc.months_to_charge)
                END AS est_net_book_value,
    calc.already_adopted
  FROM calc
  ORDER BY calc.account_code, calc.entry_date;
$$;

GRANT EXECUTE ON FUNCTION public.analyze_coa_assets(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10. generate_asset_schedule — the IAS 16 allocation for one asset
--
-- Straight line is built set-based; reducing balance needs the prior period's
-- carrying amount so it walks month by month. Both close exactly on the
-- depreciable amount: the final period absorbs accumulated rounding, which is
-- what stops a schedule from leaving a few cents stranded in the NBV.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_asset_schedule(p_asset_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fa        fixed_assets%ROWTYPE;
  v_base    NUMERIC(15,2);
  v_monthly NUMERIC(15,2);
  v_start   DATE;
  v_rows    INTEGER := 0;
  v_accum   NUMERIC(15,2) := 0;
  v_nbv     NUMERIC(15,2);
  v_dep     NUMERIC(15,2);
  v_rate    NUMERIC;
  i         INTEGER;
BEGIN
  SELECT * INTO fa FROM fixed_assets WHERE id = p_asset_id;
  IF NOT FOUND OR NOT fa.is_depreciable OR fa.useful_life_months <= 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM asset_depreciation WHERE asset_id = p_asset_id) THEN RETURN 0; END IF;

  v_base  := fa.cost - COALESCE(fa.salvage_value, 0);
  IF v_base <= 0 THEN RETURN 0; END IF;

  -- IAS 16.55 — full-month convention: charge from the month of acquisition.
  v_start := date_trunc('month', COALESCE(fa.start_date, fa.acquisition_date, CURRENT_DATE))::DATE;

  IF fa.depreciation_method IN ('declining_balance', 'double_declining') THEN
    v_rate := (2.0 / (fa.useful_life_months / 12.0)) / 12.0;
    v_nbv  := fa.cost;
    FOR i IN 0 .. fa.useful_life_months - 1 LOOP
      EXIT WHEN v_nbv <= COALESCE(fa.salvage_value, 0);
      v_dep := ROUND(v_nbv * v_rate, 2);
      -- Standard practice: switch to straight line once it charges more,
      -- so the asset is fully written down within its useful life.
      v_dep := GREATEST(v_dep, ROUND((v_nbv - COALESCE(fa.salvage_value, 0)) / (fa.useful_life_months - i), 2));
      IF v_nbv - v_dep < COALESCE(fa.salvage_value, 0) OR i = fa.useful_life_months - 1 THEN
        v_dep := v_nbv - COALESCE(fa.salvage_value, 0);
      END IF;
      EXIT WHEN v_dep <= 0;
      v_accum := v_accum + v_dep;
      v_nbv   := fa.cost - v_accum;
      INSERT INTO asset_depreciation (tenant_id, asset_id, period, depreciation_amount,
                                      accumulated_depreciation, net_book_value, status)
      VALUES (fa.tenant_id, fa.id, to_char(v_start + (i || ' months')::INTERVAL, 'YYYY-MM'),
              v_dep, v_accum, v_nbv, 'pending');
      v_rows := v_rows + 1;
    END LOOP;
    RETURN v_rows;
  END IF;

  -- Straight line
  v_monthly := ROUND(v_base / fa.useful_life_months, 2);
  INSERT INTO asset_depreciation (tenant_id, asset_id, period, depreciation_amount,
                                  accumulated_depreciation, net_book_value, status)
  SELECT
    fa.tenant_id,
    fa.id,
    to_char(v_start + (n || ' months')::INTERVAL, 'YYYY-MM'),
    CASE WHEN n = fa.useful_life_months - 1
         THEN v_base - v_monthly * (fa.useful_life_months - 1)
         ELSE v_monthly END,
    CASE WHEN n = fa.useful_life_months - 1
         THEN v_base
         ELSE v_monthly * (n + 1) END,
    fa.cost - CASE WHEN n = fa.useful_life_months - 1
                   THEN v_base
                   ELSE v_monthly * (n + 1) END,
    'pending'
  FROM generate_series(0, fa.useful_life_months - 1) AS n;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. post_depreciation_period_internal — one journal per period, set-based
--
-- The per-asset edge function issues one journal per asset per period, which
-- is fine for a handful of assets but not for a multi-year catch-up over a
-- register of hundreds. This posts the period as a single balanced journal
-- carrying one debit and one credit line per asset, so the GL keeps full
-- per-asset drilldown (journal_lines.asset_id) without the row explosion.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_depreciation_period_internal(
  p_tenant_id UUID, p_user_id UUID, p_period TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date       DATE;
  v_je         UUID;
  v_key        TEXT;
  v_assets     INTEGER := 0;
  v_total      NUMERIC(15,2) := 0;
  v_unresolved INTEGER := 0;
BEGIN
  IF p_period !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Period must be YYYY-MM, got "%"', p_period;
  END IF;

  -- The charge belongs at the period end, not its start.
  v_date := (date_trunc('month', (p_period || '-01')::DATE) + INTERVAL '1 month - 1 day')::DATE;

  IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.tenant_id = p_tenant_id AND fp.status = 'closed'
      AND v_date BETWEEN fp.period_start AND fp.period_end
  ) THEN
    RETURN jsonb_build_object('period', p_period, 'assets', 0, 'amount', 0,
                              'skipped_reason', 'fiscal_period_closed');
  END IF;

  -- Rows due this period whose ledgers resolve (asset snapshot, then category).
  CREATE TEMP TABLE _dep_due ON COMMIT DROP AS
  SELECT ad.id AS dep_id, ad.asset_id, ad.depreciation_amount, ad.accumulated_depreciation,
         fa.asset_name, fa.cost, fa.salvage_value,
         COALESCE(fa.depr_expense_account_id, ac.depreciation_expense_account_id)     AS expense_account_id,
         COALESCE(fa.depreciation_account_id,  ac.accumulated_depreciation_account_id) AS accum_account_id
  FROM asset_depreciation ad
  JOIN fixed_assets fa       ON fa.id = ad.asset_id
  LEFT JOIN asset_categories ac ON ac.id = fa.category_id
  WHERE ad.tenant_id = p_tenant_id
    AND ad.period    = p_period
    AND ad.status    = 'pending'
    AND fa.status    = 'active'
    AND fa.is_depreciable
    AND ad.depreciation_amount > 0;

  SELECT count(*) INTO v_unresolved FROM _dep_due
  WHERE expense_account_id IS NULL OR accum_account_id IS NULL;
  DELETE FROM _dep_due WHERE expense_account_id IS NULL OR accum_account_id IS NULL;

  SELECT count(*), COALESCE(SUM(depreciation_amount), 0) INTO v_assets, v_total FROM _dep_due;
  IF v_assets = 0 THEN
    DROP TABLE _dep_due;
    RETURN jsonb_build_object('period', p_period, 'assets', 0, 'amount', 0,
                              'unresolved_accounts', v_unresolved);
  END IF;

  v_key := 'dep_' || p_tenant_id::TEXT || '_' || p_period;
  SELECT id INTO v_je FROM journal_entries WHERE unique_key = v_key;

  IF v_je IS NULL THEN
    INSERT INTO journal_entries (
      tenant_id, entry_date, description, status, posted_at,
      is_system_generated, is_adjusting, entry_type, source_type, created_by, unique_key
    ) VALUES (
      p_tenant_id, v_date,
      'Depreciation charge for ' || to_char(v_date, 'Mon YYYY'),
      'posted', NOW(), true, true, 'system', 'depreciation', p_user_id, v_key
    ) RETURNING id INTO v_je;
  END IF;

  -- Dr Depreciation expense / Cr Accumulated depreciation, per asset.
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, asset_id)
  SELECT v_je, d.expense_account_id, d.depreciation_amount, 0, d.asset_id FROM _dep_due d
  UNION ALL
  SELECT v_je, d.accum_account_id, 0, d.depreciation_amount, d.asset_id FROM _dep_due d;

  UPDATE asset_depreciation ad
  SET status = 'posted', journal_entry_id = v_je
  FROM _dep_due d WHERE ad.id = d.dep_id;

  UPDATE fixed_assets fa
  SET accumulated_depreciation = d.accumulated_depreciation,
      status = CASE WHEN d.accumulated_depreciation >= fa.cost - COALESCE(fa.salvage_value, 0)
                    THEN 'fully_depreciated' ELSE fa.status END,
      updated_at = NOW()
  FROM _dep_due d WHERE fa.id = d.asset_id;

  INSERT INTO asset_subledger (
    tenant_id, asset_id, journal_line_id, journal_id, debit, credit, amount,
    balance, cost, salvage, transaction_type, document_type
  )
  SELECT p_tenant_id, d.asset_id, jl.id, v_je, 0, d.depreciation_amount, d.depreciation_amount,
         d.accumulated_depreciation, d.cost, COALESCE(d.salvage_value, 0),
         'depreciation', 'depreciation_run'
  FROM _dep_due d
  JOIN journal_lines jl
    ON jl.journal_entry_id = v_je AND jl.asset_id = d.asset_id AND jl.credit > 0
  WHERE NOT EXISTS (
    SELECT 1 FROM asset_subledger sl WHERE sl.journal_line_id = jl.id
  );

  DROP TABLE _dep_due;

  RETURN jsonb_build_object(
    'period', p_period,
    'journal_entry_id', v_je,
    'assets', v_assets,
    'amount', v_total,
    'unresolved_accounts', v_unresolved
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 12. post_depreciation_period — caller-facing wrapper (tenant + role from JWT)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_depreciation_period(p_period TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := get_user_tenant_id();
  v_user   UUID;
  v_role   TEXT;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No company context for this user'; END IF;

  -- users.id, never auth.uid() — created_by is a FK onto public.users.
  SELECT u.id, r.role_name INTO v_user, v_role
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid() AND u.tenant_id = v_tenant;

  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found in this company'; END IF;
  IF COALESCE(v_role, '') NOT IN ('Primary Admin', 'Company Admin', 'Accountant', 'Super Admin') THEN
    RAISE EXCEPTION 'Posting depreciation requires an admin or accountant role';
  END IF;

  RETURN public.post_depreciation_period_internal(v_tenant, v_user, p_period);
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_depreciation_period(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 13. adopt_coa_assets — the one-click run
--
-- Every asset cost is ALREADY in the GL (the bank import posted it), so this
-- deliberately posts no acquisition journal. It attaches a register record to
-- the debit that is already there, which is why the register reconciles with
-- the PP&E control balance the moment it finishes. The only new postings are
-- the depreciation charges that were never made.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adopt_coa_assets(
  p_through_period    TEXT    DEFAULT NULL,
  p_post_depreciation BOOLEAN DEFAULT TRUE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     UUID := get_user_tenant_id();
  v_user       UUID;
  v_role       TEXT;
  v_through    TEXT;
  v_accounts   JSONB;
  v_categories JSONB;
  v_assets     INTEGER := 0;
  v_sched      INTEGER := 0;
  v_rows       INTEGER;
  v_period     TEXT;
  v_res        JSONB;
  v_posted     JSONB := '[]'::JSONB;
  v_charge     NUMERIC(15,2) := 0;
  v_periods    INTEGER := 0;
  a            RECORD;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No company context for this user'; END IF;

  SELECT u.id, r.role_name INTO v_user, v_role
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid() AND u.tenant_id = v_tenant;

  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found in this company'; END IF;
  IF COALESCE(v_role, '') NOT IN ('Primary Admin', 'Company Admin', 'Accountant', 'Super Admin') THEN
    RAISE EXCEPTION 'Building the asset register requires an admin or accountant role';
  END IF;

  v_through := COALESCE(
    NULLIF(p_through_period, ''),
    (SELECT to_char(MAX(je.entry_date), 'YYYY-MM') FROM journal_entries je
      WHERE je.tenant_id = v_tenant AND je.status = 'posted'),
    to_char(CURRENT_DATE, 'YYYY-MM')
  );
  IF v_through !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Depreciate-through period must be YYYY-MM, got "%"', v_through;
  END IF;

  -- Step 1 & 2: the ledgers and the categories the register hangs off.
  v_accounts   := public.ensure_asset_gl_accounts(v_tenant);
  v_categories := public.ensure_asset_categories_from_coa(v_tenant);

  -- Step 3: one register record per posted PP&E debit that has none yet.
  INSERT INTO fixed_assets (
    tenant_id, asset_name, description, category_id, asset_account_id,
    depreciation_account_id, depr_expense_account_id, cost, salvage_value,
    useful_life_months, depreciation_method, acquisition_date, start_date,
    accumulated_depreciation, status, is_depreciable, source, source_journal_line_id
  )
  SELECT
    v_tenant,
    public.fn_asset_name_from_je(ac.name, je.description),
    je.description,
    ac.id,
    jl.account_id,
    ac.accumulated_depreciation_account_id,
    ac.depreciation_expense_account_id,
    jl.debit,
    0,
    CASE WHEN ac.is_depreciable THEN ac.default_useful_life_months ELSE 0 END,
    ac.depreciation_method,
    je.entry_date,
    date_trunc('month', je.entry_date)::DATE,
    0,
    'active',
    ac.is_depreciable,
    'coa_adoption',
    jl.id
  FROM journal_lines   jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN asset_categories ac ON ac.source_account_id = jl.account_id AND ac.tenant_id = v_tenant
  WHERE je.tenant_id = v_tenant
    AND je.status    = 'posted'
    AND jl.debit     > 0
    AND jl.asset_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.source_journal_line_id = jl.id);

  GET DIAGNOSTICS v_assets = ROW_COUNT;

  -- Step 4: point the existing GL debit at its new register record, so the
  -- account register and the asset drilldown agree.
  UPDATE journal_lines jl
  SET asset_id = fa.id
  FROM fixed_assets fa
  WHERE fa.source_journal_line_id = jl.id
    AND fa.tenant_id = v_tenant
    AND jl.asset_id IS NULL;

  -- Step 5: acquisition rows in the asset sub-ledger, pointing at the
  -- original journal — no new journal is created for cost already posted.
  INSERT INTO asset_subledger (
    tenant_id, asset_id, journal_line_id, journal_id, debit, credit, amount,
    balance, cost, salvage, life_years, transaction_type, document_type
  )
  SELECT v_tenant, fa.id, jl.id, jl.journal_entry_id, fa.cost, 0, fa.cost,
         fa.cost, fa.cost, COALESCE(fa.salvage_value, 0),
         NULLIF(ROUND(fa.useful_life_months / 12.0)::INTEGER, 0),
         'acquisition', 'coa_adoption'
  FROM fixed_assets fa
  JOIN journal_lines jl ON jl.id = fa.source_journal_line_id
  WHERE fa.tenant_id = v_tenant
    AND fa.source = 'coa_adoption'
    AND NOT EXISTS (SELECT 1 FROM asset_subledger sl WHERE sl.journal_line_id = jl.id);

  -- Step 6: the IAS 16 schedule for every asset that does not have one.
  FOR a IN
    SELECT fa.id FROM fixed_assets fa
    WHERE fa.tenant_id = v_tenant
      AND fa.is_depreciable
      AND fa.useful_life_months > 0
      AND NOT EXISTS (SELECT 1 FROM asset_depreciation ad WHERE ad.asset_id = fa.id)
  LOOP
    v_rows := public.generate_asset_schedule(a.id);
    v_sched := v_sched + v_rows;
  END LOOP;

  -- Step 7: catch up every unposted period up to the chosen month, so the
  -- P&L carries its depreciation charge and the balance sheet its contra.
  IF p_post_depreciation THEN
    FOR v_period IN
      SELECT DISTINCT ad.period
      FROM asset_depreciation ad
      WHERE ad.tenant_id = v_tenant AND ad.status = 'pending' AND ad.period <= v_through
      ORDER BY 1
    LOOP
      v_res    := public.post_depreciation_period_internal(v_tenant, v_user, v_period);
      v_posted := v_posted || jsonb_build_array(v_res);
      v_charge := v_charge + COALESCE((v_res ->> 'amount')::NUMERIC, 0);
      IF COALESCE((v_res ->> 'assets')::INTEGER, 0) > 0 THEN
        v_periods := v_periods + 1;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant, v_user, 'Asset Register Built From COA', 'fixed_assets', NULL,
          jsonb_build_object(
            'through_period', v_through,
            'assets_created', v_assets,
            'schedule_rows', v_sched,
            'periods_posted', v_periods,
            'depreciation_posted', v_charge
          ));

  RETURN jsonb_build_object(
    'success',             true,
    'through_period',      v_through,
    'accounts_created',    v_accounts -> 'accounts_created',
    'categories_created',  v_categories -> 'categories_created',
    'assets_created',      v_assets,
    'schedule_rows',       v_sched,
    'periods_posted',      v_periods,
    'depreciation_posted', v_charge,
    'periods',             v_posted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.adopt_coa_assets(TEXT, BOOLEAN) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 14. Index supporting the adoption scan and the per-period posting run
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_adep_pending_period
  ON asset_depreciation(tenant_id, period) WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────
-- 15. Lock down the internal helpers
--
-- Postgres grants EXECUTE to PUBLIC on every new function. The helpers below
-- are SECURITY DEFINER *and* take a tenant id as a parameter, so left as they
-- are any signed-in user could create ledgers in — or post depreciation
-- journals into — another company. Only the three entry points, which take
-- their tenant from get_user_tenant_id() and check the caller's role, stay
-- callable. adopt_coa_assets reaches the rest as their owner.
-- ─────────────────────────────────────────────────────────────────────────
-- Revoking from PUBLIC alone is not enough here: this project carries default
-- privileges that grant EXECUTE to anon/authenticated/service_role explicitly,
-- and an explicit grant survives a PUBLIC revoke.
DO $$
DECLARE
  v_fn TEXT;
  v_grantee TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.ensure_asset_gl_accounts(UUID)',
    'public.ensure_asset_categories_from_coa(UUID)',
    'public.generate_asset_schedule(UUID)',
    'public.post_depreciation_period_internal(UUID, UUID, TEXT)',
    'public.fs_link_depreciation_account(UUID, UUID)',
    'public.fn_next_free_account_code(UUID, INTEGER, INTEGER, INTEGER)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_grantee) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_grantee);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- The three entry points stay callable by signed-in users only.
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.adopt_coa_assets(TEXT, BOOLEAN)',
    'public.analyze_coa_assets(TEXT)',
    'public.post_depreciation_period(TEXT)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END $$;
