-- ============================================================
-- Deep COA hierarchy support
--   • account_code_ranges reference table (mirrors ACCOUNT_NUMBER_RANGES)
--   • account_subtype_bands reference table (mirrors ACCOUNT_SUBTYPE_BANDS)
--   • next_account_code() RPC — collision-proof, tenant-scoped,
--     subtype-banded at root level to match the existing client behaviour
--     in src/lib/accountCodeGenerator.ts (generateAccountCodeBanded)
--
-- NOTE: accounts_tenant_id_account_code_key and accounts_tenant_code_unique
-- already enforce uniqueness on (tenant_id, account_code) — confirmed via
-- pg_indexes before writing this migration. No new unique index is added
-- here; it would be a redundant third index on the same columns.
-- ============================================================

-- ── 1. Code range reference table (type-level) ───────────────

CREATE TABLE IF NOT EXISTS public.account_code_ranges (
  account_type TEXT PRIMARY KEY,
  min_code     INTEGER NOT NULL,
  max_code     INTEGER NOT NULL,
  CONSTRAINT account_code_ranges_bounds CHECK (min_code < max_code)
);

INSERT INTO public.account_code_ranges (account_type, min_code, max_code) VALUES
  ('Asset',              1000, 1999),
  ('Liability',          2000, 2999),
  ('Equity',             3000, 3999),
  ('Income',             4000, 4999),
  ('Cost of Goods Sold', 5000, 5999),
  ('Expense',            6000, 7999),
  ('Other Income',       8000, 8999),
  ('Other Expense',      9000, 9999)
ON CONFLICT (account_type) DO UPDATE
  SET min_code = EXCLUDED.min_code,
      max_code = EXCLUDED.max_code;

ALTER TABLE public.account_code_ranges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_code_ranges_read ON public.account_code_ranges;
CREATE POLICY account_code_ranges_read
  ON public.account_code_ranges
  FOR SELECT
  TO authenticated
  USING (TRUE);

COMMENT ON TABLE public.account_code_ranges IS
  'Global (non-tenant) reference: numeric code range per account type. Mirrors ACCOUNT_NUMBER_RANGES in src/lib/accountTypes.ts — this table is authoritative.';

-- ── 2. Sub-band reference table (subtype-level, root accounts only) ──
-- Mirrors ACCOUNT_SUBTYPE_BANDS in src/lib/accountTypes.ts exactly, so
-- next_account_code() reproduces generateAccountCodeBanded()'s placement
-- for top-level accounts instead of regressing to a flat type-range walk.

CREATE TABLE IF NOT EXISTS public.account_subtype_bands (
  account_subtype TEXT PRIMARY KEY,
  min_code        INTEGER NOT NULL,
  max_code        INTEGER NOT NULL,
  CONSTRAINT account_subtype_bands_bounds CHECK (min_code <= max_code)
);

INSERT INTO public.account_subtype_bands (account_subtype, min_code, max_code) VALUES
  ('Cash on Hand',             1000, 1049),
  ('Checking',                 1050, 1099),
  ('Savings',                  1100, 1149),
  ('Bank',                     1100, 1149),
  ('Accounts Receivable',      1200, 1249),
  ('Prepaid Expenses',         1400, 1449),
  ('Other Current Assets',     1450, 1499),
  ('Fixed Assets',             1500, 1549),
  ('Furniture & Equipment',    1550, 1599),
  ('Vehicles',                 1600, 1649),
  ('Buildings',                1700, 1749),
  ('Accumulated Depreciation', 1800, 1849),
  ('Intangible Assets',        1900, 1949),
  ('Accounts Payable',         2000, 2049),
  ('Credit Card',              2100, 2149),
  ('Payroll Liability',        2200, 2299),
  ('Sales Tax Payable',        2300, 2349),
  ('Other Current Liability',  2350, 2499),
  ('Long-term Liability',      2500, 2699),
  ('Long-Term Loan',           2700, 2899),
  ('Owner''s Equity',          3000, 3099),
  ('Partner''s Equity',        3100, 3199),
  ('Retained Earnings',        3200, 3299),
  ('Dividends',                3300, 3399),
  ('Opening Balance Equity',   3900, 3900),
  ('Sales of Product',         4000, 4199),
  ('Sales Revenue',            4000, 4199),
  ('Service Income',           4200, 4399),
  ('Service Revenue',          4200, 4399),
  ('Discount',                 4800, 4849),
  ('Other Revenue',            4850, 4999),
  ('Cost of Materials',        5000, 5199),
  ('Cost of Labour',           5200, 5399),
  ('Shipping & Delivery',      5400, 5499),
  ('Other COGS',               5500, 5999),
  ('Advertising',              6000, 6049),
  ('Bank Charges',             6050, 6099),
  ('Rent',                     6100, 6149),
  ('Utilities',                6150, 6199),
  ('Supplies',                 6200, 6249),
  ('Office Supplies',          6200, 6249),
  ('Insurance',                6300, 6349),
  ('Payroll Expenses',         6400, 6599),
  ('Professional Fees',        6600, 6649),
  ('Travel & Transport',       6700, 6749),
  ('Depreciation',             6800, 6849),
  ('Repairs & Maintenance',    6900, 6949),
  ('Taxes & Licences',         7000, 7049),
  ('Meals & Entertainment',    7100, 7149),
  ('Other Expense',            7800, 7999),
  ('Interest Earned',          8000, 8199),
  ('Dividend Income',          8200, 8399),
  ('Gain on Sale of Assets',   8400, 8599),
  ('Miscellaneous Income',     8600, 8999),
  ('Interest Expense',         9000, 9199),
  ('Loss on Sale of Assets',   9200, 9399),
  ('Penalties & Fines',        9400, 9599),
  ('Miscellaneous Expense',    9600, 9999)
ON CONFLICT (account_subtype) DO UPDATE
  SET min_code = EXCLUDED.min_code,
      max_code = EXCLUDED.max_code;

ALTER TABLE public.account_subtype_bands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_subtype_bands_read ON public.account_subtype_bands;
CREATE POLICY account_subtype_bands_read
  ON public.account_subtype_bands
  FOR SELECT
  TO authenticated
  USING (TRUE);

COMMENT ON TABLE public.account_subtype_bands IS
  'Global (non-tenant) reference: numeric sub-band per detail type, used only when placing a new root-level account. Mirrors ACCOUNT_SUBTYPE_BANDS in src/lib/accountTypes.ts — this table is authoritative.';

-- ── 3. next_account_code() ───────────────────────────────────
-- Root accounts (p_parent_id IS NULL):
--   • p_account_subtype maps to a band in account_subtype_bands → walk that
--     band in steps of 10, then steps of 1 if saturated (matches
--     generateAccountCodeBanded exactly).
--   • No band mapped → fall back to the flat type range, stepping by 100
--     (matches generateAccountCode's top-level behaviour exactly).
-- Levels 2-3: numeric stepping (parent + 10, then parent + 1).
-- Levels 4-5, and any level whose numeric slots are exhausted: dash suffix.
-- The dash is deliberate: account_path joins on '.', so a numeric suffix
-- separator must never be '.'.

CREATE OR REPLACE FUNCTION public.next_account_code(
  p_account_type    TEXT,
  p_parent_id       UUID DEFAULT NULL,
  p_account_subtype TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID := get_user_tenant_id();
  v_min      INTEGER;
  v_max      INTEGER;
  v_band_min INTEGER;
  v_band_max INTEGER;
  v_parent   RECORD;
  v_base     INTEGER;
  v_step     INTEGER;
  v_cand     TEXT;
  v_i        INTEGER;
  v_suffix   INTEGER;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT: Could not resolve tenant from the current session.'
      USING ERRCODE = 'P0010';
  END IF;

  SELECT min_code, max_code INTO v_min, v_max
  FROM public.account_code_ranges
  WHERE account_type = p_account_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_TYPE: No code range configured for account type "%".', p_account_type
      USING ERRCODE = 'P0011';
  END IF;

  -- ── Level 1: root accounts ─────────────────────────────────
  IF p_parent_id IS NULL THEN

    -- Subtype band takes priority when mapped, matching
    -- generateAccountCodeBanded's placement for top-level accounts.
    IF p_account_subtype IS NOT NULL THEN
      SELECT min_code, max_code INTO v_band_min, v_band_max
      FROM public.account_subtype_bands
      WHERE account_subtype = p_account_subtype;

      IF FOUND THEN
        v_i := v_band_min;
        WHILE v_i <= v_band_max LOOP
          IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE tenant_id = v_tenant AND account_code = v_i::TEXT
          ) THEN
            RETURN v_i::TEXT;
          END IF;
          v_i := v_i + 10;
        END LOOP;

        -- Band saturated in 10-steps → fall back to 1-steps within the band.
        v_i := v_band_min;
        WHILE v_i <= v_band_max LOOP
          IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE tenant_id = v_tenant AND account_code = v_i::TEXT
          ) THEN
            RETURN v_i::TEXT;
          END IF;
          v_i := v_i + 1;
        END LOOP;
        -- Band completely full → fall through to the flat type-range walk below.
      END IF;
    END IF;

    -- No subtype band mapped (or it's saturated): flat type-range walk,
    -- stepping by 100 from the highest existing root code.
    SELECT COALESCE(MAX(account_code::INTEGER), v_min - 100)
      INTO v_base
    FROM public.accounts
    WHERE tenant_id         = v_tenant
      AND account_type      = p_account_type
      AND parent_account_id IS NULL
      AND account_code ~ '^[0-9]+$'
      AND account_code::INTEGER BETWEEN v_min AND v_max;

    v_i := GREATEST(((v_base / 100) + 1) * 100, v_min);

    WHILE v_i <= v_max LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.accounts
        WHERE tenant_id = v_tenant AND account_code = v_i::TEXT
      ) THEN
        RETURN v_i::TEXT;
      END IF;
      v_i := v_i + 100;
    END LOOP;

    RAISE EXCEPTION
      'RANGE_FULL: No free root code remains in %-% for account type "%".',
      v_min, v_max, p_account_type
      USING ERRCODE = 'P0012';
  END IF;

  -- ── Resolve parent (tenant-scoped) ────────────────────────
  SELECT id, account_code, account_level, account_type
    INTO v_parent
  FROM public.accounts
  WHERE id = p_parent_id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_NOT_FOUND: Parent account % is not visible to this tenant.', p_parent_id
      USING ERRCODE = 'P0013';
  END IF;

  IF v_parent.account_level >= 5 THEN
    RAISE EXCEPTION
      'DEPTH_EXCEEDED: Cannot create a sub-account under a level-5 account (max hierarchy depth is 5).'
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Levels 2 and 3: numeric stepping ──────────────────────
  IF v_parent.account_level IN (1, 2) AND v_parent.account_code ~ '^[0-9]+$' THEN
    v_step := CASE v_parent.account_level WHEN 1 THEN 10 ELSE 1 END;
    v_base := v_parent.account_code::INTEGER;

    FOR v_i IN 1..9 LOOP
      v_cand := (v_base + v_i * v_step)::TEXT;
      IF NOT EXISTS (
        SELECT 1 FROM public.accounts
        WHERE tenant_id = v_tenant AND account_code = v_cand
      ) THEN
        RETURN v_cand;
      END IF;
    END LOOP;
    -- numeric slots exhausted → fall through to the suffix scheme
  END IF;

  -- ── Levels 4-5 and overflow: dash suffix ──────────────────
  v_suffix := 1;
  LOOP
    v_cand := v_parent.account_code || '-' || lpad(v_suffix::TEXT, 2, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.accounts
      WHERE tenant_id = v_tenant AND account_code = v_cand
    );
    v_suffix := v_suffix + 1;
    IF v_suffix > 99 THEN
      RAISE EXCEPTION
        'RANGE_FULL: More than 99 sub-accounts already exist under %.', v_parent.account_code
        USING ERRCODE = 'P0012';
    END IF;
  END LOOP;

  RETURN v_cand;
END;
$$;

REVOKE ALL ON FUNCTION public.next_account_code(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_account_code(TEXT, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.next_account_code(TEXT, UUID, TEXT) IS
  'Returns the next free account_code for a given type/parent/subtype, scoped to the caller''s tenant. Root accounts band by subtype (mirrors generateAccountCodeBanded) then fall back to the flat type range; levels 2-3 numeric (step 10/1); levels 4-5 use a -NN suffix. Authoritative — the client must not compute codes itself.';
