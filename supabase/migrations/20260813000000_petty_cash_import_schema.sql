-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH EXCEL IMPORT — staging schema
--
-- Upload → stage → resolve (deterministic ladder) → post, mirroring the bank
-- statement import but against the petty cash voucher machinery.
--
-- Nothing here touches the ledger. Staging rows live in their own tables and
-- are turned into vouchers / journal entries only by post_petty_cash_import_
-- batch(). A batch that has never posted can be hard-deleted (discard); a
-- posted batch can only be reversed.
--
-- Column semantics of the source sheet (amount_orientation = 'contra'):
--   Account Type names the CONTRA account, not the fund.
--   Debit  > 0 → money OUT of the fund   → Dr <resolved> / Cr <petty cash GL>
--   Credit > 0 → money INTO the fund     → Dr <petty cash GL> / Cr <resolved>
-- The 'fund' orientation states the same columns from the fund's own point of
-- view and flips the mapping. Posting reads the orientation off the batch row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Normalization helper ────────────────────────────────────────────────
-- Used by the resolver AND by expression indexes on the map table, so it must
-- be IMMUTABLE. Lowercases, collapses every non-alphanumeric run to a single
-- space, trims, and maps the empty result to NULL so a blank cell can never
-- match a blank map key.
CREATE OR REPLACE FUNCTION public.fn_normalize_import_key(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

COMMENT ON FUNCTION public.fn_normalize_import_key(TEXT) IS
  'Canonical normalization for import matching keys: lowercase, non-alphanumeric runs collapsed to single spaces, trimmed, empty → NULL. IMMUTABLE so it can back expression indexes.';

-- ── 2. Import batches (one per uploaded file) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.petty_cash_import_batches (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  petty_cash_account_id  UUID NOT NULL REFERENCES public.petty_cash_accounts(id),
  file_name              TEXT NOT NULL,
  file_hash              TEXT NOT NULL,          -- SHA-256 of the raw bytes
  sheet_name             TEXT,
  date_format            TEXT NOT NULL
    CHECK (date_format IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'EXCEL_SERIAL')),
  amount_orientation     TEXT NOT NULL DEFAULT 'contra'
    CHECK (amount_orientation IN ('contra', 'fund')),
  row_count              INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'resolved', 'posted', 'reverted', 'failed')),
  resolved_at            TIMESTAMPTZ,
  posted_at              TIMESTAMPTZ,
  reverted_at            TIMESTAMPTZ,
  imported_by            UUID REFERENCES public.users(id),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Double-import guard, enforced by the database rather than a client check.
-- A discarded batch has no row and a reverted batch is excluded by the
-- predicate, so both paths free the hash for a clean re-upload.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pc_import_batch_hash
  ON public.petty_cash_import_batches (tenant_id, file_hash)
  WHERE status <> 'reverted';

CREATE INDEX IF NOT EXISTS idx_pc_import_batches_tenant
  ON public.petty_cash_import_batches (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_import_batches_fund
  ON public.petty_cash_import_batches (petty_cash_account_id, created_at DESC);

COMMENT ON TABLE public.petty_cash_import_batches IS
  'One row per uploaded petty cash workbook. Staging only — no ledger effect until post_petty_cash_import_batch().';
COMMENT ON COLUMN public.petty_cash_import_batches.amount_orientation IS
  'contra = Debit/Credit stated against the contra account (money out = Debit). fund = stated from the fund''s own perspective (money in = Debit).';

-- ── 3. Import lines ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.petty_cash_import_lines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             UUID NOT NULL REFERENCES public.petty_cash_import_batches(id) ON DELETE CASCADE,
  -- Denormalized so RLS is a direct predicate rather than a subquery.
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  row_no               INTEGER NOT NULL,          -- 1-based row in the source sheet

  -- Verbatim cell text. Never mutated, so the sheet can always be re-derived.
  raw_date             TEXT,
  raw_cheque_no        TEXT,
  raw_name             TEXT,
  raw_description      TEXT,
  raw_account_type     TEXT,
  raw_debit            TEXT,
  raw_credit           TEXT,

  parsed_date          DATE,
  amount               NUMERIC(14,2),             -- always positive
  direction            TEXT CHECK (direction IN ('out', 'in')),

  resolved_account_id  UUID REFERENCES public.accounts(id),
  resolution_tier      TEXT CHECK (resolution_tier IN
                         ('account_type_map', 'account_name', 'account_code',
                          'description_map', 'suspense', 'manual')),
  resolution_key       TEXT,                      -- the normalized key that matched

  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ok', 'suspense', 'blocked', 'excluded', 'posted')),
  error_code           TEXT,
  error_message        TEXT,

  is_duplicate         BOOLEAN NOT NULL DEFAULT false,
  duplicate_of         UUID REFERENCES public.petty_cash_import_lines(id),

  voucher_id           UUID REFERENCES public.petty_cash_vouchers(id),
  journal_entry_id     UUID REFERENCES public.journal_entries(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (batch_id, row_no)
);

CREATE INDEX IF NOT EXISTS idx_pc_import_lines_batch_status
  ON public.petty_cash_import_lines (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_import_lines_tenant_status
  ON public.petty_cash_import_lines (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_import_lines_account
  ON public.petty_cash_import_lines (resolved_account_id);

COMMENT ON COLUMN public.petty_cash_import_lines.status IS
  'pending → ok | suspense | blocked (resolver) → posted. ''excluded'' is a user decision to skip one row while still posting the batch; excluded rows are retained so the file''s row count reconciles.';

-- ── 4. Learned account map ("teach the engine") ────────────────────────────
CREATE TABLE IF NOT EXISTS public.petty_cash_account_map (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_type   TEXT NOT NULL CHECK (match_type IN ('account_type', 'description')),
  match_key    TEXT NOT NULL,               -- stored pre-normalized
  account_id   UUID NOT NULL REFERENCES public.accounts(id),
  hit_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by   UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, match_type, match_key)
);

COMMENT ON COLUMN public.petty_cash_account_map.match_key IS
  'Already normalized via fn_normalize_import_key. Writers must normalize before insert.';

-- ── 5. Discard audit trail ─────────────────────────────────────────────────
-- The staging rows themselves are deleted — they never touched the ledger, so
-- there is nothing to preserve there — but the fact that someone uploaded and
-- then withdrew a file is worth keeping.
CREATE TABLE IF NOT EXISTS public.petty_cash_import_discards (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  petty_cash_account_id    UUID,
  file_name                TEXT NOT NULL,
  file_hash                TEXT NOT NULL,
  row_count                INTEGER NOT NULL DEFAULT 0,
  batch_status_at_discard  TEXT NOT NULL,
  reason                   TEXT,
  discarded_by             UUID REFERENCES public.users(id),
  discarded_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_import_discards_tenant
  ON public.petty_cash_import_discards (tenant_id, discarded_at DESC);

-- ── 6. Suspense account setting ────────────────────────────────────────────
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS suspense_account_id UUID REFERENCES public.accounts(id);

COMMENT ON COLUMN public.account_settings.suspense_account_id IS
  'Holding account for import lines that cannot be deterministically resolved. Must be cleared to zero before period close. Should be an Asset account so it satisfies both the outflow and inflow account-type rules.';

-- ── 7. Delete guard: a posted batch is not deletable by any path ───────────
CREATE OR REPLACE FUNCTION public.fn_block_posted_import_batch_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION
      'BATCH_POSTED: Import batch % is posted to the ledger and cannot be deleted. Reverse it instead.',
      OLD.id
      USING ERRCODE = 'P0007';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_posted_import_batch_delete ON public.petty_cash_import_batches;
CREATE TRIGGER trg_block_posted_import_batch_delete
  BEFORE DELETE ON public.petty_cash_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_posted_import_batch_delete();

COMMENT ON FUNCTION public.fn_block_posted_import_batch_delete() IS
  'Once a batch has posted, the only removal path is revert_petty_cash_import_batch(). A reverted batch IS deletable — its ledger effect is already neutralised and the vouchers/entries survive independently.';

-- ── 8. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.petty_cash_import_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_import_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_account_map      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_import_discards  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_view_pc_import_batches"   ON public.petty_cash_import_batches;
DROP POLICY IF EXISTS "tenant_manage_pc_import_batches" ON public.petty_cash_import_batches;
CREATE POLICY "tenant_view_pc_import_batches"
  ON public.petty_cash_import_batches FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_manage_pc_import_batches"
  ON public.petty_cash_import_batches FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tenant_view_pc_import_lines"   ON public.petty_cash_import_lines;
DROP POLICY IF EXISTS "tenant_manage_pc_import_lines" ON public.petty_cash_import_lines;
CREATE POLICY "tenant_view_pc_import_lines"
  ON public.petty_cash_import_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_manage_pc_import_lines"
  ON public.petty_cash_import_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tenant_view_pc_account_map"   ON public.petty_cash_account_map;
DROP POLICY IF EXISTS "tenant_manage_pc_account_map" ON public.petty_cash_account_map;
CREATE POLICY "tenant_view_pc_account_map"
  ON public.petty_cash_account_map FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_manage_pc_account_map"
  ON public.petty_cash_account_map FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tenant_view_pc_import_discards"   ON public.petty_cash_import_discards;
DROP POLICY IF EXISTS "tenant_manage_pc_import_discards" ON public.petty_cash_import_discards;
CREATE POLICY "tenant_view_pc_import_discards"
  ON public.petty_cash_import_discards FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_manage_pc_import_discards"
  ON public.petty_cash_import_discards FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
