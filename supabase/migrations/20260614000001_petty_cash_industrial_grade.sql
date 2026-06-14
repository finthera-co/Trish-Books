-- =====================================================================================
-- Petty Cash — Industrial-Grade Upgrade
-- =====================================================================================
-- This migration delivers two pillars that move the petty cash module from
-- "good" to enterprise/imprest grade:
--
--   PILLAR A — Physical Cash Count & Imprest Reconciliation
--     • petty_cash_counts            (count header: book vs. counted, variance)
--     • petty_cash_count_denominations (note/coin breakdown per count)
--     • Cash Over/Short GL account auto-seeding (account_code 7900)
--     • post_pc_count() RPC — posts the variance to Cash Over/Short atomically
--
--   PILLAR B — Server-Side Transactional Posting (fixes concurrency, numbering,
--              atomicity, and forged-entry risk)
--     • pc_next_document_number()    — atomic, gapless per-tenant numbering
--     • post_pcv()                   — approve + post a voucher in one transaction
--     • post_pcr()                   — approve + post a replenishment in one txn
--     • All money checks use SELECT ... FOR UPDATE row locks to prevent overdraw
--
-- Safe to run on top of the existing schema. Idempotent where practical.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 0. Helper: resolve (and lazily seed) the Cash Over/Short GL account for a tenant
-- -------------------------------------------------------------------------------------
-- Cash Over/Short (account_code 7900) is an Expense/Income hybrid; modelled here as
-- an Expense account that can carry a credit (gain) or debit (loss) balance, which is
-- the standard treatment. A shortage debits it (expense), an overage credits it.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_cash_over_short_account(p_tenant_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT id INTO v_account_id
  FROM accounts
  WHERE tenant_id = p_tenant_id AND account_code = '7900'
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  INSERT INTO accounts (
    tenant_id, account_code, account_name, account_type, account_subtype,
    is_active, is_postable, account_level, normal_balance, is_system
  )
  VALUES (
    p_tenant_id, '7900', 'Cash Over / Short', 'Expense', 'Other Expense',
    true, true, 2, 'debit', true
  )
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  SELECT id INTO v_account_id
  FROM accounts
  WHERE tenant_id = p_tenant_id AND account_code = '7900'
  LIMIT 1;

  RETURN v_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_cash_over_short_account(UUID) TO authenticated;


-- =====================================================================================
-- PILLAR A — PHYSICAL CASH COUNT & RECONCILIATION
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- A.1  Count header
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.petty_cash_counts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  count_number          TEXT NOT NULL,
  petty_cash_account_id UUID NOT NULL REFERENCES public.petty_cash_accounts(id),
  count_date            DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Book balance captured at the moment of counting (ledger-derived, frozen)
  book_balance          NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Sum of denominations entered by the custodian
  counted_balance       NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- counted - book : positive = overage (more cash than books), negative = shortage
  variance              NUMERIC(14,2) NOT NULL DEFAULT 0,

  status                TEXT NOT NULL DEFAULT 'draft'   -- draft | posted | cancelled
                          CHECK (status IN ('draft','posted','cancelled')),
  notes                 TEXT,

  counted_by            UUID REFERENCES public.users(id),
  approved_by           UUID REFERENCES public.users(id),
  journal_entry_id      UUID REFERENCES public.journal_entries(id),  -- variance posting (NULL if zero)
  posted_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, count_number)
);

ALTER TABLE public.petty_cash_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_counts_select" ON public.petty_cash_counts;
CREATE POLICY "pc_counts_select" ON public.petty_cash_counts
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "pc_counts_insert" ON public.petty_cash_counts;
CREATE POLICY "pc_counts_insert" ON public.petty_cash_counts
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "pc_counts_update" ON public.petty_cash_counts;
CREATE POLICY "pc_counts_update" ON public.petty_cash_counts
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "pc_counts_delete" ON public.petty_cash_counts;
CREATE POLICY "pc_counts_delete" ON public.petty_cash_counts
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND status = 'draft');

CREATE INDEX IF NOT EXISTS idx_pc_counts_tenant_account
  ON public.petty_cash_counts (tenant_id, petty_cash_account_id, count_date DESC);


-- -------------------------------------------------------------------------------------
-- A.2  Denomination breakdown
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.petty_cash_count_denominations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id          UUID NOT NULL REFERENCES public.petty_cash_counts(id) ON DELETE CASCADE,
  denomination      NUMERIC(12,2) NOT NULL,   -- face value of the note/coin (e.g. 5000.00, 0.50)
  denom_type        TEXT NOT NULL DEFAULT 'note' CHECK (denom_type IN ('note','coin')),
  quantity          INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,  -- denomination * quantity
  sort_order        INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.petty_cash_count_denominations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_count_denoms_select" ON public.petty_cash_count_denominations;
CREATE POLICY "pc_count_denoms_select" ON public.petty_cash_count_denominations
  FOR SELECT TO authenticated
  USING (count_id IN (SELECT id FROM petty_cash_counts WHERE tenant_id = get_user_tenant_id())
         OR is_super_admin());

DROP POLICY IF EXISTS "pc_count_denoms_all" ON public.petty_cash_count_denominations;
CREATE POLICY "pc_count_denoms_all" ON public.petty_cash_count_denominations
  FOR ALL TO authenticated
  USING (count_id IN (SELECT id FROM petty_cash_counts WHERE tenant_id = get_user_tenant_id()))
  WITH CHECK (count_id IN (SELECT id FROM petty_cash_counts WHERE tenant_id = get_user_tenant_id()));


-- =====================================================================================
-- PILLAR B — ATOMIC DOCUMENT NUMBERING
-- =====================================================================================
-- Replaces COUNT(*)+1 numbering, which races under concurrency. A per-tenant,
-- per-document-type counter row is locked and incremented in a single statement.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pc_document_counters (
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL,   -- 'PCV' | 'PCR' | 'PCC'
  year           INTEGER NOT NULL,
  last_number    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, doc_type, year)
);

ALTER TABLE public.pc_document_counters ENABLE ROW LEVEL SECURITY;

-- No direct client access — only SECURITY DEFINER functions touch this table.
DROP POLICY IF EXISTS "pc_counters_no_direct_access" ON public.pc_document_counters;
CREATE POLICY "pc_counters_no_direct_access" ON public.pc_document_counters
  FOR SELECT TO authenticated
  USING (false);

CREATE OR REPLACE FUNCTION public.pc_next_document_number(
  p_tenant_id UUID,
  p_doc_type  TEXT          -- 'PCV' | 'PCR' | 'PCC'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year     INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next     INTEGER;
BEGIN
  IF p_doc_type NOT IN ('PCV','PCR','PCC') THEN
    RAISE EXCEPTION 'INVALID_DOC_TYPE: %', p_doc_type USING ERRCODE = 'P0001';
  END IF;

  -- Atomic upsert-and-increment. The UPDATE locks the counter row, eliminating
  -- the race that COUNT(*)+1 suffered from.
  INSERT INTO pc_document_counters (tenant_id, doc_type, year, last_number)
  VALUES (p_tenant_id, p_doc_type, v_year, 1)
  ON CONFLICT (tenant_id, doc_type, year)
  DO UPDATE SET last_number = pc_document_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN p_doc_type || '-' || v_year::TEXT || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.pc_next_document_number(UUID, TEXT) TO authenticated;

-- One-time backfill so new atomic numbers continue past any existing documents.
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Vouchers
  FOR r IN
    SELECT tenant_id,
           EXTRACT(YEAR FROM CURRENT_DATE)::INT AS yr,
           COUNT(*) AS cnt
    FROM petty_cash_vouchers
    WHERE voucher_number LIKE 'PCV-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT || '-%'
    GROUP BY tenant_id
  LOOP
    INSERT INTO pc_document_counters (tenant_id, doc_type, year, last_number)
    VALUES (r.tenant_id, 'PCV', r.yr, r.cnt)
    ON CONFLICT (tenant_id, doc_type, year)
    DO UPDATE SET last_number = GREATEST(pc_document_counters.last_number, EXCLUDED.last_number);
  END LOOP;

  -- Replenishments
  FOR r IN
    SELECT tenant_id,
           EXTRACT(YEAR FROM CURRENT_DATE)::INT AS yr,
           COUNT(*) AS cnt
    FROM petty_cash_replenishments
    WHERE replenishment_number LIKE 'PCR-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT || '-%'
    GROUP BY tenant_id
  LOOP
    INSERT INTO pc_document_counters (tenant_id, doc_type, year, last_number)
    VALUES (r.tenant_id, 'PCR', r.yr, r.cnt)
    ON CONFLICT (tenant_id, doc_type, year)
    DO UPDATE SET last_number = GREATEST(pc_document_counters.last_number, EXCLUDED.last_number);
  END LOOP;
END;
$$;


-- =====================================================================================
-- Shared helper: ledger balance of a COA account with a ROW LOCK on the PC account.
-- The lock serialises concurrent postings against the same fund, preventing overdraw.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.pc_locked_ledger_balance(
  p_pc_account_id UUID,
  p_tenant_id     UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coa_account_id UUID;
  v_balance        NUMERIC(14,2);
BEGIN
  -- Lock the petty cash fund row. Any other posting touching this fund must wait,
  -- which makes the read-then-write below safe under concurrency.
  SELECT account_id INTO v_coa_account_id
  FROM petty_cash_accounts
  WHERE id = p_pc_account_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_coa_account_id IS NULL THEN
    RAISE EXCEPTION 'PC_ACCOUNT_NOT_LINKED: fund % is not linked to a COA account', p_pc_account_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = v_coa_account_id
    AND je.status = 'posted';

  RETURN v_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pc_locked_ledger_balance(UUID, UUID) TO authenticated;


-- =====================================================================================
-- B.1  post_pcv() — approve and post a petty cash voucher atomically
-- =====================================================================================
-- Replaces the client-side approveVoucher hook logic. Everything below runs in a
-- single transaction: insufficient-funds check (with row lock), JE + lines insert,
-- and voucher status update. If anything fails, nothing is committed.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.post_pcv(p_voucher_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_voucher        petty_cash_vouchers%ROWTYPE;
  v_coa_account_id UUID;
  v_balance        NUMERIC(14,2);
  v_je_id          UUID;
  v_line_total     NUMERIC(14,2);
  v_period_closed  BOOLEAN;
BEGIN
  -- Fetch + tenant-scope the voucher
  SELECT * INTO v_voucher
  FROM petty_cash_vouchers
  WHERE id = p_voucher_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: %', p_voucher_id USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.status <> 'draft' THEN
    RAISE EXCEPTION 'INVALID_STATE: voucher is "%", only draft vouchers can be posted', v_voucher.status
      USING ERRCODE = 'P0002';
  END IF;

  -- Period lock
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND v_voucher.date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: voucher date % is in a closed period', v_voucher.date
      USING ERRCODE = 'P0003';
  END IF;

  -- Resolve COA account behind the fund and LOCK the fund (serialises postings)
  v_balance := pc_locked_ledger_balance(v_voucher.petty_cash_account_id, v_tenant_id);

  SELECT account_id INTO v_coa_account_id
  FROM petty_cash_accounts
  WHERE id = v_voucher.petty_cash_account_id;

  -- Sum the lines and validate the header total matches
  SELECT COALESCE(SUM(amount), 0) INTO v_line_total
  FROM petty_cash_voucher_lines
  WHERE voucher_id = p_voucher_id;

  IF v_line_total <= 0 THEN
    RAISE EXCEPTION 'EMPTY_VOUCHER: voucher has no positive line amounts' USING ERRCODE = 'P0004';
  END IF;

  IF ROUND(v_line_total, 2) <> ROUND(v_voucher.total_amount, 2) THEN
    RAISE EXCEPTION 'TOTAL_MISMATCH: line sum % <> header total %', v_line_total, v_voucher.total_amount
      USING ERRCODE = 'P0005';
  END IF;

  -- Insufficient-funds guard (now race-safe due to the row lock above)
  IF v_balance < v_line_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS: available %, required %', v_balance, v_line_total
      USING ERRCODE = 'P0006';
  END IF;

  -- Create the posted journal entry
  INSERT INTO journal_entries (
    tenant_id, description, entry_date, status, is_system_generated,
    entry_type, reference, cash_flow_category, posted_at, created_by
  )
  VALUES (
    v_tenant_id,
    'Petty Cash Voucher ' || v_voucher.voucher_number,
    v_voucher.date, 'posted', true,
    'petty_cash', v_voucher.voucher_number, 'operating', now(), auth.uid()
  )
  RETURNING id INTO v_je_id;

  -- Debit each expense line
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT v_je_id, account_id, amount, 0
  FROM petty_cash_voucher_lines
  WHERE voucher_id = p_voucher_id;

  -- Credit the petty cash fund for the total
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_coa_account_id, 0, v_line_total);

  -- Flip the voucher to approved
  UPDATE petty_cash_vouchers
  SET status = 'approved',
      approved_at = now(),
      journal_entry_id = v_je_id
  WHERE id = p_voucher_id;

  RETURN v_je_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_pcv(UUID) TO authenticated;


-- =====================================================================================
-- B.2  post_pcr() — approve and post a replenishment atomically
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.post_pcr(p_replenishment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_rep            petty_cash_replenishments%ROWTYPE;
  v_coa_account_id UUID;
  v_float          NUMERIC(14,2);
  v_balance        NUMERIC(14,2);
  v_je_id          UUID;
  v_period_closed  BOOLEAN;
BEGIN
  SELECT * INTO v_rep
  FROM petty_cash_replenishments
  WHERE id = p_replenishment_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPLENISHMENT_NOT_FOUND: %', p_replenishment_id USING ERRCODE = 'P0001';
  END IF;

  IF v_rep.status <> 'draft' THEN
    RAISE EXCEPTION 'INVALID_STATE: replenishment is "%", only draft can be posted', v_rep.status
      USING ERRCODE = 'P0002';
  END IF;

  IF v_rep.amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: replenishment amount must be positive' USING ERRCODE = 'P0003';
  END IF;

  -- Period lock
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND v_rep.date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: replenishment date % is in a closed period', v_rep.date
      USING ERRCODE = 'P0004';
  END IF;

  -- Lock fund and read its current ledger balance + defined float
  v_balance := pc_locked_ledger_balance(v_rep.petty_cash_account_id, v_tenant_id);

  SELECT account_id, float_amount INTO v_coa_account_id, v_float
  FROM petty_cash_accounts
  WHERE id = v_rep.petty_cash_account_id;

  -- Imprest guard: topping up must not push the fund above its defined float
  IF (v_balance + v_rep.amount) > v_float + 0.01 THEN
    RAISE EXCEPTION 'EXCEEDS_FLOAT: balance % + top-up % would exceed float %',
      v_balance, v_rep.amount, v_float
      USING ERRCODE = 'P0005';
  END IF;

  -- DR Petty Cash / CR Bank
  INSERT INTO journal_entries (
    tenant_id, description, entry_date, status, is_system_generated,
    entry_type, reference, cash_flow_category, posted_at, created_by
  )
  VALUES (
    v_tenant_id,
    'Petty Cash Replenishment ' || v_rep.replenishment_number,
    v_rep.date, 'posted', true,
    'petty_cash_replenishment', v_rep.replenishment_number, 'internal_transfer', now(), auth.uid()
  )
  RETURNING id INTO v_je_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES
    (v_je_id, v_coa_account_id, v_rep.amount, 0),
    (v_je_id, v_rep.bank_account_id, 0, v_rep.amount);

  UPDATE petty_cash_replenishments
  SET status = 'approved', journal_entry_id = v_je_id
  WHERE id = p_replenishment_id;

  RETURN v_je_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_pcr(UUID) TO authenticated;


-- =====================================================================================
-- B.3  post_pc_count() — reconcile a physical count and post any variance
-- =====================================================================================
-- Freezes the book balance at count time, computes variance against the counted
-- (denomination) total, and posts the difference to Cash Over/Short:
--   • Shortage (counted < book): DR Cash Over/Short, CR Petty Cash  (cash is missing)
--   • Overage  (counted > book): DR Petty Cash,       CR Cash Over/Short
-- A zero variance posts no journal entry but still records the count for audit.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.post_pc_count(p_count_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_count          petty_cash_counts%ROWTYPE;
  v_coa_account_id UUID;
  v_book           NUMERIC(14,2);
  v_counted        NUMERIC(14,2);
  v_variance       NUMERIC(14,2);
  v_cos_account_id UUID;
  v_je_id          UUID;
  v_period_closed  BOOLEAN;
BEGIN
  SELECT * INTO v_count
  FROM petty_cash_counts
  WHERE id = p_count_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUNT_NOT_FOUND: %', p_count_id USING ERRCODE = 'P0001';
  END IF;

  IF v_count.status <> 'draft' THEN
    RAISE EXCEPTION 'INVALID_STATE: count is "%", only draft can be posted', v_count.status
      USING ERRCODE = 'P0002';
  END IF;

  -- Period lock
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND v_count.count_date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: count date % is in a closed period', v_count.count_date
      USING ERRCODE = 'P0003';
  END IF;

  -- Lock fund and freeze the book balance at this instant
  v_book := pc_locked_ledger_balance(v_count.petty_cash_account_id, v_tenant_id);

  SELECT account_id INTO v_coa_account_id
  FROM petty_cash_accounts
  WHERE id = v_count.petty_cash_account_id;

  -- Counted balance = sum of denomination subtotals
  SELECT COALESCE(SUM(subtotal), 0) INTO v_counted
  FROM petty_cash_count_denominations
  WHERE count_id = p_count_id;

  v_variance := ROUND(v_counted - v_book, 2);

  -- Post variance only when non-zero
  IF v_variance <> 0 THEN
    v_cos_account_id := ensure_cash_over_short_account(v_tenant_id);

    INSERT INTO journal_entries (
      tenant_id, description, entry_date, status, is_system_generated,
      entry_type, reference, cash_flow_category, posted_at, created_by
    )
    VALUES (
      v_tenant_id,
      'Petty Cash Count Variance ' || v_count.count_number,
      v_count.count_date, 'posted', true,
      'petty_cash_count', v_count.count_number, 'operating', now(), auth.uid()
    )
    RETURNING id INTO v_je_id;

    IF v_variance < 0 THEN
      -- Shortage: cash is missing → expense it
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES
        (v_je_id, v_cos_account_id, ABS(v_variance), 0),
        (v_je_id, v_coa_account_id, 0, ABS(v_variance));
    ELSE
      -- Overage: more cash than books → income/contra-expense
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES
        (v_je_id, v_coa_account_id, v_variance, 0),
        (v_je_id, v_cos_account_id, 0, v_variance);
    END IF;
  END IF;

  UPDATE petty_cash_counts
  SET status = 'posted',
      book_balance = v_book,
      counted_balance = v_counted,
      variance = v_variance,
      journal_entry_id = v_je_id,   -- NULL when variance is zero
      approved_by = auth.uid(),
      posted_at = now()
  WHERE id = p_count_id;

  RETURN p_count_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_pc_count(UUID) TO authenticated;


-- =====================================================================================
-- Comments for documentation
-- =====================================================================================
COMMENT ON TABLE public.petty_cash_counts IS
  'Physical cash count headers. Reconciles ledger (book) balance against custodian-counted cash; variance posts to Cash Over/Short via post_pc_count().';
COMMENT ON TABLE public.petty_cash_count_denominations IS
  'Note/coin denomination breakdown for each physical count. SUM(subtotal) = counted_balance.';
COMMENT ON FUNCTION public.post_pcv(UUID) IS
  'Transactionally approves + posts a petty cash voucher. Row-locks the fund to prevent concurrent overdraw. Validates state, period, line/header total, and funds.';
COMMENT ON FUNCTION public.post_pcr(UUID) IS
  'Transactionally approves + posts a replenishment (DR Petty Cash / CR Bank). Enforces the imprest float ceiling under a row lock.';
COMMENT ON FUNCTION public.post_pc_count(UUID) IS
  'Reconciles a physical count and posts any variance to Cash Over/Short (7900). Zero variance records the count with no journal entry.';
COMMENT ON FUNCTION public.pc_next_document_number(UUID, TEXT) IS
  'Atomic, gapless per-tenant/per-year document numbering for PCV/PCR/PCC. Replaces race-prone COUNT(*)+1.';
