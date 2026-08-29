-- clear_suspense_lines() gains p_memo: a per-line narration written onto the
-- journal line that lands on the final account.
--
-- The split path (split_suspense_line) already takes a description per part, so
-- a split reads correctly on the Journal Entries page while a plain clearing
-- did not — every leg inherited the entry description. The two paths now put
-- the same kind of text in the same place.
--
-- p_note is unchanged: it is appended to the ENTRY description. p_memo is the
-- LINE description. Only the target leg carries it; the suspense leg stays
-- bare, exactly as in split_suspense_line().
--
-- The 4-argument function is dropped rather than left beside the new one: both
-- would match a PostgREST call naming the original four arguments, and Postgres
-- refuses an ambiguous call. Positional 4-argument callers (the e2e test) bind
-- to the new function unchanged.

DROP FUNCTION IF EXISTS public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.clear_suspense_lines(
  p_line_ids          UUID[],
  p_target_account_id UUID,
  p_note              TEXT DEFAULT NULL,
  -- When set, the engine LEARNS: this raw account_type variant is bound to the
  -- chosen account so the same text resolves automatically next import instead
  -- of returning to Suspense.
  p_teach_variant     TEXT DEFAULT NULL,
  -- Narration for the reclassified line itself; shows in the Description column
  -- of the Journal Entries page. NULL leaves the line inheriting the entry.
  p_memo              TEXT DEFAULT NULL
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
  v_suspense_id UUID;   -- resolved per line, by direction
  v_target      RECORD;
  v_line        RECORD;
  v_je_id       UUID;
  v_entry_date  DATE;
  v_cleared     INTEGER := 0;
  v_variant     TEXT;
  v_category    TEXT;
  v_side        TEXT;
  v_taught      BOOLEAN := false;
  v_memo        TEXT;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot clear suspense items', COALESCE(v_role, 'unknown');
  END IF;
  IF p_line_ids IS NULL OR array_length(p_line_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_LINES';
  END IF;

  v_memo := NULLIF(btrim(p_memo), '');

  SELECT bank_import_unrecognized_deposit_account_id,
         bank_import_unrecognized_payment_account_id
    INTO v_deposit_id, v_payment_id
    FROM public.account_settings WHERE tenant_id = v_tenant_id;
  IF v_deposit_id IS NULL OR v_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUSPENSE_NOT_CONFIGURED';
  END IF;

  SELECT id, is_active, is_postable INTO v_target FROM public.accounts
   WHERE id = p_target_account_id AND tenant_id = v_tenant_id;
  IF v_target.id IS NULL OR NOT v_target.is_active OR NOT v_target.is_postable THEN
    RAISE EXCEPTION 'TARGET_ACCOUNT_UNPOSTABLE';
  END IF;
  IF p_target_account_id IN (v_deposit_id, v_payment_id) THEN
    RAISE EXCEPTION 'TARGET_IS_SUSPENSE: pick the final account, not an Unrecognized holding account';
  END IF;

  FOR v_line IN
    SELECT l.* FROM public.bank_statement_lines l
     WHERE l.id = ANY (p_line_ids) AND l.tenant_id = v_tenant_id
     FOR UPDATE
  LOOP
    IF NOT v_line.needs_reclassification OR v_line.reclass_journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'LINE_NOT_OPEN: line % is not an open suspense item', v_line.id;
    END IF;
    IF v_line.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'LINE_NOT_POSTED: line % has no suspense journal', v_line.id;
    END IF;

    -- Date the reclass on the original transaction date unless that period
    -- is closed, in which case use today.
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
       'Suspense reclass: ' || COALESCE(NULLIF(btrim(v_line.description), ''), NULLIF(btrim(v_line.name), ''), 'bank import line')
         || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''),
       NULLIF(btrim(v_line.voucher_no), ''),
       'posted', 'bank_import_reclass', v_line.id,
       'bank_import_reclass:' || v_line.id::text,
       true, v_user_id, now())
    RETURNING id INTO v_je_id;

    -- Reverse out of whichever directional suspense account the line landed in.
    IF v_line.debit > 0 THEN
      -- Money out. Original: Dr Unrecognized Payments / Cr bank.
      -- Reclass: Dr target / Cr Unrecognized Payments.
      v_suspense_id := v_payment_id;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo) VALUES
        (v_je_id, p_target_account_id, round(v_line.debit, 2), 0, v_memo),
        (v_je_id, v_suspense_id, 0, round(v_line.debit, 2), NULL);
    ELSE
      -- Money in. Original: Dr bank / Cr Unrecognized Deposits.
      -- Reclass: Dr Unrecognized Deposits / Cr target.
      v_suspense_id := v_deposit_id;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo) VALUES
        (v_je_id, v_suspense_id, round(v_line.credit, 2), 0, NULL),
        (v_je_id, p_target_account_id, 0, round(v_line.credit, 2), v_memo);
    END IF;

    UPDATE public.bank_statement_lines
       SET reclass_journal_entry_id = v_je_id,
           needs_reclassification = false,
           reviewed_by = v_user_id,
           reviewed_at = now()
     WHERE id = v_line.id;

    v_cleared := v_cleared + 1;
  END LOOP;

  -- ── Teach the engine ────────────────────────────────────────────────────
  -- Bind the raw variant to the account the human just chose, so the next
  -- import resolves it deterministically at Tier 1 instead of parking it.
  v_variant := public.bank_normalize_text(p_teach_variant);
  IF v_variant <> '' THEN
    -- Prefer an existing category already pointing at this account, so the
    -- taxonomy is reused rather than growing a synonym per variant. Only when
    -- the account is not yet a posting target do we mint a category for it.
    SELECT canonical_category INTO v_category
      FROM public.bank_category_account_map
     WHERE tenant_id = v_tenant_id AND account_id = p_target_account_id AND is_active
     ORDER BY canonical_category LIMIT 1;

    IF v_category IS NULL THEN
      SELECT 'acct_' || a.account_code INTO v_category
        FROM public.accounts a WHERE a.id = p_target_account_id;
      -- Side follows how these items actually moved: money out → debit.
      SELECT CASE WHEN bool_and(l.debit > 0) THEN 'debit'
                  WHEN bool_and(l.credit > 0) THEN 'credit'
                  ELSE 'either' END
        INTO v_side
        FROM public.bank_statement_lines l
       WHERE l.id = ANY (p_line_ids) AND l.tenant_id = v_tenant_id;

      INSERT INTO public.bank_category_account_map
        (tenant_id, canonical_category, account_id, expected_side, is_active, created_by)
      VALUES (v_tenant_id, v_category, p_target_account_id, COALESCE(v_side, 'either'), true, v_user_id)
      ON CONFLICT (tenant_id, canonical_category) DO UPDATE
        SET account_id = EXCLUDED.account_id, is_active = true;
    END IF;

    INSERT INTO public.bank_category_canonical_map
      (tenant_id, raw_variant, canonical_category, created_by)
    VALUES (v_tenant_id, v_variant, v_category, v_user_id)
    ON CONFLICT (tenant_id, raw_variant) DO UPDATE
      SET canonical_category = EXCLUDED.canonical_category;
    v_taught := true;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Suspense Lines Cleared', 'bank_statement_lines',
          p_target_account_id,
          jsonb_build_object('line_ids', to_jsonb(p_line_ids), 'target_account_id', p_target_account_id,
                             'cleared', v_cleared, 'note', p_note, 'memo', v_memo,
                             'taught_variant', v_variant, 'taught_category', v_category));

  RETURN jsonb_build_object('cleared', v_cleared, 'target_account_id', p_target_account_id,
                            'taught', v_taught, 'taught_category', v_category);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT, TEXT) TO authenticated;
