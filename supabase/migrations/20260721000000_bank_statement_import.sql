-- ═══════════════════════════════════════════════════════════════════════════
-- BANK STATEMENT IMPORT PIPELINE — schema
--
-- Upload → parse → resolve (deterministic ladder) → validate → post, in one
-- action. Resolved lines post to their mapped ledger account, everything else
-- valid posts to SUSPENSE (reason-coded, tracked to zero), corrupt lines are
-- held unposted. The engine never guesses: only exact, auditable rule matches
-- set an account.
--
-- Note: this codebase's COA table is `accounts` (not `chart_of_accounts`).
-- Bank accounts are `accounts` rows with a bank-flavored account_subtype.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Import batches (one per uploaded file) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_statement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  storage_path text NOT NULL,
  file_name text,
  -- [{sheet_name, month, year}] as confirmed by the user at upload
  sheet_periods jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'posted', 'failed', 'superseded')),
  posting_mode text CHECK (posting_mode IN ('auto_post', 'draft')),
  engine_version text,
  -- Control totals captured at parse; posting re-verifies and aborts on drift.
  total_debit numeric NOT NULL DEFAULT 0,
  total_credit numeric NOT NULL DEFAULT 0,
  row_count integer NOT NULL DEFAULT 0,
  summary jsonb,
  error_message text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);

-- ── 2. Statement lines ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  batch_id uuid NOT NULL REFERENCES public.bank_statement_batches(id) ON DELETE CASCADE,
  sheet_name text NOT NULL,
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year smallint NOT NULL,
  row_index integer NOT NULL,           -- 1-based row in the source sheet
  txn_date date,                        -- null when unparseable (→ blocked)
  raw_date text,
  description text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  voucher_no text NOT NULL DEFAULT '',
  raw_account_type text NOT NULL DEFAULT '',
  canonical_category text,
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  bank_fee numeric,
  balance numeric,
  is_excluded boolean NOT NULL DEFAULT false,  -- B/F & opening-balance rows
  -- Resolution audit trail: exactly one of the three outcomes.
  resolution_tier smallint CHECK (resolution_tier IN (1, 2, 3)),  -- 3 = suspense
  resolved_account_id uuid REFERENCES public.accounts(id),
  resolved_by_map_id uuid,              -- id of the map/rule row that matched
  suspense_reason text,
  block_reason text,
  needs_reclassification boolean NOT NULL DEFAULT false,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  reclass_journal_entry_id uuid REFERENCES public.journal_entries(id),
  validation_flags jsonb NOT NULL DEFAULT '[]',
  suggestions jsonb NOT NULL DEFAULT '[]',   -- advisory only, never authoritative
  engine_version text,
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_batch
  ON public.bank_statement_lines (batch_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_suspense
  ON public.bank_statement_lines (tenant_id)
  WHERE needs_reclassification = true;
CREATE INDEX IF NOT EXISTS idx_bank_statement_batches_tenant
  ON public.bank_statement_batches (tenant_id, bank_account_id);

-- ── 3. Tier-2 exact rules (description/name → account) ─────────────────────
CREATE TABLE IF NOT EXISTS public.bank_categorization_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  match_type text NOT NULL DEFAULT 'exact' CHECK (match_type = 'exact'),
  match_field text NOT NULL DEFAULT 'description'
    CHECK (match_field IN ('description', 'name')),
  match_value text NOT NULL,            -- stored pre-normalized
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  expected_side text NOT NULL DEFAULT 'either'
    CHECK (expected_side IN ('debit', 'credit', 'either')),
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_categorization_rules_tenant
  ON public.bank_categorization_rules (tenant_id, match_value)
  WHERE is_active = true;

-- ── 4. Canonical variant map (raw account_type → canonical category) ──────
-- tenant_id NULL = global seed rows shipped by migration; tenant rows extend
-- (and can shadow) them. Exact match on normalized text only — no fuzz.
CREATE TABLE IF NOT EXISTS public.bank_category_canonical_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  raw_variant text NOT NULL,            -- stored pre-normalized
  canonical_category text NOT NULL,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, raw_variant)
);

-- ── 5. Category → ledger account mapping (per tenant) ─────────────────────
CREATE TABLE IF NOT EXISTS public.bank_category_account_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  canonical_category text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  expected_side text NOT NULL DEFAULT 'either'
    CHECK (expected_side IN ('debit', 'credit', 'either')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, canonical_category)
);

-- ── 6. Tenant settings ─────────────────────────────────────────────────────
-- Suspense is DIRECTIONAL, mirroring the client's own workbook practice:
--   money IN  (statement Credit) that cannot be resolved → Unrecognized Deposits
--   money OUT (statement Debit)  that cannot be resolved → Unrecognized Payments
-- Both are REQUIRED — the pipeline hard-fails with a clear error when either is
-- unconfigured. Never a hardcoded fallback.
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS bank_import_unrecognized_deposit_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS bank_import_unrecognized_payment_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS bank_import_posting_mode text NOT NULL DEFAULT 'auto_post'
    CHECK (bank_import_posting_mode IN ('auto_post', 'draft')),
  ADD COLUMN IF NOT EXISTS bank_import_amount_ceiling numeric NOT NULL DEFAULT 100000000;

-- ── 7. RLS — tenant isolation on every new table ───────────────────────────
ALTER TABLE public.bank_statement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_categorization_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_category_canonical_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_category_account_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_statement_batches tenant all" ON public.bank_statement_batches
  FOR ALL USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "bank_statement_lines tenant all" ON public.bank_statement_lines
  FOR ALL USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "bank_categorization_rules tenant all" ON public.bank_categorization_rules
  FOR ALL USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Canonical map: everyone reads the global (tenant_id IS NULL) seed rows plus
-- their own; writes are tenant-scoped only.
CREATE POLICY "bank_category_canonical_map read" ON public.bank_category_canonical_map
  FOR SELECT USING (tenant_id IS NULL OR tenant_id = get_user_tenant_id());
CREATE POLICY "bank_category_canonical_map insert" ON public.bank_category_canonical_map
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "bank_category_canonical_map update" ON public.bank_category_canonical_map
  FOR UPDATE USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "bank_category_canonical_map delete" ON public.bank_category_canonical_map
  FOR DELETE USING (tenant_id = get_user_tenant_id());

CREATE POLICY "bank_category_account_map tenant all" ON public.bank_category_account_map
  FOR ALL USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── 8. Private storage bucket for uploaded statement files ─────────────────
-- The server re-parses the uploaded file itself; client-computed rows are
-- never trusted for posting. Path layout: <tenant_id>/<uuid>-<filename>.
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-statements', 'bank-statements', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY "bank_statements tenant read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'bank-statements'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "bank_statements tenant insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bank-statements'
              AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

CREATE POLICY "bank_statements tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'bank-statements'
         AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
