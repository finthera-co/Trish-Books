-- =====================================================================================
-- Petty Cash — True Imprest Replenishment
-- =====================================================================================
-- Converts replenishment from "type an arbitrary amount" into a proper imprest
-- (fixed-float) top-up:
--
--   • A replenishment reimburses a *batch* of approved-but-unreimbursed vouchers.
--   • The top-up amount equals the SUM of those vouchers, which (by construction)
--     restores the fund from its depleted balance back to its fixed float.
--   • Every voucher is stamped with the replenishment that reimbursed it, giving a
--     full audit trail of "which expenses this top-up covered."
--
-- Design: each voucher carries a nullable replenishment_id. A voucher is
-- "unreimbursed" when status='approved' AND replenishment_id IS NULL. The build RPC
-- selects those, locks them, sums them, posts DR Petty Cash / CR Bank, and stamps
-- them — all in one transaction.
--
-- Depends on: pc_next_document_number(), pc_locked_ledger_balance() from
-- 20260614000001_petty_cash_industrial_grade.sql. Run that migration first.
--
-- NOTE (deviation from the source SQL): created_by is set to the internal
-- public.users.id resolved via auth_user_id = auth.uid(), NOT auth.uid() directly.
-- journal_entries.created_by is an FK to public.users(id); auth.uid() returns the
-- auth user id (auth.users), which is a different value and would FK-violate. This
-- matches the established pattern in the tax posting RPCs and the petty-cash
-- author-id fix (20260614000002).
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Link vouchers to the replenishment that reimbursed them
-- -------------------------------------------------------------------------------------
ALTER TABLE public.petty_cash_vouchers
  ADD COLUMN IF NOT EXISTS replenishment_id UUID
    REFERENCES public.petty_cash_replenishments(id) ON DELETE SET NULL;

-- Fast lookup of unreimbursed approved vouchers per fund
CREATE INDEX IF NOT EXISTS idx_pcv_unreimbursed
  ON public.petty_cash_vouchers (tenant_id, petty_cash_account_id, status)
  WHERE replenishment_id IS NULL;

COMMENT ON COLUMN public.petty_cash_vouchers.replenishment_id IS
  'The replenishment batch that reimbursed this voucher. NULL = approved but not yet reimbursed (counts toward the next top-up).';


-- -------------------------------------------------------------------------------------
-- 2. Read model: unreimbursed vouchers for a fund (drives the UI preview)
-- -------------------------------------------------------------------------------------
-- Returns the approved vouchers awaiting reimbursement plus a running total, so the
-- replenishment screen can show exactly which expenses the top-up will cover and how
-- much the fund will be restored by.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pc_unreimbursed_vouchers(p_pc_account_id UUID)
RETURNS TABLE (
  voucher_id      UUID,
  voucher_number  TEXT,
  voucher_date    DATE,
  paid_to         TEXT,
  total_amount    NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.voucher_number, v.date, v.paid_to, v.total_amount
  FROM petty_cash_vouchers v
  WHERE v.tenant_id = get_user_tenant_id()
    AND v.petty_cash_account_id = p_pc_account_id
    AND v.status = 'approved'
    AND v.replenishment_id IS NULL
  ORDER BY v.date ASC, v.voucher_number ASC;
$$;

GRANT EXECUTE ON FUNCTION public.pc_unreimbursed_vouchers(UUID) TO authenticated;


-- -------------------------------------------------------------------------------------
-- 3. Build + post a true imprest replenishment in one transaction
-- -------------------------------------------------------------------------------------
-- Steps (all atomic, all row-locked against concurrent posting):
--   1. Lock the fund and read its current ledger balance + defined float.
--   2. Lock and select the approved, unreimbursed vouchers for this fund.
--      (Optional p_voucher_ids lets the caller reimburse a subset; default = all.)
--   3. Sum them → top-up amount.
--   4. Imprest sanity check: balance + top-up must equal the float (within tolerance).
--      This is the defining property of an imprest system — the top-up restores the
--      fund to exactly its fixed float. A mismatch means an un-posted count variance
--      or a voucher posted outside this flow; we surface it rather than silently
--      over/under-funding.
--   5. Create the PCR row, post DR Petty Cash / CR Bank, stamp each voucher.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_imprest_replenishment(
  p_pc_account_id   UUID,
  p_bank_account_id UUID,
  p_date            DATE DEFAULT CURRENT_DATE,
  p_voucher_ids     UUID[] DEFAULT NULL,   -- NULL = reimburse ALL unreimbursed vouchers
  p_allow_partial   BOOLEAN DEFAULT FALSE  -- TRUE = skip the exact-float imprest check
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_user_id        UUID;
  v_coa_account_id UUID;
  v_float          NUMERIC(14,2);
  v_balance        NUMERIC(14,2);
  v_topup          NUMERIC(14,2);
  v_voucher_count  INTEGER;
  v_rep_number     TEXT;
  v_rep_id         UUID;
  v_je_id          UUID;
  v_period_closed  BOOLEAN;
  v_expected_float NUMERIC(14,2);
BEGIN
  SELECT id INTO v_user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

  -- --- Validate the bank account belongs to the tenant -------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = p_bank_account_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'BANK_NOT_FOUND: bank account % not found for tenant', p_bank_account_id
      USING ERRCODE = 'P0001';
  END IF;

  -- --- Period lock -------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND p_date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: date % is in a closed period', p_date
      USING ERRCODE = 'P0002';
  END IF;

  -- --- Lock fund, read balance + float (serialises concurrent postings) --------------
  v_balance := pc_locked_ledger_balance(p_pc_account_id, v_tenant_id);

  SELECT account_id, float_amount INTO v_coa_account_id, v_float
  FROM petty_cash_accounts
  WHERE id = p_pc_account_id AND tenant_id = v_tenant_id;

  IF v_coa_account_id IS NULL THEN
    RAISE EXCEPTION 'PC_ACCOUNT_NOT_FOUND: %', p_pc_account_id USING ERRCODE = 'P0003';
  END IF;

  -- --- Lock the candidate vouchers and sum them --------------------------------------
  -- We lock the rows we're about to stamp so a concurrent replenishment can't grab the
  -- same vouchers. FOR UPDATE on the SELECT used for both the sum and the later UPDATE.
  CREATE TEMP TABLE _pcr_batch ON COMMIT DROP AS
  SELECT v.id, v.total_amount
  FROM petty_cash_vouchers v
  WHERE v.tenant_id = v_tenant_id
    AND v.petty_cash_account_id = p_pc_account_id
    AND v.status = 'approved'
    AND v.replenishment_id IS NULL
    AND (p_voucher_ids IS NULL OR v.id = ANY(p_voucher_ids))
  FOR UPDATE;

  SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
    INTO v_voucher_count, v_topup
  FROM _pcr_batch;

  IF v_voucher_count = 0 THEN
    RAISE EXCEPTION 'NO_VOUCHERS: there are no approved, unreimbursed vouchers to replenish'
      USING ERRCODE = 'P0004';
  END IF;

  -- If a specific subset was requested, ensure every requested id was actually eligible
  IF p_voucher_ids IS NOT NULL THEN
    IF v_voucher_count <> array_length(p_voucher_ids, 1) THEN
      RAISE EXCEPTION 'VOUCHER_INELIGIBLE: one or more selected vouchers are not approved/unreimbursed for this fund'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  -- --- Imprest integrity check -------------------------------------------------------
  -- After topping up by the sum of vouchers, the fund should sit at its float again.
  -- balance currently reflects float minus the spent (voucher) amounts, so:
  --     balance + topup  ==  float    (within 1 cent)
  v_expected_float := v_balance + v_topup;
  IF NOT p_allow_partial AND ABS(v_expected_float - v_float) > 0.01 THEN
    RAISE EXCEPTION
      'IMPREST_MISMATCH: restoring by % brings the fund to % but the defined float is %. '
      'This usually means an unposted cash-count variance or a posting made outside the voucher flow. '
      'Resolve it, or pass allow_partial to top up by the voucher total regardless.',
      v_topup, v_expected_float, v_float
      USING ERRCODE = 'P0006';
  END IF;

  -- --- Create the replenishment row --------------------------------------------------
  v_rep_number := pc_next_document_number(v_tenant_id, 'PCR');

  INSERT INTO petty_cash_replenishments (
    tenant_id, replenishment_number, date,
    petty_cash_account_id, bank_account_id, amount, status
  )
  VALUES (
    v_tenant_id, v_rep_number, p_date,
    p_pc_account_id, p_bank_account_id, v_topup, 'approved'
  )
  RETURNING id INTO v_rep_id;

  -- --- Post DR Petty Cash / CR Bank --------------------------------------------------
  INSERT INTO journal_entries (
    tenant_id, description, entry_date, status, is_system_generated,
    entry_type, reference, cash_flow_category, posted_at, created_by
  )
  VALUES (
    v_tenant_id,
    'Petty Cash Replenishment ' || v_rep_number || ' (' || v_voucher_count || ' vouchers)',
    p_date, 'posted', true,
    'petty_cash_replenishment', v_rep_number, 'internal_transfer', now(), v_user_id
  )
  RETURNING id INTO v_je_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES
    (v_je_id, v_coa_account_id, v_topup, 0),
    (v_je_id, p_bank_account_id, 0, v_topup);

  UPDATE petty_cash_replenishments
  SET journal_entry_id = v_je_id
  WHERE id = v_rep_id;

  -- --- Stamp every voucher in the batch ----------------------------------------------
  UPDATE petty_cash_vouchers
  SET replenishment_id = v_rep_id
  WHERE id IN (SELECT id FROM _pcr_batch);

  -- --- Return a summary for the UI ---------------------------------------------------
  RETURN jsonb_build_object(
    'replenishment_id',     v_rep_id,
    'replenishment_number', v_rep_number,
    'journal_entry_id',     v_je_id,
    'voucher_count',        v_voucher_count,
    'amount',               v_topup,
    'balance_before',       v_balance,
    'balance_after',        v_expected_float,
    'float',                v_float
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_imprest_replenishment(UUID, UUID, DATE, UUID[], BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.post_imprest_replenishment IS
  'Builds + posts a true imprest replenishment from approved, unreimbursed vouchers. Locks the fund and the voucher batch, restores the float, posts DR Petty Cash / CR Bank, and stamps each voucher with the replenishment id. Pass p_voucher_ids for a subset, p_allow_partial to bypass the exact-float check.';

COMMENT ON FUNCTION public.pc_unreimbursed_vouchers IS
  'Lists approved vouchers for a fund that have not yet been reimbursed by a replenishment. Drives the replenishment preview.';
