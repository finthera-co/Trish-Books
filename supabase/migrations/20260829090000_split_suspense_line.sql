-- ═══════════════════════════════════════════════════════════════════════════
-- SUSPENSE CLEARING — split ONE suspense line across several final accounts.
--
-- clear_suspense_lines() sends every selected line, whole, to a single account.
-- A statement line is often a lump sum that belongs to more than one ledger
-- (one payment covering rent + utilities, one deposit covering two invoices).
-- This posts ONE reclass journal for the line: a leg per target account, and a
-- single leg reversing the whole amount out of the directional suspense
-- account. The original entry is never touched, and — exactly as in the
-- single-account path — the line ends up with one reclass_journal_entry_id.
--
-- The allocations must add up to the line to the cent. A partial split would
-- leave a residue in Suspense with the line already marked cleared, which is
-- the one state this screen exists to prevent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.split_suspense_line(
  p_line_id     UUID,
  -- [{ "account_id": uuid, "amount": numeric, "memo": text|null }, …]
  p_allocations JSONB,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_deposit_id  UUID;
  v_payment_id  UUID;
  v_suspense_id UUID;
  v_line        RECORD;
  v_je_id       UUID;
  v_entry_date  DATE;
  v_amount      NUMERIC(14,2);
  v_allocs      JSONB;
  v_total       NUMERIC(14,2);
  v_count       INTEGER;
  v_bad         UUID;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot clear suspense items', COALESCE(v_role, 'unknown');
  END IF;
  IF p_line_id IS NULL THEN RAISE EXCEPTION 'NO_LINE'; END IF;
  IF p_allocations IS NULL
     OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'NO_ALLOCATIONS';
  END IF;

  SELECT bank_import_unrecognized_deposit_account_id,
         bank_import_unrecognized_payment_account_id
    INTO v_deposit_id, v_payment_id
    FROM public.account_settings WHERE tenant_id = v_tenant_id;
  IF v_deposit_id IS NULL OR v_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUSPENSE_NOT_CONFIGURED';
  END IF;

  SELECT l.* INTO v_line
    FROM public.bank_statement_lines l
   WHERE l.id = p_line_id AND l.tenant_id = v_tenant_id
     FOR UPDATE;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'LINE_NOT_FOUND';
  END IF;
  IF NOT v_line.needs_reclassification OR v_line.reclass_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_NOT_OPEN: line % is not an open suspense item', v_line.id;
  END IF;
  IF v_line.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'LINE_NOT_POSTED: line % has no suspense journal', v_line.id;
  END IF;

  -- Same account twice is a user slip, not an error: merge the rows so the
  -- journal carries one leg per account. Every amount is rounded before it is
  -- summed, so what is validated is exactly what gets posted.
  SELECT jsonb_agg(jsonb_build_object('account_id', a.account_id, 'amount', a.amount, 'memo', a.memo)
                   ORDER BY a.amount DESC, a.account_id),
         COALESCE(SUM(a.amount), 0),
         COUNT(*)
    INTO v_allocs, v_total, v_count
    FROM (
      SELECT (x->>'account_id')::uuid                            AS account_id,
             round(SUM(round(COALESCE((x->>'amount')::numeric, 0), 2)), 2) AS amount,
             NULLIF(btrim(MAX(x->>'memo')), '')                  AS memo
        FROM jsonb_array_elements(p_allocations) x
       WHERE NULLIF(btrim(x->>'account_id'), '') IS NOT NULL
       GROUP BY 1
    ) a;
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'NO_ALLOCATIONS';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_allocs) x
              WHERE (x->>'amount')::numeric <= 0) THEN
    RAISE EXCEPTION 'ALLOCATION_NOT_POSITIVE: every split amount must be greater than zero';
  END IF;

  SELECT (x->>'account_id')::uuid INTO v_bad
    FROM jsonb_array_elements(v_allocs) x
   WHERE NOT EXISTS (
           SELECT 1 FROM public.accounts a
            WHERE a.id = (x->>'account_id')::uuid
              AND a.tenant_id = v_tenant_id
              AND a.is_active AND a.is_postable)
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'TARGET_ACCOUNT_UNPOSTABLE: %', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_allocs) x
              WHERE (x->>'account_id')::uuid IN (v_deposit_id, v_payment_id)) THEN
    RAISE EXCEPTION 'TARGET_IS_SUSPENSE: pick the final accounts, not an Unrecognized holding account';
  END IF;

  v_amount := round(CASE WHEN v_line.debit > 0 THEN v_line.debit ELSE v_line.credit END, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'LINE_HAS_NO_AMOUNT';
  END IF;
  IF v_total <> v_amount THEN
    RAISE EXCEPTION 'ALLOCATION_MISMATCH: allocations total % but the line is %', v_total, v_amount;
  END IF;

  -- Date the reclass on the original transaction date unless that period is
  -- closed, in which case use today — identical to clear_suspense_lines().
  v_entry_date := v_line.txn_date;
  IF EXISTS (SELECT 1 FROM public.fiscal_periods fp
              WHERE fp.tenant_id = v_tenant_id AND fp.status = 'closed'
                AND v_entry_date BETWEEN fp.period_start AND fp.period_end) THEN
    v_entry_date := CURRENT_DATE;
  END IF;

  INSERT INTO public.journal_entries
    (tenant_id, entry_date, description, reference, status,
     source_type, source_id, unique_key, is_system_generated, created_by, posted_at)
  VALUES
    (v_tenant_id, v_entry_date,
     'Suspense reclass (split ' || v_count || '): '
       || COALESCE(NULLIF(btrim(v_line.description), ''), NULLIF(btrim(v_line.name), ''), 'bank import line')
       || COALESCE(' - ' || NULLIF(btrim(p_note), ''), ''),
     NULLIF(btrim(v_line.voucher_no), ''),
     'posted', 'bank_import_reclass', v_line.id,
     'bank_import_reclass:' || v_line.id::text,
     true, v_user_id, now())
  RETURNING id INTO v_je_id;

  IF v_line.debit > 0 THEN
    -- Money out. Original: Dr Unrecognized Payments / Cr bank.
    -- Reclass: Dr each target / Cr Unrecognized Payments (one leg, full amount).
    v_suspense_id := v_payment_id;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    SELECT v_je_id, (x->>'account_id')::uuid, (x->>'amount')::numeric, 0, x->>'memo'
      FROM jsonb_array_elements(v_allocs) x;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (v_je_id, v_suspense_id, 0, v_amount);
  ELSE
    -- Money in. Original: Dr bank / Cr Unrecognized Deposits.
    -- Reclass: Dr Unrecognized Deposits (one leg, full amount) / Cr each target.
    v_suspense_id := v_deposit_id;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (v_je_id, v_suspense_id, v_amount, 0);
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    SELECT v_je_id, (x->>'account_id')::uuid, 0, (x->>'amount')::numeric, x->>'memo'
      FROM jsonb_array_elements(v_allocs) x;
  END IF;

  UPDATE public.bank_statement_lines
     SET reclass_journal_entry_id = v_je_id,
         needs_reclassification = false,
         reviewed_by = v_user_id,
         reviewed_at = now()
   WHERE id = v_line.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Suspense Line Split', 'bank_statement_lines', v_line.id,
          jsonb_build_object('line_id', v_line.id, 'journal_entry_id', v_je_id,
                             'amount', v_amount, 'allocations', v_allocs, 'note', p_note));

  RETURN jsonb_build_object('cleared', 1, 'splits', v_count,
                            'journal_entry_id', v_je_id, 'amount', v_amount);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.split_suspense_line(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_suspense_line(UUID, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.split_suspense_line(UUID, JSONB, TEXT)
  IS 'Reclassify one suspense line across several final accounts in a single reclass journal. '
     'Allocations must sum to the line amount exactly; duplicate accounts are merged.';
