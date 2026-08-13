-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH — GL-derived fund balance
--
-- The frontend already derived the balance from journal_lines rather than from
-- float + vouchers + replenishments, so there is no arithmetic discrepancy to
-- reconcile here. What it did NOT have was a server-side balance: the import's
-- sufficiency check has to run inside the posting transaction, not in a
-- browser that read the ledger a moment earlier.
--
-- These RPCs become the single source of truth. The client hooks are repointed
-- at them and their local arithmetic deleted — two balance sources that agree
-- today will eventually disagree silently, which is worse than an error.
--
-- Raw Dr − Cr. No normal-balance sign flipping: a cash asset carries a debit
-- balance, so a healthy fund returns a positive number.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_petty_cash_balance(
  p_petty_cash_account_id UUID,
  p_as_of                 DATE DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tenant  UUID := get_user_tenant_id();
  v_gl      UUID;
  v_balance NUMERIC(14,2);
BEGIN
  SELECT account_id INTO v_gl
  FROM petty_cash_accounts
  WHERE id = p_petty_cash_account_id
    AND tenant_id = v_tenant;

  IF v_gl IS NULL THEN
    RAISE EXCEPTION 'Petty cash fund % not found for this tenant', p_petty_cash_account_id;
  END IF;

  SELECT COALESCE(SUM(jl.debit - jl.credit), 0)
    INTO v_balance
  FROM journal_lines   jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = v_gl
    AND je.tenant_id  = v_tenant
    AND je.status     = 'posted'
    AND (p_as_of IS NULL OR je.entry_date <= p_as_of);

  RETURN v_balance;
END;
$$;

COMMENT ON FUNCTION public.get_petty_cash_balance(UUID, DATE) IS
  'Fund cash on hand as SUM(debit - credit) over posted journal lines on the fund''s GL account. Single source of truth for every petty cash balance display and every posting-time sufficiency check.';

-- Breakdown variant backing the UI card (float, spent, replenished, remaining).
-- Same underlying scan, so it can never disagree with the scalar above.
CREATE OR REPLACE FUNCTION public.get_petty_cash_balance_summary(
  p_petty_cash_account_id UUID,
  p_as_of                 DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := get_user_tenant_id();
  v_gl     UUID;
  v_float  NUMERIC(14,2);
  v_result JSONB;
BEGIN
  SELECT account_id, float_amount INTO v_gl, v_float
  FROM petty_cash_accounts
  WHERE id = p_petty_cash_account_id
    AND tenant_id = v_tenant;

  IF v_gl IS NULL THEN
    RETURN jsonb_build_object(
      'float_amount', 0, 'total_spent', 0, 'total_replenished', 0, 'remaining', 0);
  END IF;

  SELECT jsonb_build_object(
           'float_amount',      COALESCE(v_float, 0),
           'total_spent',       COALESCE(SUM(jl.credit), 0),
           'total_replenished', COALESCE(SUM(jl.debit), 0),
           'remaining',         COALESCE(SUM(jl.debit - jl.credit), 0)
         )
    INTO v_result
  FROM journal_lines   jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = v_gl
    AND je.tenant_id  = v_tenant
    AND je.status     = 'posted'
    AND (p_as_of IS NULL OR je.entry_date <= p_as_of);

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_petty_cash_balance_summary(UUID, DATE) IS
  'get_petty_cash_balance plus the debit/credit split and the fund''s defined float, for the balance card. Derived from the same scan so it cannot drift from the scalar.';
