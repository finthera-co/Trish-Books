
-- =========================================================
-- Petty cash voucher line account integrity
-- =========================================================

CREATE OR REPLACE FUNCTION public.fn_validate_pcv_line_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id        UUID;
  v_voucher_date     DATE;
  v_pc_account_row   UUID;  -- petty_cash_accounts.id on voucher
  v_pc_gl_account    UUID;  -- linked GL account
  v_acc_type         TEXT;
  v_acc_active       BOOLEAN;
  v_acc_name         TEXT;
  v_period_closed    BOOLEAN;
  v_is_pc_gl         BOOLEAN;
BEGIN
  SELECT v.tenant_id, v.date, v.petty_cash_account_id, pca.account_id
    INTO v_tenant_id, v_voucher_date, v_pc_account_row, v_pc_gl_account
  FROM petty_cash_vouchers v
  LEFT JOIN petty_cash_accounts pca ON pca.id = v.petty_cash_account_id
  WHERE v.id = NEW.voucher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_ERROR: Parent voucher % does not exist.', NEW.voucher_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 1. Same-account guard (debit GL = credit GL)
  IF v_pc_gl_account IS NOT NULL AND NEW.account_id = v_pc_gl_account THEN
    RAISE EXCEPTION
      'DOUBLE_ENTRY_VIOLATION: Voucher line account cannot be the same as the GL account behind the petty cash fund. This would produce an invalid journal entry.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Cannot post to any registered petty cash GL account for this tenant
  SELECT EXISTS (
    SELECT 1 FROM petty_cash_accounts
    WHERE tenant_id = v_tenant_id AND account_id = NEW.account_id
  ) INTO v_is_pc_gl;

  IF v_is_pc_gl THEN
    RAISE EXCEPTION
      'ACCOUNT_SUBTYPE_VIOLATION: The selected account is registered as a petty cash fund and cannot be used as an expense line. Use a proper expense or asset account.'
      USING ERRCODE = 'P0005';
  END IF;

  -- 3. Account exists & type check
  SELECT account_type, is_active, account_name
    INTO v_acc_type, v_acc_active, v_acc_name
  FROM accounts
  WHERE id = NEW.account_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_ERROR: Account % does not exist for this tenant.', NEW.account_id
      USING ERRCODE = 'P0003';
  END IF;

  IF v_acc_type NOT IN ('Asset', 'Expense', 'Other Expense', 'Cost of Goods Sold') THEN
    RAISE EXCEPTION
      'ACCOUNT_TYPE_VIOLATION: Account "%" is of type "%". Petty cash voucher lines must post to Asset, Expense, Other Expense, or Cost of Goods Sold accounts only.',
      v_acc_name, v_acc_type
      USING ERRCODE = 'P0004';
  END IF;

  -- 4. Period lock
  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND v_voucher_date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;

  IF v_period_closed THEN
    RAISE EXCEPTION
      'PERIOD_LOCKED: The voucher date % falls within a closed fiscal period. Reopen the period or change the date.',
      v_voucher_date
      USING ERRCODE = 'P0006';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pcv_line_account_integrity ON public.petty_cash_voucher_lines;

CREATE TRIGGER trg_pcv_line_account_integrity
  BEFORE INSERT OR UPDATE OF account_id
  ON public.petty_cash_voucher_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_pcv_line_account();

COMMENT ON FUNCTION public.fn_validate_pcv_line_account IS
  'Last-line-of-defence integrity check for petty cash voucher lines: blocks same-account debit/credit, petty cash GL accounts on lines, invalid account types, and closed-period postings.';

-- =========================================================
-- RPC: validate_pcv_line_account (frontend-callable preview)
-- =========================================================

CREATE OR REPLACE FUNCTION public.validate_pcv_line_account(
  p_account_id             UUID,
  p_petty_cash_account_id  UUID,
  p_voucher_date           DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      UUID := get_user_tenant_id();
  v_pc_gl_account  UUID;
  v_acc_type       TEXT;
  v_acc_active     BOOLEAN;
  v_acc_name       TEXT;
  v_is_pc_gl       BOOLEAN;
  v_period_closed  BOOLEAN;
  v_errors         JSONB := '[]'::JSONB;
  v_warnings       JSONB := '[]'::JSONB;
BEGIN
  -- Resolve linked GL account behind the petty cash fund
  SELECT account_id INTO v_pc_gl_account
  FROM petty_cash_accounts
  WHERE id = p_petty_cash_account_id AND tenant_id = v_tenant_id;

  -- Fetch account
  SELECT account_type, is_active, account_name
    INTO v_acc_type, v_acc_active, v_acc_name
  FROM accounts
  WHERE id = p_account_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'errors', jsonb_build_array(jsonb_build_object(
        'code', 'ACCOUNT_NOT_FOUND',
        'message', 'Selected account does not exist.'
      )),
      'warnings', '[]'::JSONB
    );
  END IF;

  IF v_pc_gl_account IS NOT NULL AND p_account_id = v_pc_gl_account THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'SAME_ACCOUNT_VIOLATION',
      'message', 'Expense account cannot be the same as the GL account behind the petty cash fund.'
    ));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM petty_cash_accounts
    WHERE tenant_id = v_tenant_id AND account_id = p_account_id
  ) INTO v_is_pc_gl;

  IF v_is_pc_gl THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'PETTY_CASH_SUBTYPE_VIOLATION',
      'message', format('Account "%s" is a petty cash fund account and cannot be used as an expense line.', v_acc_name)
    ));
  END IF;

  IF v_acc_type NOT IN ('Asset', 'Expense', 'Other Expense', 'Cost of Goods Sold') THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_ACCOUNT_TYPE',
      'message', format('Account "%s" is of type %s. Only Asset, Expense, Other Expense, or Cost of Goods Sold are permitted.', v_acc_name, v_acc_type)
    ));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE tenant_id = v_tenant_id
      AND p_voucher_date BETWEEN period_start AND period_end
      AND status = 'closed'
  ) INTO v_period_closed;

  IF v_period_closed THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'PERIOD_LOCKED',
      'message', format('The voucher date %s falls within a closed fiscal period.', p_voucher_date)
    ));
  END IF;

  IF NOT v_acc_active THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'INACTIVE_ACCOUNT',
      'message', format('Account "%s" is inactive. Confirm before proceeding.', v_acc_name)
    ));
  END IF;

  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'account_name', v_acc_name,
    'account_type', v_acc_type,
    'is_active', v_acc_active,
    'errors', v_errors,
    'warnings', v_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_pcv_line_account(UUID, UUID, DATE) TO authenticated;

COMMENT ON FUNCTION public.validate_pcv_line_account IS
  'Real-time validation for petty cash voucher line account selection. Returns structured errors and warnings for the UI before save.';
