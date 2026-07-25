-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — auto-generated ledgers (Tier 4).
--
-- When a row has no category mapping and no rule, but its description is usable,
-- the engine now DERIVES a ledger account named from that description instead of
-- parking it in Suspense. Classification is fixed by cash direction — money out
-- → Expense, money in → Income — never inferred. Identical descriptions (after
-- cleaning) collapse onto one ledger, so a big statement yields a tidy set of
-- accounts, reused across imports.
--
-- This installs:
--   1. resolution_tier now allows 4 (auto-generated).
--   2. bank_import_derived_accounts — the idempotency store binding a cleaned
--      description key + direction to the account, robust to later renames.
--   3. get_or_create_derived_accounts() — service-role RPC the edge function
--      calls to resolve every Tier-4 line to a real account before posting.
--   4. import_bank_statement_post / verify_bank_import_batch updated so Tier 4
--      posts to its resolved account and reconciles like Tier 1/2.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Allow tier 4 ─────────────────────────────────────────────────────────
ALTER TABLE public.bank_statement_lines
  DROP CONSTRAINT IF EXISTS bank_statement_lines_resolution_tier_check;
ALTER TABLE public.bank_statement_lines
  ADD CONSTRAINT bank_statement_lines_resolution_tier_check
  CHECK (resolution_tier IN (1, 2, 3, 4));  -- 3 = suspense, 4 = auto-generated

-- ── 2. Idempotency store ────────────────────────────────────────────────────
-- derive_key is normalizeText(derived name); (tenant, derive_key, side) is the
-- stable identity of an auto-generated ledger. Keeping it here (rather than
-- matching on account_name) means a user can rename the account and re-imports
-- still find it instead of minting a duplicate.
CREATE TABLE IF NOT EXISTS public.bank_import_derived_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  derive_key  text NOT NULL,
  side        text NOT NULL CHECK (side IN ('debit', 'credit')),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, derive_key, side)
);

ALTER TABLE public.bank_import_derived_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_import_derived_accounts tenant read"
  ON public.bank_import_derived_accounts
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- ── 3. get_or_create_derived_accounts ───────────────────────────────────────
-- Resolves each {derive_key, name, side} to a postable account, creating it (and
-- its per-direction header) on first sight. Returns the mapping so the edge
-- function can stamp resolved_account_id on every Tier-4 line. Service-role only.
CREATE OR REPLACE FUNCTION public.get_or_create_derived_accounts(
  p_tenant_id      UUID,
  p_actor_user_id  UUID,
  p_items          JSONB          -- [{ derive_key, name, side }]
)
RETURNS TABLE (derive_key TEXT, side TEXT, account_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        JSONB;
  v_key         TEXT;
  v_name        TEXT;
  v_side        TEXT;
  v_acct        UUID;
  v_header      UUID;
  v_header_code TEXT;
  v_atype       TEXT;
  v_subtype     TEXT := 'Auto-Generated';
  v_nb          TEXT;
  v_code        TEXT;
  v_seq         INTEGER;
  v_exp_header  UUID;
  v_inc_header  UUID;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'TENANT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_user_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'ACTOR_NOT_IN_TENANT';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_key  := btrim(v_item->>'derive_key');
    v_name := btrim(v_item->>'name');
    v_side := v_item->>'side';
    CONTINUE WHEN v_key = '' OR v_name = '' OR v_side NOT IN ('debit', 'credit');

    -- Reuse the existing ledger for this key+direction when it is still usable.
    SELECT d.account_id INTO v_acct
      FROM public.bank_import_derived_accounts d
      JOIN public.accounts a ON a.id = d.account_id
     WHERE d.tenant_id = p_tenant_id AND d.derive_key = v_key AND d.side = v_side
       AND a.tenant_id = p_tenant_id AND a.is_active AND a.is_postable;

    IF v_acct IS NULL THEN
      -- Drop a stale mapping whose account was deleted / made unpostable.
      DELETE FROM public.bank_import_derived_accounts
       WHERE tenant_id = p_tenant_id AND derive_key = v_key AND side = v_side;

      -- Direction fixes classification and the parent header.
      IF v_side = 'debit' THEN
        v_atype := 'Expense'; v_nb := 'Debit';  v_header_code := '6900';
      ELSE
        v_atype := 'Income';  v_nb := 'Credit'; v_header_code := '4900';
      END IF;

      -- Per-direction header (created once). Identify by its marker subtype so
      -- a pre-existing account on code 6900/4900 is never hijacked.
      IF v_side = 'debit' THEN v_header := v_exp_header; ELSE v_header := v_inc_header; END IF;
      IF v_header IS NULL THEN
        SELECT id INTO v_header FROM public.accounts
         WHERE tenant_id = p_tenant_id AND account_type = v_atype
           AND account_subtype = v_subtype AND parent_account_id IS NULL
         LIMIT 1;
      END IF;
      IF v_header IS NULL THEN
        v_code := public.next_free_account_code(p_tenant_id, v_header_code);
        INSERT INTO public.accounts
          (tenant_id, account_code, account_name, account_type, account_subtype,
           parent_account_id, account_path, account_level, normal_balance,
           is_active, is_postable, is_control_account, is_system, requires_subledger)
        VALUES
          (p_tenant_id, v_code,
           CASE v_side WHEN 'debit' THEN 'Auto-Generated Expenses' ELSE 'Auto-Generated Income' END,
           v_atype, v_subtype, NULL, v_code, 1, v_nb,
           true, false, false, false, false)
        RETURNING id INTO v_header;
      END IF;
      IF v_side = 'debit' THEN v_exp_header := v_header; ELSE v_inc_header := v_header; END IF;

      -- Child ledger, coded beneath its header (6900001, 6900002, …).
      SELECT count(*) INTO v_seq FROM public.accounts
       WHERE tenant_id = p_tenant_id AND parent_account_id = v_header;
      LOOP
        v_seq := v_seq + 1;
        v_code := (SELECT account_code FROM public.accounts WHERE id = v_header) || lpad(v_seq::text, 4, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.accounts WHERE tenant_id = p_tenant_id AND account_code = v_code);
      END LOOP;

      INSERT INTO public.accounts
        (tenant_id, account_code, account_name, account_type, account_subtype,
         parent_account_id, account_path, account_level, normal_balance,
         is_active, is_postable, is_control_account, is_system, requires_subledger)
      VALUES
        (p_tenant_id, v_code, left(v_name, 120), v_atype, v_subtype,
         v_header, v_code, 2, v_nb, true, true, false, false, false)
      RETURNING id INTO v_acct;

      INSERT INTO public.bank_import_derived_accounts (tenant_id, derive_key, side, account_id, created_by)
      VALUES (p_tenant_id, v_key, v_side, v_acct, p_actor_user_id)
      ON CONFLICT (tenant_id, derive_key, side) DO UPDATE SET account_id = EXCLUDED.account_id;
    END IF;

    derive_key := v_key; side := v_side; account_id := v_acct;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_derived_accounts(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- Smallest unused account_code at or after a numeric base, per tenant.
CREATE OR REPLACE FUNCTION public.next_free_account_code(p_tenant_id UUID, p_base TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE v_n BIGINT := p_base::bigint; v_code TEXT;
BEGIN
  LOOP
    v_code := v_n::text;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.accounts WHERE tenant_id = p_tenant_id AND account_code = v_code);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ── 4a. Posting RPC — Tier 4 posts to its resolved account like Tier 1/2 ─────
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
  v_deposit_id  UUID;
  v_payment_id  UUID;
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

  SELECT count(*) INTO v_n FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded
     AND l.block_reason IS NULL AND l.resolution_tier IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'UNRESOLVED_LINES: % line(s) have no resolution recorded', v_n;
  END IF;
  -- Tier 1/2/4 all resolve to a concrete account.
  SELECT count(*) INTO v_n FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND NOT l.is_excluded AND l.block_reason IS NULL
     AND l.resolution_tier IN (1, 2, 4) AND l.resolved_account_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'RESOLVED_WITHOUT_ACCOUNT: % line(s) marked resolved but missing an account', v_n;
  END IF;

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

  SELECT count(*) INTO v_n FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.tenant_id <> v_batch.tenant_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CROSS_TENANT_LINE: % line(s) do not belong to the batch tenant', v_n;
  END IF;

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

  PERFORM set_config('app.bank_import_bulk', '1', true);

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

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT l.journal_entry_id, v_batch.bank_account_id,
         CASE WHEN l.credit > 0 THEN round(l.credit, 2) ELSE 0 END,
         CASE WHEN l.debit  > 0 THEN round(l.debit, 2)  ELSE 0 END
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;

  -- Counter side: mapped OR auto-generated account for tier 1/2/4; for tier 3
  -- the directional suspense account.
  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
  SELECT l.journal_entry_id,
         CASE WHEN l.resolution_tier IN (1, 2, 4) THEN l.resolved_account_id
              WHEN l.debit > 0                    THEN v_payment_id
              ELSE                                     v_deposit_id END,
         CASE WHEN l.debit  > 0 THEN round(l.debit, 2)  ELSE 0 END,
         CASE WHEN l.credit > 0 THEN round(l.credit, 2) ELSE 0 END
    FROM public.bank_statement_lines l
   WHERE l.batch_id = p_batch_id AND l.journal_entry_id IS NOT NULL;

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

  SELECT COALESCE(sum(jl.debit), 0), COALESCE(sum(jl.credit), 0)
    INTO v_sum_debit, v_sum_credit
    FROM public.journal_lines jl
    JOIN public.bank_statement_lines l ON l.journal_entry_id = jl.journal_entry_id
   WHERE l.batch_id = p_batch_id;
  IF v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'BATCH_NOT_BALANCED: total debits % <> total credits %', v_sum_debit, v_sum_credit;
  END IF;

  SELECT jsonb_build_object(
      'je_status', v_je_status,
      'posted_to_ledger_count',   count(*) FILTER (WHERE l.resolution_tier IN (1, 2)),
      'posted_to_ledger_value',   COALESCE(sum(l.debit + l.credit) FILTER (WHERE l.resolution_tier IN (1, 2)), 0),
      'posted_to_generated_count', count(*) FILTER (WHERE l.resolution_tier = 4),
      'posted_to_generated_value', COALESCE(sum(l.debit + l.credit) FILTER (WHERE l.resolution_tier = 4), 0),
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

REVOKE EXECUTE ON FUNCTION public.import_bank_statement_post(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 4b. Verification RPC — counts Tier 4 as posted-to-ledger ─────────────────
CREATE OR REPLACE FUNCTION public.verify_bank_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id   UUID;
  v_batch       public.bank_statement_batches;
  v_lines       INTEGER;   v_postable  INTEGER;
  v_excluded    INTEGER;   v_blocked   INTEGER;
  v_suspense    INTEGER;   v_ledger    INTEGER;
  v_generated   INTEGER;
  v_je          INTEGER;   v_jl        INTEGER;
  v_sum_dr      NUMERIC;   v_sum_cr    NUMERIC;
  v_line_dr     NUMERIC;   v_line_cr   NUMERIC;
  v_tx          INTEGER;
  v_missing_je  INTEGER;
  v_posted      INTEGER;   -- ledger + generated + suspense (all JE-backed lines)
  v_checks      JSONB := '[]'::jsonb;
  v_ok          BOOLEAN := true;
  c1 BOOLEAN; c2 BOOLEAN; c3 BOOLEAN; c4 BOOLEAN; c5 BOOLEAN; c6 BOOLEAN; c7 BOOLEAN;
BEGIN
  SELECT u.tenant_id INTO v_tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_batch FROM public.bank_statement_batches
   WHERE id = p_batch_id AND tenant_id = v_tenant_id;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NOT is_excluded AND block_reason IS NULL),
         count(*) FILTER (WHERE is_excluded),
         count(*) FILTER (WHERE block_reason IS NOT NULL),
         count(*) FILTER (WHERE resolution_tier = 3),
         count(*) FILTER (WHERE resolution_tier IN (1, 2)),
         count(*) FILTER (WHERE resolution_tier = 4),
         count(*) FILTER (WHERE NOT is_excluded AND block_reason IS NULL AND journal_entry_id IS NULL)
    INTO v_lines, v_postable, v_excluded, v_blocked, v_suspense, v_ledger, v_generated, v_missing_je
    FROM public.bank_statement_lines WHERE batch_id = p_batch_id;

  v_posted := v_ledger + v_generated + v_suspense;

  SELECT count(DISTINCT je.id), count(jl.*),
         COALESCE(sum(jl.debit), 0), COALESCE(sum(jl.credit), 0)
    INTO v_je, v_jl, v_sum_dr, v_sum_cr
    FROM public.bank_statement_lines l
    JOIN public.journal_entries je ON je.id = l.journal_entry_id
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
   WHERE l.batch_id = p_batch_id;

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO v_line_dr, v_line_cr
    FROM public.bank_statement_lines
   WHERE batch_id = p_batch_id AND NOT is_excluded AND block_reason IS NULL;

  SELECT count(*) INTO v_tx FROM public.transactions
   WHERE source_type = 'journal_entry'
     AND source_id IN (SELECT journal_entry_id FROM public.bank_statement_lines
                        WHERE batch_id = p_batch_id AND journal_entry_id IS NOT NULL);

  c1 := v_batch.status = 'posted';
  c2 := v_lines = v_batch.row_count + v_excluded;
  c3 := v_missing_je = 0;
  c4 := v_je = v_posted OR v_batch.status <> 'posted';
  c5 := v_sum_dr = v_sum_cr;
  c6 := round(v_sum_dr, 2) = round(v_line_dr + v_line_cr, 2);
  c7 := v_tx > 0 OR v_posted = 0 OR v_batch.posting_mode = 'draft';
  v_ok := c1 AND c2 AND c3 AND c4 AND c5 AND c6 AND c7;

  v_checks := jsonb_build_array(
    jsonb_build_object('name', 'Batch posted', 'ok', c1,
      'detail', 'status = ' || v_batch.status),
    jsonb_build_object('name', 'All rows stored', 'ok', c2,
      'detail', v_lines || ' line(s) in database, expected ' || (v_batch.row_count + v_excluded)),
    jsonb_build_object('name', 'Every postable line has a journal entry', 'ok', c3,
      'detail', CASE WHEN v_missing_je = 0 THEN 'all ' || v_postable || ' postable line(s) posted'
                     ELSE v_missing_je || ' line(s) missing a journal entry' END),
    jsonb_build_object('name', 'Journal entries recorded', 'ok', c4,
      'detail', v_je || ' journal entr(ies) for ' || v_posted || ' postable line(s)'),
    jsonb_build_object('name', 'Entries balance (Dr = Cr)', 'ok', c5,
      'detail', 'debits ' || to_char(v_sum_dr, 'FM999,999,999.00') || ' = credits ' || to_char(v_sum_cr, 'FM999,999,999.00')),
    jsonb_build_object('name', 'Posted value reconciles to the statement', 'ok', c6,
      'detail', 'posted ' || to_char(v_sum_dr, 'FM999,999,999.00') || ' vs statement ' || to_char(v_line_dr + v_line_cr, 'FM999,999,999.00')),
    jsonb_build_object('name', 'Cash-flow rows synced', 'ok', c7,
      'detail', v_tx || ' cash-flow row(s) recorded')
  );

  RETURN jsonb_build_object(
    'ok', v_ok,
    'batch_id', p_batch_id,
    'status', v_batch.status,
    'counts', jsonb_build_object(
      'rows_expected', v_batch.row_count,
      'lines_in_db', v_lines,
      'excluded', v_excluded,
      'blocked', v_blocked,
      'posted_to_ledger', v_ledger,
      'posted_to_generated', v_generated,
      'posted_to_suspense', v_suspense,
      'journal_entries', v_je,
      'journal_lines', v_jl,
      'transactions', v_tx),
    'totals', jsonb_build_object(
      'debit', v_sum_dr, 'credit', v_sum_cr, 'balanced', v_sum_dr = v_sum_cr),
    'checks', v_checks,
    'verified_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_bank_import_batch(UUID) TO authenticated;
