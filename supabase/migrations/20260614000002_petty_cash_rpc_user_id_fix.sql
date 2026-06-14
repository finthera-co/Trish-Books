-- =====================================================================================
-- Petty Cash — RPC author-id fix
-- =====================================================================================
-- The industrial-grade migration (20260614000001) set journal_entries.created_by and
-- petty_cash_counts.approved_by to auth.uid(). Those columns are FKs to
-- public.users(id), but auth.uid() returns the AUTH user id (auth.users), which is
-- NOT public.users.id (users are resolved via users.auth_user_id = auth.uid(), see
-- get_user_tenant_id()). Posting therefore failed with a foreign-key violation.
--
-- This migration re-creates the three posting RPCs verbatim except that each resolves
-- the internal public.users.id (v_user_id) once and uses it for created_by /
-- approved_by. v_user_id may be NULL under a service role (auth.uid() NULL); the
-- columns are nullable, so that degrades gracefully instead of erroring.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- post_pcv()
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pcv(p_voucher_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_user_id        UUID;
  v_voucher        petty_cash_vouchers%ROWTYPE;
  v_coa_account_id UUID;
  v_balance        NUMERIC(14,2);
  v_je_id          UUID;
  v_line_total     NUMERIC(14,2);
  v_period_closed  BOOLEAN;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

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
    'petty_cash', v_voucher.voucher_number, 'operating', now(), v_user_id
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


-- -------------------------------------------------------------------------------------
-- post_pcr()
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pcr(p_replenishment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_user_id        UUID;
  v_rep            petty_cash_replenishments%ROWTYPE;
  v_coa_account_id UUID;
  v_float          NUMERIC(14,2);
  v_balance        NUMERIC(14,2);
  v_je_id          UUID;
  v_period_closed  BOOLEAN;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

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
    'petty_cash_replenishment', v_rep.replenishment_number, 'internal_transfer', now(), v_user_id
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


-- -------------------------------------------------------------------------------------
-- post_pc_count()
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pc_count(p_count_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_user_id        UUID;
  v_count          petty_cash_counts%ROWTYPE;
  v_coa_account_id UUID;
  v_book           NUMERIC(14,2);
  v_counted        NUMERIC(14,2);
  v_variance       NUMERIC(14,2);
  v_cos_account_id UUID;
  v_je_id          UUID;
  v_period_closed  BOOLEAN;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

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
      'petty_cash_count', v_count.count_number, 'operating', now(), v_user_id
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
      approved_by = v_user_id,
      posted_at = now()
  WHERE id = p_count_id;

  RETURN p_count_id;
END;
$$;
