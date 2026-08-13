-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — tenant-managed account type registry
--
-- The "Account Type" column of a petty cash book carries whatever wording that
-- company uses: "Fuel Charges", "Travelling & Transport", "Staff Welfare".
-- Those strings are NOT accounts, and they differ per tenant, so nothing about
-- them can be hardcoded.
--
-- petty_cash_account_map is that per-tenant registry. This migration makes it
-- manageable and safe:
--
--   1. display_label — the label as written, so the UI can show
--      "Postage & Courier" rather than the normalized "postage courier".
--   2. An integrity trigger mirroring the resolver's Phase C, so a mapping
--      that would block every row it ever matches cannot be saved at all.
--      Without this the failure surfaces only at import time, one row at a
--      time, which is far too late.
--   3. A suggestion RPC that proposes existing accounts for a label. Strictly
--      ADVISORY: it never writes, and the UI requires a human to confirm.
--      This matters because the chart usually already holds the right account
--      under slightly different wording — "Fuel Charges" should map to the
--      existing "Fuel", not create a near-duplicate beside it.
--   4. An explicit account creator for the genuine gaps, allocating the next
--      free code in the parent's block.
--   5. A starter template of common labels, seeded as reference data only —
--      never auto-applied to a tenant, consistent with the 2026-06-13 decision
--      that new tenants start with only OBE 3900.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Preserve the label as written ───────────────────────────────────────
ALTER TABLE public.petty_cash_account_map
  ADD COLUMN IF NOT EXISTS display_label TEXT;

COMMENT ON COLUMN public.petty_cash_account_map.display_label IS
  'The account type exactly as it appears in the source sheet. match_key stays the normalized form used for matching; this is only for display.';

-- Backfill: existing rows only have the normalized key to show.
UPDATE public.petty_cash_account_map
SET display_label = match_key
WHERE display_label IS NULL;

-- ── 2. Mapping integrity ───────────────────────────────────────────────────
-- Mirrors resolve_petty_cash_import_lines Phase C. The direction-specific
-- account-type rules are deliberately NOT enforced here: direction is a
-- property of an individual sheet row, not of the mapping, and one label can
-- legitimately serve both (a refund of a fuel advance is money in). The
-- resolver still applies the per-row rule.
CREATE OR REPLACE FUNCTION public.fn_validate_pc_account_map()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_acct FROM accounts
  WHERE id = NEW.account_id AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ACCOUNT_NOT_FOUND: account % does not belong to this tenant', NEW.account_id
      USING ERRCODE = 'P0003';
  END IF;

  IF EXISTS (
    SELECT 1 FROM petty_cash_accounts
    WHERE tenant_id = NEW.tenant_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION
      'PETTY_CASH_GL_TARGET: account % % is registered as a petty cash fund and cannot be the contra side of a petty cash movement.',
      v_acct.account_code, v_acct.account_name
      USING ERRCODE = 'P0005';
  END IF;

  IF NOT v_acct.is_postable THEN
    RAISE EXCEPTION
      'ACCOUNT_NOT_POSTABLE: account % (%) is a header account. Map to one of its children instead.',
      v_acct.account_code, v_acct.account_name
      USING ERRCODE = 'P0004';
  END IF;

  IF NOT v_acct.is_active THEN
    RAISE EXCEPTION
      'ACCOUNT_INACTIVE: account % (%) is inactive.', v_acct.account_code, v_acct.account_name
      USING ERRCODE = 'P0004';
  END IF;

  IF v_acct.account_type NOT IN
     ('Asset', 'Expense', 'Other Expense', 'Cost of Goods Sold',
      'Liability', 'Income', 'Other Income', 'Equity') THEN
    RAISE EXCEPTION
      'INVALID_ACCOUNT_TYPE: account % is of type %, which a petty cash movement can never post to.',
      v_acct.account_code, v_acct.account_type
      USING ERRCODE = 'P0004';
  END IF;

  -- Keep the matcher canonical no matter which client wrote the row, and keep
  -- a display label even if the caller omitted one.
  NEW.match_key := fn_normalize_import_key(NEW.match_key);
  IF NEW.match_key IS NULL THEN
    RAISE EXCEPTION 'EMPTY_MATCH_KEY: an account type must contain at least one letter or digit'
      USING ERRCODE = 'P0004';
  END IF;
  NEW.display_label := coalesce(nullif(btrim(NEW.display_label), ''), NEW.match_key);
  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_pc_account_map ON public.petty_cash_account_map;
CREATE TRIGGER trg_validate_pc_account_map
  BEFORE INSERT OR UPDATE OF account_id, match_key, display_label
  ON public.petty_cash_account_map
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_pc_account_map();

COMMENT ON FUNCTION public.fn_validate_pc_account_map() IS
  'Rejects a petty cash account-type mapping that could never post: unknown account, a petty cash GL, a header account, an inactive account, or an impossible account type. Also canonicalizes match_key so every writer agrees on the matcher.';

-- ── 3. Suggestion (advisory only, never writes) ────────────────────────────
-- Returns candidate accounts for a label, best first:
--   1.00        the normalized label IS the account name
--   0.60–0.95   one side's tokens contain the other's ("Fuel Charges" ⊃ "Fuel",
--               "Telephone Charges" ⊃ "Telephone"), scored by how much extra
--               wording the wider side carries
--   0.30–0.60   partial token overlap, Jaccard-scored
--
-- Containment is scored rather than given a flat bonus, because a flat bonus
-- ranks "Office Maintenance" → "Office Equipment Maintenance" above the better
-- "Office Repair & Maintenance" purely because one happens to be a subset.
--
-- The floor is deliberately low (0.3): "Travelling & Transport" vs "Travelling
-- Expenses" shares only one token of three and would otherwise not be offered
-- at all, even though it is the right account. A low floor is safe precisely
-- because this is advisory — callers show several candidates and a human
-- picks. The resolver never consults this function.
CREATE OR REPLACE FUNCTION public.suggest_petty_cash_account(
  p_label     TEXT,
  p_limit     INTEGER DEFAULT 5
)
RETURNS TABLE (
  account_id    UUID,
  account_code  TEXT,
  account_name  TEXT,
  account_type  TEXT,
  confidence    NUMERIC,
  reason        TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS (SELECT get_user_tenant_id() AS tenant),
  label AS (
    SELECT fn_normalize_import_key(p_label) AS k,
           string_to_array(fn_normalize_import_key(p_label), ' ') AS toks
  ),
  candidates AS (
    SELECT a.id, a.account_code, a.account_name, a.account_type,
           fn_normalize_import_key(a.account_name) AS ak,
           string_to_array(fn_normalize_import_key(a.account_name), ' ') AS atoks
    FROM accounts a, me
    WHERE a.tenant_id = me.tenant
      AND a.is_active
      AND a.is_postable
      AND a.account_type IN ('Asset', 'Expense', 'Other Expense', 'Cost of Goods Sold',
                             'Liability', 'Income', 'Other Income', 'Equity')
      AND NOT EXISTS (
        SELECT 1 FROM petty_cash_accounts pca
        WHERE pca.tenant_id = me.tenant AND pca.account_id = a.id
      )
  ),
  overlap AS (
    SELECT c.id, c.account_code, c.account_name, c.account_type, c.ak, c.atoks, l.k, l.toks,
           cardinality(ARRAY(SELECT unnest(c.atoks) INTERSECT SELECT unnest(l.toks))) AS shared,
           cardinality(ARRAY(SELECT unnest(c.atoks) UNION     SELECT unnest(l.toks))) AS total
    FROM candidates c, label l
    WHERE l.k IS NOT NULL
  ),
  scored AS (
    SELECT o.id, o.account_code, o.account_name, o.account_type,
           CASE
             WHEN o.ak = o.k THEN 1.00
             -- Containment, scaled by how much extra wording the wider side
             -- carries: a one-word difference stays near 0.95, a three-word
             -- difference falls toward 0.6.
             WHEN o.atoks <@ o.toks OR o.toks <@ o.atoks THEN
               round(0.60 + 0.35 * (o.shared::NUMERIC / NULLIF(o.total, 0)), 2)
             ELSE round(o.shared::NUMERIC / NULLIF(o.total, 0), 2)
           END AS confidence,
           CASE
             WHEN o.ak = o.k THEN 'Account name matches this label exactly'
             WHEN o.atoks <@ o.toks THEN 'Account name is contained in this label'
             WHEN o.toks <@ o.atoks THEN 'This label is contained in the account name'
             ELSE 'Shares some wording with this label'
           END AS reason
    FROM overlap o
    WHERE o.shared > 0
  )
  SELECT id, account_code, account_name, account_type, confidence, reason
  FROM scored
  WHERE confidence >= 0.30
  ORDER BY confidence DESC, account_code
  LIMIT greatest(p_limit, 1);
$$;

COMMENT ON FUNCTION public.suggest_petty_cash_account(TEXT, INTEGER) IS
  'Advisory candidate accounts for a petty cash account-type label. Never writes and is never consulted by the resolver — the import engine only ever acts on a mapping a human confirmed.';

-- ── 4. Create an expense account for a label that has no home ──────────────
CREATE OR REPLACE FUNCTION public.create_petty_cash_expense_account(
  p_label       TEXT,
  p_parent_code TEXT DEFAULT '6000'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID;
  v_role     TEXT;
  v_parent   accounts%ROWTYPE;
  v_name     TEXT := btrim(p_label);
  v_code     TEXT;
  v_next     INTEGER;
  v_id       UUID;
  v_attempts INTEGER := 0;
BEGIN
  SELECT u.tenant_id, r.role_name INTO v_tenant, v_role
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid();

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot create accounts', coalesce(v_role, 'unknown');
  END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'EMPTY_LABEL: an account needs a name'; END IF;

  IF EXISTS (
    SELECT 1 FROM accounts
    WHERE tenant_id = v_tenant
      AND fn_normalize_import_key(account_name) = fn_normalize_import_key(v_name)
  ) THEN
    RAISE EXCEPTION
      'ACCOUNT_EXISTS: an account named "%" already exists. Map the label to it instead of creating a duplicate.', v_name
      USING ERRCODE = 'P0004';
  END IF;

  SELECT * INTO v_parent FROM accounts
  WHERE tenant_id = v_tenant AND account_code = p_parent_code;
  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'PARENT_MISSING: no account with code % for this tenant', p_parent_code;
  END IF;

  -- Next free code in the parent's own block, stepping by 10 to match the
  -- chart's existing spacing. Retried on a unique violation so two admins
  -- clicking at once cannot collide.
  LOOP
    v_attempts := v_attempts + 1;
    SELECT coalesce(max(account_code::INTEGER), p_parent_code::INTEGER) + 10
      INTO v_next
    FROM accounts
    WHERE tenant_id = v_tenant
      AND account_code ~ '^\d+$'
      AND account_code::INTEGER >  p_parent_code::INTEGER
      AND account_code::INTEGER < (p_parent_code::INTEGER + 1000);
    v_code := v_next::TEXT;

    BEGIN
      INSERT INTO accounts
        (tenant_id, account_code, account_name, account_type, account_subtype,
         parent_account_id, account_path, account_level, normal_balance,
         is_active, is_postable, is_control_account, is_system, requires_subledger)
      VALUES
        (v_tenant, v_code, v_name, v_parent.account_type, v_parent.account_subtype,
         v_parent.id,
         coalesce(v_parent.account_path || ' > ', '') || v_code || ' ' || v_name,
         coalesce(v_parent.account_level, 1) + 1,
         CASE WHEN v_parent.account_type IN ('Asset', 'Expense', 'Cost of Goods Sold', 'Other Expense')
              THEN 'Debit' ELSE 'Credit' END,
         true, true, false, false, false)
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'CODE_ALLOCATION_FAILED: could not find a free account code under %', p_parent_code;
      END IF;
    END;
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_petty_cash_expense_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_petty_cash_expense_account(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_petty_cash_expense_account(TEXT, TEXT) IS
  'Creates one postable account under a header for a petty cash account type that has no existing home. Refuses if an account of that name already exists, so the chart cannot accumulate near-duplicates.';

-- ── 5. Starter template (reference data, never auto-applied) ───────────────
CREATE TABLE IF NOT EXISTS public.petty_cash_type_template (
  label       TEXT PRIMARY KEY,
  sort_order  INTEGER NOT NULL
);

ALTER TABLE public.petty_cash_type_template ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pc_type_template read" ON public.petty_cash_type_template;
CREATE POLICY "pc_type_template read" ON public.petty_cash_type_template
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.petty_cash_type_template (label, sort_order) VALUES
  ('Fuel Charges',                 10),
  ('Office Equipment Maintenance', 20),
  ('Office Expenses',              30),
  ('Office Maintenance',           40),
  ('Postage & Courier',            50),
  ('Printing & Stationery',        60),
  ('Staff Welfare',                70),
  ('Telephone Charges',            80),
  ('Travelling & Transport',       90),
  ('Vehicle Repair',              100)
ON CONFLICT (label) DO NOTHING;

COMMENT ON TABLE public.petty_cash_type_template IS
  'Common petty cash account-type labels, offered as a starting list in the UI. Reference data only — a tenant''s own registry is petty_cash_account_map, and nothing here is applied without an explicit user action.';

-- ── 6. Registry view: every label, mapped or not, with usage ──────────────
CREATE OR REPLACE FUNCTION public.petty_cash_account_type_registry()
RETURNS TABLE (
  id            UUID,
  display_label TEXT,
  match_key     TEXT,
  match_type    TEXT,
  account_id    UUID,
  account_code  TEXT,
  account_name  TEXT,
  account_type  TEXT,
  hit_count     INTEGER,
  last_used_at  TIMESTAMPTZ,
  seen_in_imports BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS (SELECT get_user_tenant_id() AS tenant)
  SELECT m.id, m.display_label, m.match_key, m.match_type,
         m.account_id, a.account_code, a.account_name, a.account_type,
         m.hit_count, m.last_used_at,
         (SELECT count(*) FROM petty_cash_import_lines l, me
           WHERE l.tenant_id = me.tenant
             AND fn_normalize_import_key(l.raw_account_type) = m.match_key)
  FROM petty_cash_account_map m
  JOIN me ON true
  LEFT JOIN accounts a ON a.id = m.account_id
  WHERE m.tenant_id = me.tenant
  ORDER BY m.match_type, lower(m.display_label);
$$;

COMMENT ON FUNCTION public.petty_cash_account_type_registry() IS
  'The tenant''s petty cash account-type registry with its resolved account and how often each label has actually appeared in imported sheets.';
