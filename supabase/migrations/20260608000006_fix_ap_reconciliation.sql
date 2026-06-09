-- ─────────────────────────────────────────────────────────────────────────────
-- Fix ap_reconciliation_check: replace imprecise account matching
-- (ILIKE '%payable%' pulled in VAT Payable; hardcoded '2100' pulled in
--  Salaries Payable) with an exact match against the configured AP account
-- from account_settings and the control_account_type = 'VENDOR' flag.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ap_reconciliation_check(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id         UUID;
  v_subledger_balance NUMERIC(15,2);
  v_gl_balance        NUMERIC(15,2);
  v_variance          NUMERIC(15,2);
  v_ap_account_id     UUID;
BEGIN
  v_tenant_id := get_user_tenant_id();

  -- Resolve the AP control account: configured setting takes priority,
  -- then fall back to 'Accounts Payable' subtype or VENDOR control type.
  SELECT ap_account_id INTO v_ap_account_id
  FROM account_settings
  WHERE tenant_id = v_tenant_id
  LIMIT 1;

  -- Outstanding invoices from ap_transactions
  SELECT COALESCE(SUM(outstanding_amount), 0) INTO v_subledger_balance
  FROM ap_transactions
  WHERE tenant_id = v_tenant_id
    AND transaction_type = 'INVOICE'
    AND status IN ('OPEN', 'PARTIALLY_PAID')
    AND transaction_date <= p_as_of_date;

  -- GL balance: credit - debit on AP control lines
  -- Use configured ap_account_id OR control_account_type = 'VENDOR' OR
  -- exact subtype = 'Accounts Payable' (avoids matching VAT/Payroll payables)
  SELECT COALESCE(SUM(jl.credit - jl.debit), 0) INTO v_gl_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.tenant_id = v_tenant_id
    AND (
      (v_ap_account_id IS NOT NULL AND jl.account_id = v_ap_account_id)
      OR a.control_account_type = 'VENDOR'
      OR a.account_subtype = 'Accounts Payable'
    )
    AND a.account_type = 'Liability'
    AND je.status = 'posted'
    AND je.entry_date <= p_as_of_date;

  v_variance := ROUND(v_subledger_balance - v_gl_balance, 2);

  RETURN json_build_object(
    'subledger_balance', v_subledger_balance,
    'gl_balance',        v_gl_balance,
    'variance',          v_variance,
    'status',            CASE WHEN ABS(v_variance) < 0.01 THEN 'RECONCILED' ELSE 'VARIANCE_DETECTED' END,
    'as_of_date',        p_as_of_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ap_reconciliation_check(DATE) TO authenticated;
