-- ═══════════════════════════════════════════════════════════════════════════
-- SUSPENSE CLEARING — reclassify IN PLACE, no second journal entry.
--
-- Until now, clearing a suspense item posted a SECOND journal entry that
-- reversed the holding account and debited the final one:
--
--   import    Dr 6010 Unrecognized Payments  / Cr 1100 Bank      (at import)
--   clearing  Dr 2420 Director Current Acct  / Cr 6010           (at clearing)
--
-- Correct double entry, but it leaves every cleared item as two rows in the
-- suspense register — same date, same amount, same cheque and payee, one debit
-- and one credit — which reads as a duplicate, and which nothing can pair up
-- because the reclass leg carries no bank. It also created a second entry that
-- could be orphaned: re-coding the original posting in the ledger afterwards
-- left the reclass credit behind with nothing to reverse, double-counting the
-- final account. That is exactly what happened to three lines on this tenant.
--
-- Clearing now re-points the ORIGINAL entry's suspense leg instead:
--
--   before    Dr 6010 Unrecognized Payments  / Cr 1100 Bank
--   after     Dr 2420 Director Current Acct  / Cr 1100 Bank
--
-- One entry, one row per transaction, nothing to orphan. The bank leg is never
-- touched — the bank was already recorded at import and must not move again.
--
-- ── Why editing the original entry is sound here, and where it is not ──────
--
-- A bank-feed posting is a PROVISIONAL coding: the statement fixes the cash
-- side beyond doubt, while the contra account is a working assumption held in
-- a suspense account precisely because it is not yet known. Refining that
-- coding inside an open period is completing the original entry, not restating
-- a reported one — the same treatment QuickBooks and Xero apply when a
-- downloaded transaction is re-categorised.
--
-- That reasoning stops at the period boundary. Once a period is CLOSED its
-- figures have been reported, and amending an entry inside it would restate
-- them silently. So the closed-period case keeps the old behaviour: a separate,
-- properly dated reclassification entry in the current open period, which is
-- the correct treatment for a prior-period reclassification (IAS 8 — corrected
-- prospectively through a current-period entry, never by editing history).
--
-- Both paths are therefore retained, chosen per line by the state of the
-- period the original entry sits in:
--
--   open period    → in_place  : re-point the suspense leg, no new entry
--   closed period  → reclass   : new entry dated today, original untouched
--
-- ── The guard that makes double-posting impossible ────────────────────────
--
-- The in-place UPDATE is scoped to the suspense leg by account, side AND exact
-- amount, and demands ROW_COUNT = 1. If the original entry no longer holds the
-- money in suspense — because it was re-coded directly in the ledger, voided,
-- or already cleared — zero rows update and the call is refused. The balance
-- check is the write itself, so it cannot drift from what is actually posted.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Record the clearing outcome independently of the reclass entry ──────
-- `reclass_journal_entry_id` keeps its exact meaning: a SEPARATE reclass entry
-- exists. Undo and the reversal chain rely on that to know what to delete, so
-- it must stay NULL when the clearing was done in place. Cleared-ness therefore
-- needs its own marker — it cannot be derived, because 183 lines on this tenant
-- carry a suspense_reason while never having been posted at all (unposted
-- batches), and would otherwise read as cleared.
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS suspense_cleared_at   timestamptz,
  ADD COLUMN IF NOT EXISTS suspense_cleared_mode text;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bsl_suspense_cleared_mode_chk') THEN
    ALTER TABLE public.bank_statement_lines
      ADD CONSTRAINT bsl_suspense_cleared_mode_chk
      CHECK (suspense_cleared_mode IS NULL OR suspense_cleared_mode IN ('in_place', 'reclass'));
  END IF;
END $mig$;

COMMENT ON COLUMN public.bank_statement_lines.suspense_cleared_at IS
  'When this suspense item was reclassified to its final account. NULL = never cleared.';
COMMENT ON COLUMN public.bank_statement_lines.suspense_cleared_mode IS
  'in_place = the original entry''s suspense leg was re-pointed; reclass = a separate reclassification entry was posted (closed period).';

-- Backfill the items already cleared the old way, so the Cleared counters and
-- any history read continue to report them.
UPDATE public.bank_statement_lines
   SET suspense_cleared_at   = COALESCE(reviewed_at, now()),
       suspense_cleared_mode = 'reclass'
 WHERE reclass_journal_entry_id IS NOT NULL
   AND suspense_cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bsl_suspense_cleared
  ON public.bank_statement_lines (tenant_id, suspense_cleared_at)
  WHERE suspense_cleared_at IS NOT NULL;

-- ── 2. Shared helper: is this date inside a closed fiscal period? ──────────
CREATE OR REPLACE FUNCTION public.fiscal_period_is_closed(p_tenant_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_periods fp
     WHERE fp.tenant_id = p_tenant_id
       AND fp.status    = 'closed'
       AND p_date BETWEEN fp.period_start AND fp.period_end
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.fiscal_period_is_closed(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_period_is_closed(uuid, date) TO authenticated;

-- ── 3. clear_suspense_lines ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION public.clear_suspense_lines(
  p_line_ids          UUID[],
  p_target_account_id UUID,
  p_note              TEXT DEFAULT NULL,
  -- When set, the engine LEARNS: this raw account_type variant is bound to the
  -- chosen account so the same text resolves automatically next import.
  p_teach_variant     TEXT DEFAULT NULL,
  -- Narration for the reclassified line itself; shows in the Description column
  -- of the ledger and the Journal Entries page.
  p_memo              TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_deposit_id  UUID;
  v_payment_id  UUID;
  v_suspense_id UUID;          -- resolved per line, by direction
  v_target      RECORD;
  v_line        RECORD;
  v_je          RECORD;
  v_je_id       UUID;
  v_entry_date  DATE;
  v_amount      NUMERIC(14,2);
  v_dr          NUMERIC(14,2);
  v_cr          NUMERIC(14,2);
  v_n           INTEGER;
  v_cleared     INTEGER := 0;
  v_in_place    INTEGER := 0;
  v_reclassed   INTEGER := 0;
  v_variant     TEXT;
  v_category    TEXT;
  v_side        TEXT;
  v_taught      BOOLEAN := false;
  v_memo        TEXT;
  v_note        TEXT;
  v_narration   TEXT;
  v_target_type TEXT;
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
  v_note := NULLIF(btrim(p_note), '');
  -- In place there is no entry header to append a note to, so the note falls
  -- back to the line narration when no explicit memo was given. It is recorded
  -- on the audit row either way.
  v_narration := COALESCE(v_memo, v_note);

  SELECT bank_import_unrecognized_deposit_account_id,
         bank_import_unrecognized_payment_account_id
    INTO v_deposit_id, v_payment_id
    FROM public.account_settings WHERE tenant_id = v_tenant_id;
  IF v_deposit_id IS NULL OR v_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUSPENSE_NOT_CONFIGURED';
  END IF;

  SELECT id, is_active, is_postable, account_type
    INTO v_target
    FROM public.accounts
   WHERE id = p_target_account_id AND tenant_id = v_tenant_id;
  IF v_target.id IS NULL OR NOT v_target.is_active OR NOT v_target.is_postable THEN
    RAISE EXCEPTION 'TARGET_ACCOUNT_UNPOSTABLE';
  END IF;
  IF p_target_account_id IN (v_deposit_id, v_payment_id) THEN
    RAISE EXCEPTION 'TARGET_IS_SUSPENSE: pick the final account, not an Unrecognized holding account';
  END IF;
  v_target_type := v_target.account_type;

  FOR v_line IN
    SELECT l.* FROM public.bank_statement_lines l
     WHERE l.id = ANY (p_line_ids) AND l.tenant_id = v_tenant_id
     FOR UPDATE
  LOOP
    IF NOT v_line.needs_reclassification OR v_line.suspense_cleared_at IS NOT NULL THEN
      RAISE EXCEPTION 'LINE_NOT_OPEN: line % is not an open suspense item', v_line.id;
    END IF;
    IF v_line.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'LINE_NOT_POSTED: line % has no suspense journal', v_line.id;
    END IF;

    -- The entry that parked the money must still be live. Clearing against a
    -- voided or unposted entry would credit suspense with nothing to reverse.
    SELECT id, entry_date, status, voided_at INTO v_je
      FROM public.journal_entries
     WHERE id = v_line.journal_entry_id AND tenant_id = v_tenant_id
     FOR UPDATE;
    IF v_je.id IS NULL OR v_je.status <> 'posted' OR v_je.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'SOURCE_ENTRY_NOT_POSTED: the import entry for line % is no longer posted', v_line.id;
    END IF;

    -- Direction decides which holding account the money went into, and which
    -- side of that account the leg sits on.
    IF v_line.debit > 0 THEN
      v_suspense_id := v_payment_id;                    -- money out: Dr suspense
      v_amount := round(v_line.debit, 2);
      v_dr := v_amount; v_cr := 0;
    ELSE
      v_suspense_id := v_deposit_id;                    -- money in: Cr suspense
      v_amount := round(v_line.credit, 2);
      v_dr := 0; v_cr := v_amount;
    END IF;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'LINE_HAS_NO_AMOUNT: line % carries no amount', v_line.id;
    END IF;

    IF NOT public.fiscal_period_is_closed(v_tenant_id, v_je.entry_date) THEN
      -- ── Open period: re-point the original suspense leg. No new entry. ──
      -- Scoped by account, side and exact amount, so it can only ever match
      -- the leg this line parked. ROW_COUNT = 1 IS the balance guard: if the
      -- entry no longer holds the money in suspense, nothing updates.
      UPDATE public.journal_lines
         SET account_id     = p_target_account_id,
             memo           = COALESCE(v_narration, memo),
             customer_id    = NULL,
             vendor_id      = NULL,
             item_id        = NULL,
             asset_id       = NULL,
             cost_center_id = NULL
       WHERE journal_entry_id = v_line.journal_entry_id
         AND account_id       = v_suspense_id
         AND debit            = v_dr
         AND credit           = v_cr;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION
          'LINE_NOT_IN_SUSPENSE: the import entry for line % no longer holds % in the suspense account (matched % legs) - it was re-coded in the ledger, or already cleared',
          v_line.id, v_amount, v_n;
      END IF;

      v_je_id      := v_line.journal_entry_id;
      v_in_place   := v_in_place + 1;
      v_entry_date := v_je.entry_date;

      UPDATE public.bank_statement_lines
         SET needs_reclassification = false,
             suspense_cleared_at    = now(),
             suspense_cleared_mode  = 'in_place',
             reviewed_by            = v_user_id,
             reviewed_at            = now()
       WHERE id = v_line.id;
    ELSE
      -- ── Closed period: never edit history. Post a dated reclassification. ──
      v_entry_date := CURRENT_DATE;
      IF public.fiscal_period_is_closed(v_tenant_id, v_entry_date) THEN
        RAISE EXCEPTION
          'CLOSED_PERIOD: line % sits in a closed period and today (%) is closed too - reopen a period to post the reclassification',
          v_line.id, v_entry_date;
      END IF;

      INSERT INTO public.journal_entries
        (tenant_id, entry_date, description, reference, status,
         source_type, source_id, unique_key, is_system_generated, created_by, posted_at)
      VALUES
        (v_tenant_id, v_entry_date,
         'Suspense reclass: ' || COALESCE(NULLIF(btrim(v_line.description), ''), NULLIF(btrim(v_line.name), ''), 'bank import line')
           || COALESCE(' - ' || v_note, ''),
         NULLIF(btrim(v_line.voucher_no), ''),
         'posted', 'bank_import_reclass', v_line.id,
         'bank_import_reclass:' || v_line.id::text,
         true, v_user_id, now())
      RETURNING id INTO v_je_id;

      IF v_line.debit > 0 THEN
        INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo) VALUES
          (v_je_id, p_target_account_id, v_amount, 0, v_memo),
          (v_je_id, v_suspense_id, 0, v_amount, NULL);
      ELSE
        INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo) VALUES
          (v_je_id, v_suspense_id, v_amount, 0, NULL),
          (v_je_id, p_target_account_id, 0, v_amount, v_memo);
      END IF;

      v_reclassed := v_reclassed + 1;

      UPDATE public.bank_statement_lines
         SET needs_reclassification  = false,
             reclass_journal_entry_id = v_je_id,
             suspense_cleared_at      = now(),
             suspense_cleared_mode    = 'reclass',
             reviewed_by              = v_user_id,
             reviewed_at              = now()
       WHERE id = v_line.id;
    END IF;

    -- Budget consumption is maintained by an AFTER INSERT trigger on
    -- journal_lines, which an in-place UPDATE never fires. Rebuild the month
    -- for the account the amount landed on whenever it is a P&L account.
    IF v_target_type IN ('Expense','Cost of Goods Sold','Other Expense','Income','Other Income') THEN
      PERFORM public.recalc_budget_consumption(
        v_tenant_id, p_target_account_id,
        public.derive_period(v_entry_date, 'monthly'),
        'monthly', NULL, NULL, NULL);
    END IF;

    v_cleared := v_cleared + 1;
  END LOOP;

  IF v_cleared = 0 THEN
    RAISE EXCEPTION 'NO_LINES: none of the given ids are suspense lines of this tenant';
  END IF;

  -- ── Teach the engine ────────────────────────────────────────────────────
  v_variant := public.bank_normalize_text(p_teach_variant);
  IF v_variant <> '' THEN
    SELECT canonical_category INTO v_category
      FROM public.bank_category_account_map
     WHERE tenant_id = v_tenant_id AND account_id = p_target_account_id AND is_active
     ORDER BY canonical_category LIMIT 1;

    IF v_category IS NULL THEN
      SELECT 'acct_' || a.account_code INTO v_category
        FROM public.accounts a WHERE a.id = p_target_account_id;
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
                             'cleared', v_cleared, 'in_place', v_in_place, 'reclassified', v_reclassed,
                             'note', v_note, 'memo', v_memo,
                             'taught_variant', v_variant, 'taught_category', v_category));

  RETURN jsonb_build_object('cleared', v_cleared, 'target_account_id', p_target_account_id,
                            'in_place', v_in_place, 'reclassified', v_reclassed,
                            'taught', v_taught, 'taught_category', v_category);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.clear_suspense_lines(UUID[], UUID, TEXT, TEXT, TEXT) IS
  'Reclassify suspense lines to a final account. Open period: re-points the original entry''s suspense leg in place (no new entry). Closed period: posts a dated reclassification entry instead. Refuses any line whose original entry no longer holds the amount in suspense.';

-- ── 4. split_suspense_line ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.split_suspense_line(UUID, JSONB, TEXT);

CREATE FUNCTION public.split_suspense_line(
  p_line_id     UUID,
  -- [{ "account_id": uuid, "amount": numeric, "memo": text|null }, …]
  p_allocations JSONB,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_deposit_id  UUID;
  v_payment_id  UUID;
  v_suspense_id UUID;
  v_line        RECORD;
  v_je          RECORD;
  v_je_id       UUID;
  v_entry_date  DATE;
  v_amount      NUMERIC(14,2);
  v_dr          NUMERIC(14,2);
  v_cr          NUMERIC(14,2);
  v_allocs      JSONB;
  v_total       NUMERIC(14,2);
  v_count       INTEGER;
  v_n           INTEGER;
  v_bad         UUID;
  v_mode        TEXT;
  v_note        TEXT;
  v_r           RECORD;
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

  v_note := NULLIF(btrim(p_note), '');

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
  IF NOT v_line.needs_reclassification OR v_line.suspense_cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_NOT_OPEN: line % is not an open suspense item', v_line.id;
  END IF;
  IF v_line.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'LINE_NOT_POSTED: line % has no suspense journal', v_line.id;
  END IF;

  SELECT id, entry_date, status, voided_at INTO v_je
    FROM public.journal_entries
   WHERE id = v_line.journal_entry_id AND tenant_id = v_tenant_id
   FOR UPDATE;
  IF v_je.id IS NULL OR v_je.status <> 'posted' OR v_je.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'SOURCE_ENTRY_NOT_POSTED: the import entry for line % is no longer posted', v_line.id;
  END IF;

  -- Same account twice is a user slip, not an error: merge the rows so the
  -- entry carries one leg per account. Every amount is rounded before it is
  -- summed, so what is validated is exactly what gets posted.
  SELECT jsonb_agg(jsonb_build_object('account_id', a.account_id, 'amount', a.amount, 'memo', a.memo)
                   ORDER BY a.amount DESC, a.account_id),
         COALESCE(SUM(a.amount), 0),
         COUNT(*)
    INTO v_allocs, v_total, v_count
    FROM (
      SELECT (x->>'account_id')::uuid                                       AS account_id,
             round(SUM(round(COALESCE((x->>'amount')::numeric, 0), 2)), 2)   AS amount,
             NULLIF(btrim(MAX(x->>'memo')), '')                             AS memo
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

  IF v_line.debit > 0 THEN
    v_suspense_id := v_payment_id;
    v_amount := round(v_line.debit, 2);
    v_dr := v_amount; v_cr := 0;
  ELSE
    v_suspense_id := v_deposit_id;
    v_amount := round(v_line.credit, 2);
    v_dr := 0; v_cr := v_amount;
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'LINE_HAS_NO_AMOUNT';
  END IF;
  -- A part-allocated line would be marked cleared with money still in Suspense,
  -- which is the one state this screen exists to prevent.
  IF v_total <> v_amount THEN
    RAISE EXCEPTION 'ALLOCATION_MISMATCH: allocations total % but the line is %', v_total, v_amount;
  END IF;

  IF NOT public.fiscal_period_is_closed(v_tenant_id, v_je.entry_date) THEN
    -- ── Open period: replace the single suspense leg with one leg per
    -- account, on the original entry. The bank leg still balances the entry.
    DELETE FROM public.journal_lines
     WHERE journal_entry_id = v_line.journal_entry_id
       AND account_id       = v_suspense_id
       AND debit            = v_dr
       AND credit           = v_cr;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION
        'LINE_NOT_IN_SUSPENSE: the import entry for line % no longer holds % in the suspense account (matched % legs) - it was re-coded in the ledger, or already cleared',
        v_line.id, v_amount, v_n;
    END IF;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    SELECT v_line.journal_entry_id, (x->>'account_id')::uuid,
           CASE WHEN v_line.debit > 0 THEN (x->>'amount')::numeric ELSE 0 END,
           CASE WHEN v_line.debit > 0 THEN 0 ELSE (x->>'amount')::numeric END,
           COALESCE(NULLIF(btrim(x->>'memo'), ''), v_note)
      FROM jsonb_array_elements(v_allocs) x;

    v_je_id      := v_line.journal_entry_id;
    v_mode       := 'in_place';
    v_entry_date := v_je.entry_date;

    UPDATE public.bank_statement_lines
       SET needs_reclassification = false,
           suspense_cleared_at    = now(),
           suspense_cleared_mode  = 'in_place',
           reviewed_by            = v_user_id,
           reviewed_at            = now()
     WHERE id = v_line.id;
  ELSE
    -- ── Closed period: post a dated reclassification, original untouched. ──
    v_entry_date := CURRENT_DATE;
    IF public.fiscal_period_is_closed(v_tenant_id, v_entry_date) THEN
      RAISE EXCEPTION
        'CLOSED_PERIOD: line % sits in a closed period and today (%) is closed too - reopen a period to post the reclassification',
        v_line.id, v_entry_date;
    END IF;

    INSERT INTO public.journal_entries
      (tenant_id, entry_date, description, reference, status,
       source_type, source_id, unique_key, is_system_generated, created_by, posted_at)
    VALUES
      (v_tenant_id, v_entry_date,
       'Suspense reclass (split ' || v_count || '): '
         || COALESCE(NULLIF(btrim(v_line.description), ''), NULLIF(btrim(v_line.name), ''), 'bank import line')
         || COALESCE(' - ' || v_note, ''),
       NULLIF(btrim(v_line.voucher_no), ''),
       'posted', 'bank_import_reclass', v_line.id,
       'bank_import_reclass:' || v_line.id::text,
       true, v_user_id, now())
    RETURNING id INTO v_je_id;

    IF v_line.debit > 0 THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_je_id, (x->>'account_id')::uuid, (x->>'amount')::numeric, 0, x->>'memo'
        FROM jsonb_array_elements(v_allocs) x;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_je_id, v_suspense_id, 0, v_amount);
    ELSE
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (v_je_id, v_suspense_id, v_amount, 0);
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_je_id, (x->>'account_id')::uuid, 0, (x->>'amount')::numeric, x->>'memo'
        FROM jsonb_array_elements(v_allocs) x;
    END IF;

    v_mode := 'reclass';

    UPDATE public.bank_statement_lines
       SET needs_reclassification   = false,
           reclass_journal_entry_id = v_je_id,
           suspense_cleared_at      = now(),
           suspense_cleared_mode    = 'reclass',
           reviewed_by              = v_user_id,
           reviewed_at              = now()
     WHERE id = v_line.id;
  END IF;

  -- Rebuild budget consumption for every P&L account the split touched.
  FOR v_r IN
    SELECT (x->>'account_id')::uuid AS account_id
      FROM jsonb_array_elements(v_allocs) x
  LOOP
    IF EXISTS (SELECT 1 FROM public.accounts a
                WHERE a.id = v_r.account_id
                  AND a.account_type IN ('Expense','Cost of Goods Sold','Other Expense','Income','Other Income')) THEN
      PERFORM public.recalc_budget_consumption(
        v_tenant_id, v_r.account_id,
        public.derive_period(v_entry_date, 'monthly'),
        'monthly', NULL, NULL, NULL);
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Suspense Line Split', 'bank_statement_lines', v_line.id,
          jsonb_build_object('line_id', v_line.id, 'journal_entry_id', v_je_id, 'mode', v_mode,
                             'amount', v_amount, 'allocations', v_allocs, 'note', v_note));

  RETURN jsonb_build_object('cleared', 1, 'splits', v_count, 'mode', v_mode,
                            'journal_entry_id', v_je_id, 'amount', v_amount);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.split_suspense_line(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_suspense_line(UUID, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.split_suspense_line(UUID, JSONB, TEXT) IS
  'Reclassify one suspense line across several final accounts. Open period: replaces the original entry''s suspense leg with one leg per account (no new entry). Closed period: posts a dated reclassification entry. Allocations must sum to the line amount exactly; duplicate accounts are merged.';

-- ── 5. Cash-flow mirror: key it to the clearing, not to the reclass entry ──
-- `transactions` powers the dashboard Cash Flow chart. It used to be rebuilt by
-- a trigger on reclass_journal_entry_id, which an in-place clearing never sets
-- — so a line cleared to an expense account would silently never reach the
-- chart. It now fires on suspense_cleared_at and reads whichever entry carries
-- the final coding: the reclass entry when there is one, otherwise the original.
CREATE OR REPLACE FUNCTION public.trg_bank_line_reclass_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_coding_je UUID := COALESCE(NEW.reclass_journal_entry_id, NEW.journal_entry_id);
BEGIN
  IF NEW.journal_entry_id IS NULL OR v_coding_je IS NULL THEN RETURN NEW; END IF;

  -- Keyed on the ORIGINAL entry either way, so the row this import produced is
  -- replaced rather than duplicated.
  DELETE FROM public.transactions
   WHERE source_type = 'journal_entry' AND source_id = NEW.journal_entry_id;

  INSERT INTO public.transactions
    (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
  SELECT je.tenant_id, je.entry_date,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN jl.debit ELSE jl.credit END,
         CASE WHEN a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') THEN 'expense' ELSE 'income' END,
         jl.account_id, a.account_type, je.description, 'journal_entry', NEW.journal_entry_id
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = v_coding_je
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE jl.journal_entry_id = v_coding_je
     AND je.status = 'posted'
     AND je.voided_at IS NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.bank_statement_batches bb
            WHERE bb.id = NEW.batch_id AND bb.bank_account_id = jl.account_id)
     AND ( (a.account_type IN ('Expense','Cost of Goods Sold','Other Expense') AND jl.debit > 0)
        OR (a.account_type IN ('Income','Other Income') AND jl.credit > 0) );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_bank_line_reclass_sync ON public.bank_statement_lines;
CREATE TRIGGER trg_bank_line_reclass_sync
  AFTER UPDATE OF suspense_cleared_at ON public.bank_statement_lines
  FOR EACH ROW
  WHEN (NEW.suspense_cleared_at IS NOT NULL AND OLD.suspense_cleared_at IS DISTINCT FROM NEW.suspense_cleared_at)
  EXECUTE FUNCTION public.trg_bank_line_reclass_sync();
