-- ═══════════════════════════════════════════════════════════════════════════
-- BANK STATEMENT IMPORT — atomic posting + suspense clearing RPCs
--
-- Posting runs as ONE Postgres function call = one transaction: a batch is
-- fully posted or not at all. Sequential inserts from an edge function are
-- not atomic; this is why posting lives here and the edge function only
-- orchestrates.
--
--   • resolved lines (tier 1/2) → JE: bank GL ↔ mapped ledger account
--   • suspense lines (tier 3)   → JE: bank GL ↔ DIRECTIONAL suspense account,
--                                 flagged needs_reclassification:
--                                   money OUT → Unrecognized Payments (expense)
--                                   money IN  → Unrecognized Deposits (income)
--   • blocked lines (corrupt)   → no JE, block_reason recorded
--
-- Direction convention (payment-analysis workbook, account-holder view):
--   Debit column  = money OUT of the bank → Cr bank GL, Dr category account
--   Credit column = money INTO the bank   → Dr bank GL, Cr category account
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_bank_statement_post(
  p_batch_id       UUID,
  p_actor_user_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch       public.bank_statement_batches;
  v_actor       public.users;
  v_settings    RECORD;
  v_deposit_id  UUID;   -- Unrecognized Deposits — unresolved money IN
  v_payment_id  UUID;   -- Unrecognized Payments — unresolved money OUT
  v_mode        TEXT;
  v_je_status   TEXT;
  v_bank        RECORD;
  v_susp        RECORD;
  v_n           INTEGER;
  v_sum_debit   NUMERIC;
  v_sum_credit  NUMERIC;
  v_row_count   INTEGER;
  v_summary     JSONB;
BEGIN
  SELECT * INTO v_batch FROM public.bank_statement_batches
   WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_batch.status <> 'processing' THEN
    RAISE EXCEPTION 'BATCH_NOT_PROCESSING: batch is %', v_batch.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_actor FROM public.users
   WHERE id = p_actor_user_id AND tenant_id = v_batch.tenant_id;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'ACTOR_NOT_IN_TENANT'; END IF;

  -- ── Settings: both suspense accounts REQUIRED, never a fallback ─────────
  SELECT bank_import_unrecognized_deposit_account_id,
         bank_import_unrecognized_payment_account_id,
         bank_import_posting_mode
    INTO v_settings
    FROM public.account_settings WHERE tenant_id = v_batch.tenant_id;
  v_deposit_id := v_settings.bank_import_unrecognized_deposit_account_id;
  v_payment_id := v_settings.bank_import_unrecognized_payment_account_id;
  IF v_deposit_id IS NULL OR v_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUSPENSE_NOT_CONFIGURED: set both the Unrecognized Deposits and Unrecognized Payments accounts in Settings before importing'
      USING ERRCODE = 'P0001';
  END IF;
  v_mode := COALESCE(v_batch.posting_mode, v_settings.bank_import_posting_mode, 'auto_post');
  v_je_status := CASE WHEN v_mode = 'draft' THEN 'draft' ELSE 'posted' END;

  -- ── Account gates ───────────────────────────────────────────────────────
  FOR v_susp IN
    SELECT a.id, a.is_active, a.is_postable, a.account_name
      FROM public.accounts a
     WHERE a.id IN (v_deposit_id, v_payment_id) AND a.tenant_id = v_batch.tenant_id
  LOOP
    IF NOT v_susp.is_active OR NOT v_susp.is_postable THEN
      RAISE EXCEPTION 'SUSPENSE_ACCOUNT_UNPOSTABLE: "%" must be an active, postable account', v_susp.account_name
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.accounts
       WHERE id IN (v_deposit_id, v_payment_id) AND tenant_id = v_batch.tenant_id) <> 2 THEN
    RAISE EXCEPTION 'SUSPENSE_ACCOUNT_MISSING: the configured Unrecognized Deposits/Payments accounts were not found in this tenant';
  END IF;

  SELECT id, is_active, is_postable INTO v_bank FROM public.accounts
   WHERE id = v_batch.bank_account_id AND tenant_id = v_batch.tenant_id;
  IF v_bank.id IS NULL OR NOT v_bank.is_active OR NOT v_bank.is_postable THEN
    RAISE EXCEPTION 'BANK_ACCOUNT_UNPOSTABLE';
  END IF;
  IF v_batch.bank_account_id IN (v_deposit_id, v_payment_id) THEN
    RAISE EXCEPTION 'SUSPENSE_IS_BANK: a suspense account cannot be the bank account itself';
  END IF;

  -- ── Every includable line must carry a recorded resolution ──────────────
  SELECT count(*) INTO v_n FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded
     AND l.block_reason IS NULL AND l.resolution_tier IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'UNRESOLVED_LINES: % line(s) have no resolution recorded', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded AND l.block_reason IS NULL
     AND l.resolution_tier IN (1, 2) AND l.resolved_account_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'RESOLVED_WITHOUT_ACCOUNT: % line(s) marked resolved but missing an account', v_n;
  END IF;

  -- ── Tenant isolation: every target account must belong to THIS tenant ───
  -- This function runs SECURITY DEFINER (RLS bypassed), so the account each
  -- line points at is re-verified here rather than trusted from the row. A
  -- line could otherwise name another tenant's account and post into it.
  SELECT count(*) INTO v_n
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id
     AND l.resolved_account_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.accounts a
        WHERE a.id = l.resolved_account_id
          AND a.tenant_id = v_batch.tenant_id
          AND a.is_active AND a.is_postable);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CROSS_TENANT_ACCOUNT: % line(s) reference an account that is not an active, postable account of this tenant', v_n;
  END IF;

  -- Lines must all carry the batch's tenant_id (no smuggling foreign rows in).
  SELECT count(*) INTO v_n FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.tenant_id <> v_batch.tenant_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CROSS_TENANT_LINE: % line(s) do not belong to the batch tenant', v_n;
  END IF;

  -- ── Closed-period gate ──────────────────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM public.bank_statement_lines l
    JOIN public.fiscal_periods fp
      ON fp.tenant_id = l.tenant_id
     AND fp.status = 'closed'
     AND l.txn_date BETWEEN fp.period_start AND fp.period_end
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded AND l.block_reason IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CLOSED_PERIOD: % line(s) fall in a closed fiscal period; reopen the period or exclude those sheets', v_n
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Control totals: parse-time totals must equal post-time totals ───────
  SELECT COALESCE(sum(l.debit), 0), COALESCE(sum(l.credit), 0), count(*)
    INTO v_sum_debit, v_sum_credit, v_row_count
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded;
  IF round(v_sum_debit, 2) <> round(v_batch.total_debit, 2)
     OR round(v_sum_credit, 2) <> round(v_batch.total_credit, 2)
     OR v_row_count <> v_batch.row_count THEN
    RAISE EXCEPTION 'CONTROL_TOTAL_MISMATCH: parsed (Dr %, Cr %, n=%) vs stored (Dr %, Cr %, n=%)',
      v_sum_debit, v_sum_credit, v_row_count,
      v_batch.total_debit, v_batch.total_credit, v_batch.row_count;
  END IF;

  -- ── Bulk mode: suppress the per-row budget recalc trigger ───────────────
  -- It aggregates the whole ledger per inserted line, which is quadratic on a
  -- statement of this size. Budgets are trued up once at the end instead.
  -- Transaction-scoped (is_local = true), so it cannot leak to other sessions.
  PERFORM set_config('app.bank_import_bulk', '1', true);

  -- ── Journal entries: one per postable line, idempotent on unique_key ────
  INSERT INTO public.journal_entries
    (tenant_id, entry_date, description, reference, status,
     source_type, source_id, unique_key, is_system_generated, created_by, posted_at)
  SELECT l.tenant_id, l.txn_date,
         'Bank import: ' || COALESCE(NULLIF(btrim(l.description), ''), NULLIF(btrim(l.name), ''), l.sheet_name || ' row ' || l.row_index),
         NULLIF(btrim(l.voucher_no), ''),
         v_je_status,
         'bank_import', l.id, 'bank_import:' || l.id::text,
         true, p_actor_user_id,
         CASE WHEN v_je_status = 'posted' THEN now() END
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded AND l.block_reason IS NULL;

  UPDATE public.bank_statement_lines l
     SET journal_entry_id = je.id,
         needs_reclassification = (l.resolution_tier = 3)
    FROM public.journal_entries je
   WHERE l.batch_id = p_batch_id
     AND je.unique_key = 'bank_import:' || l.id::text;

  -- Bank-GL side: statement Debit = money out → credit the bank account.
  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT l.journal_entry_id, v_batch.bank_account_id,
         CASE WHEN l.credit > 0 THEN round(l.credit, 2) ELSE 0 END,
         CASE WHEN l.debit  > 0 THEN round(l.debit, 2)  ELSE 0 END
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;

  -- Counter side: mapped account for tier 1/2; for tier 3 the DIRECTIONAL
  -- suspense account — money out → Unrecognized Payments, money in →
  -- Unrecognized Deposits (mirrors the client's own workbook practice).
  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT l.journal_entry_id,
         CASE WHEN l.resolution_tier IN (1, 2) THEN l.resolved_account_id
              WHEN l.debit > 0                 THEN v_payment_id
              ELSE                                  v_deposit_id END,
         CASE WHEN l.debit  > 0 THEN round(l.debit, 2)  ELSE 0 END,
         CASE WHEN l.credit > 0 THEN round(l.credit, 2) ELSE 0 END
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;

  -- ── Balanced-entry verification: any failure aborts the whole batch ─────
  SELECT count(*) INTO v_n
    FROM (
      SELECT jl.journal_entry_id
        FROM public.journal_lines jl
        JOIN public.bank_statement_lines l ON l.journal_entry_id = jl.journal_entry_id
       WHERE l.batch_id = p_batch_id
       GROUP BY jl.journal_entry_id
      HAVING abs(sum(jl.debit) - sum(jl.credit)) > 0.005
          OR (sum(jl.debit) = 0 AND sum(jl.credit) = 0)
          OR count(*) <> 2
    ) bad;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'UNBALANCED_JOURNALS: % generated entr(ies) failed the balance check — batch aborted', v_n;
  END IF;

  -- ── In-transaction posted-value check against control totals ────────────
  -- EXACT, not tolerance-based: statement amounts are constrained to 2dp
  -- (bank_statement_lines_amounts_scale) and journal_lines is NUMERIC(14,2),
  -- so every posted value must reconcile to the cent. A tolerance here would
  -- hide precisely the rounding drift this check exists to catch.
  SELECT COALESCE(sum(jl.credit), 0) INTO v_sum_debit
    FROM public.journal_lines jl
    JOIN public.bank_statement_lines l ON l.journal_entry_id = jl.journal_entry_id
   WHERE l.batch_id = p_batch_id AND jl.account_id = v_batch.bank_account_id;
  SELECT COALESCE(sum(l.debit), 0) INTO v_sum_credit
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;
  IF v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'POSTED_TOTAL_MISMATCH: bank credited % but statement debits total %', v_sum_debit, v_sum_credit;
  END IF;

  SELECT COALESCE(sum(jl.debit), 0) INTO v_sum_debit
    FROM public.journal_lines jl
    JOIN public.bank_statement_lines l ON l.journal_entry_id = jl.journal_entry_id
   WHERE l.batch_id = p_batch_id AND jl.account_id = v_batch.bank_account_id;
  SELECT COALESCE(sum(l.credit), 0) INTO v_sum_credit
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;
  IF v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'POSTED_TOTAL_MISMATCH: bank debited % but statement credits total %', v_sum_debit, v_sum_credit;
  END IF;

  -- Double-entry invariant across the whole batch: Σ debits = Σ credits.
  SELECT COALESCE(sum(jl.debit), 0), COALESCE(sum(jl.credit), 0)
    INTO v_sum_debit, v_sum_credit
    FROM public.journal_lines jl
    JOIN public.bank_statement_lines l ON l.journal_entry_id = jl.journal_entry_id
   WHERE l.batch_id = p_batch_id;
  IF v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'BATCH_NOT_BALANCED: total debits % <> total credits %', v_sum_debit, v_sum_credit;
  END IF;

  -- ── Summary + batch close-out ───────────────────────────────────────────
  SELECT jsonb_build_object(
      'je_status', v_je_status,
      'posted_to_ledger_count',  count(*) FILTER (WHERE l.resolution_tier IN (1, 2)),
      'posted_to_ledger_value',  COALESCE(sum(l.debit + l.credit) FILTER (WHERE l.resolution_tier IN (1, 2)), 0),
      'posted_to_suspense_count', count(*) FILTER (WHERE l.resolution_tier = 3),
      'posted_to_suspense_value', COALESCE(sum(l.debit + l.credit) FILTER (WHERE l.resolution_tier = 3), 0),
      'blocked_count',           count(*) FILTER (WHERE l.block_reason IS NOT NULL),
      'excluded_count',          count(*) FILTER (WHERE l.is_excluded),
      'suspense_reasons',        COALESCE((
        SELECT jsonb_object_agg(r.suspense_reason, r.n)
          FROM (SELECT suspense_reason, count(*) n
                  FROM public.bank_statement_lines
                 WHERE batch_id = p_batch_id AND suspense_reason IS NOT NULL
                 GROUP BY suspense_reason) r
      ), '{}'::jsonb))
    INTO v_summary
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id;

  -- Budgets: one recalculation per (account, period) actually touched, now
  -- that all lines are in place. Re-enable normal trigger behaviour first so
  -- nothing later in this transaction runs in bulk mode.
  PERFORM set_config('app.bank_import_bulk', '0', true);
  PERFORM public.recalc_budget_for_bank_batch(p_batch_id);

  UPDATE public.bank_statement_batches
     SET status = 'posted', posted_at = now(), summary = v_summary
   WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_batch.tenant_id, p_actor_user_id, 'Bank Statement Batch Posted',
          'bank_statement_batches', p_batch_id, v_summary);

  RETURN v_summary;
END;
$$;

-- Called by the import-bank-statement edge function (service role) only.
REVOKE EXECUTE ON FUNCTION public.import_bank_statement_post(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- SUSPENSE CLEARING — reclassify suspense lines to a final account.
-- Generates a reclass JE (Suspense → final account) per line; the original
-- JE is NEVER mutated. Suspense nets to zero for the line.
-- ═══════════════════════════════════════════════════════════════════════════

-- Mirror of normalizeText() in src/lib/bankCategorization/normalize.ts. Both
-- sides must agree exactly or a taught variant would never match on re-import.
-- Kept in step by a test that runs the same corpus through each.
CREATE OR REPLACE FUNCTION public.bank_normalize_text(p_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(
           btrim(regexp_replace(
             lower(normalize(COALESCE(p_input, ''), NFKC)), '\s+', ' ', 'g')),
           '[.,;:!-]+$', ''));
$$;

CREATE OR REPLACE FUNCTION public.clear_suspense_lines(
  p_line_ids          UUID[],
  p_target_account_id UUID,
  p_note              TEXT DEFAULT NULL,
  -- When set, the engine LEARNS: this raw account_type variant is bound to the
  -- chosen account so the same text resolves automatically next import instead
  -- of returning to Suspense.
  p_teach_variant     TEXT DEFAULT NULL
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
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
        (v_je_id, p_target_account_id, round(v_line.debit, 2), 0),
        (v_je_id, v_suspense_id, 0, round(v_line.debit, 2));
    ELSE
      -- Money in. Original: Dr bank / Cr Unrecognized Deposits.
      -- Reclass: Dr Unrecognized Deposits / Cr target.
      v_suspense_id := v_deposit_id;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
        (v_je_id, v_suspense_id, round(v_line.credit, 2), 0),
        (v_je_id, p_target_account_id, 0, round(v_line.credit, 2));
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
                             'cleared', v_cleared, 'note', p_note,
                             'taught_variant', v_variant, 'taught_category', v_category));

  RETURN jsonb_build_object('cleared', v_cleared, 'target_account_id', p_target_account_id,
                            'taught', v_taught, 'taught_category', v_category);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bank_normalize_text(TEXT) TO authenticated;
