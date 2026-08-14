-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — two defects found on a real 271-row book
--
-- 1. "31/05/204" — a missing digit in the sheet — parsed happily as the year
--    204 and posted as 0204-05-31. A date two millennia out is not a date; it
--    also slips past every fiscal-period check, which is precisely the failure
--    the module is supposed to refuse. An implausible year now blocks the row.
--
-- 2. A grand-total row was correctly blocked as unreadable, the user picked an
--    account for it in the UI, and the line went to status 'ok' with its date
--    still null — because the manual-override hook declared the row valid
--    rather than re-checking it. Posting then tried to write a null entry_date.
--    The hook is fixed separately; this adds the guard that should have caught
--    it: a line claiming to be ready must actually carry a date, an amount, a
--    direction and an account, checked before anything is written.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_petty_cash_import_lines(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tenant        UUID := get_user_tenant_id();
  v_fund          UUID;
  v_fund_gl       UUID;
  v_fund_active   BOOLEAN;
  v_orientation   TEXT;
  v_amount_mode   TEXT;
  v_status        TEXT;
  v_suspense      UUID;
  v_result        JSONB;
BEGIN
  SELECT b.petty_cash_account_id, b.amount_orientation, b.amount_mode, b.status,
         pca.account_id, pca.is_active
    INTO v_fund, v_orientation, v_amount_mode, v_status, v_fund_gl, v_fund_active
  FROM petty_cash_import_batches b
  JOIN petty_cash_accounts pca ON pca.id = b.petty_cash_account_id
  WHERE b.id = p_batch_id
    AND b.tenant_id = v_tenant;

  IF v_fund IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % not found for this tenant', p_batch_id;
  END IF;

  IF v_status NOT IN ('draft', 'resolved', 'failed') THEN
    RAISE EXCEPTION 'BATCH_NOT_RESOLVABLE: batch is % — only a draft, resolved or failed batch can be resolved', v_status;
  END IF;

  SELECT suspense_account_id INTO v_suspense
  FROM account_settings WHERE tenant_id = v_tenant;

  UPDATE petty_cash_import_lines
  SET status              = 'pending',
      error_code          = NULL,
      error_message       = NULL,
      resolved_account_id = CASE WHEN resolution_tier = 'manual' THEN resolved_account_id END,
      resolution_tier     = CASE WHEN resolution_tier = 'manual' THEN 'manual' END,
      resolution_key      = CASE WHEN resolution_tier = 'manual' THEN resolution_key END,
      is_duplicate        = false,
      duplicate_of        = NULL,
      amount              = NULL,
      direction           = NULL
  WHERE batch_id = p_batch_id
    AND tenant_id = v_tenant
    AND status NOT IN ('posted', 'excluded');

  -- ═══ Phase A — structural validation (blocking) ═══
  -- MATERIALIZED is load-bearing. fn_parse_import_amount is plpgsql and is
  -- called three times per row here; inlined, the planner re-evaluates those
  -- calls once per CASE branch that references them, which turned a ~2 s
  -- resolve into ~72 s when the branch count grew. Materialising evaluates
  -- each row exactly once.
  WITH parsed AS MATERIALIZED (
    SELECT l.id,
           l.parsed_date,
           fn_parse_import_amount(l.raw_debit)  AS d,
           fn_parse_import_amount(l.raw_credit) AS c,
           fn_parse_import_amount(l.raw_amount) AS amt,
           btrim(coalesce(l.raw_debit, ''))  <> '' AS has_debit_text,
           btrim(coalesce(l.raw_credit, '')) <> '' AS has_credit_text,
           btrim(coalesce(l.raw_amount, '')) <> '' AS has_amount_text
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant AND l.status = 'pending'
  ), verdict AS MATERIALIZED (
    SELECT p.id,
           CASE
             WHEN p.parsed_date IS NULL THEN 'DATE_UNPARSEABLE'
             -- "31/05/204" parses as the year 204. A four-digit typo silently
             -- books the row two millennia away and quietly escapes every
             -- period lock, so treat an implausible year as unreadable.
             WHEN extract(year FROM p.parsed_date) < 1900
               OR extract(year FROM p.parsed_date) > 2200 THEN 'DATE_OUT_OF_RANGE'
             -- Two-column sheets: direction comes from which side is filled.
             WHEN v_amount_mode = 'debit_credit' AND
                  p.d IS NOT NULL AND p.c IS NOT NULL AND p.d <> 0 AND p.c <> 0 THEN 'AMOUNT_BOTH_SIDES'
             WHEN v_amount_mode = 'debit_credit' AND
                  p.d IS NOT NULL AND p.c IS NOT NULL AND p.d = 0 AND p.c = 0 THEN 'AMOUNT_MISSING'
             WHEN v_amount_mode = 'debit_credit' AND
                  (coalesce(p.d, 0) < 0 OR coalesce(p.c, 0) < 0) THEN 'AMOUNT_NEGATIVE'
             WHEN v_amount_mode = 'debit_credit' AND
                  ((p.has_debit_text AND p.d IS NULL) OR (p.has_credit_text AND p.c IS NULL))
               THEN 'AMOUNT_NOT_NUMERIC'
             -- One-column sheets.
             WHEN v_amount_mode <> 'debit_credit' AND p.has_amount_text AND p.amt IS NULL
               THEN 'AMOUNT_NOT_NUMERIC'
             WHEN v_amount_mode <> 'debit_credit' AND coalesce(p.amt, 0) = 0 THEN 'AMOUNT_MISSING'
             -- A book declared "every row is a payment" that then carries a
             -- negative is saying something we do not understand. Block rather
             -- than silently reverse the direction of cash.
             WHEN v_amount_mode IN ('single_out', 'single_in') AND p.amt < 0 THEN 'AMOUNT_NEGATIVE'
             WHEN NOT v_fund_active THEN 'FUND_INACTIVE'
             WHEN EXISTS (
               SELECT 1 FROM fiscal_periods fp
               WHERE fp.tenant_id = v_tenant
                 AND fp.status = 'closed'
                 AND p.parsed_date BETWEEN fp.period_start AND fp.period_end
             ) THEN 'PERIOD_LOCKED'
           END AS code,
           p.d, p.c, p.amt
    FROM parsed p
  )
  UPDATE petty_cash_import_lines l
  SET status        = CASE WHEN v.code IS NULL THEN 'pending' ELSE 'blocked' END,
      error_code    = v.code,
      error_message = CASE v.code
        WHEN 'DATE_UNPARSEABLE'   THEN 'The date cell could not be read as a date. Correct it in the sheet, or exclude this row.'
        WHEN 'DATE_OUT_OF_RANGE'  THEN 'That date reads as the year ' || extract(year FROM l.parsed_date)::TEXT || ', which is almost certainly a typo in the sheet. Correct it and re-upload, or exclude this row.'
        WHEN 'AMOUNT_BOTH_SIDES'  THEN 'Both Debit and Credit carry a value. A petty cash row is either money out or money in, never both.'
        WHEN 'AMOUNT_MISSING'     THEN 'This row has no amount.'
        WHEN 'AMOUNT_NEGATIVE'    THEN 'This sheet states every row is a payment, but this amount is negative. Correct it, or re-import the file with a signed Amount column if negatives really mean money coming in.'
        WHEN 'AMOUNT_NOT_NUMERIC' THEN 'The amount cell is not a number.'
        WHEN 'FUND_INACTIVE'      THEN 'The petty cash fund this batch targets is inactive. Reactivate it, or import into another fund.'
        WHEN 'PERIOD_LOCKED'      THEN 'The date falls in a closed fiscal period. Reopen the period or change the date.'
      END,
      direction = CASE
        WHEN v.code IS NOT NULL THEN NULL
        WHEN v_amount_mode = 'single_out' THEN 'out'
        WHEN v_amount_mode = 'single_in'  THEN 'in'
        WHEN v_amount_mode = 'single_signed' THEN CASE WHEN v.amt > 0 THEN 'out' ELSE 'in' END
        WHEN v_orientation = 'contra' THEN CASE WHEN coalesce(v.d, 0) > 0 THEN 'out' ELSE 'in'  END
        ELSE                              CASE WHEN coalesce(v.d, 0) > 0 THEN 'in'  ELSE 'out' END
      END,
      amount = CASE
        WHEN v.code IS NOT NULL THEN NULL
        WHEN v_amount_mode <> 'debit_credit' THEN abs(v.amt)
        WHEN coalesce(v.d, 0) > 0 THEN v.d
        ELSE v.c
      END
  FROM verdict v
  WHERE l.id = v.id AND l.tenant_id = v_tenant;

  -- ═══ Phase B — resolution ladder ═══
  UPDATE petty_cash_import_lines l
  SET resolved_account_id = m.account_id,
      resolution_tier     = 'account_type_map',
      resolution_key      = m.match_key
  FROM petty_cash_account_map m
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status = 'pending' AND l.resolved_account_id IS NULL
    AND m.tenant_id = v_tenant AND m.match_type = 'account_type'
    AND m.match_key = fn_normalize_import_key(l.raw_account_type);

  WITH pending_keys AS (
    SELECT DISTINCT fn_normalize_import_key(l.raw_account_type) AS k
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status = 'pending' AND l.resolved_account_id IS NULL
      AND fn_normalize_import_key(l.raw_account_type) IS NOT NULL
  ), candidates AS (
    SELECT pk.k,
           count(*)                                        AS n,
           (array_agg(a.id ORDER BY a.account_code))[1]    AS account_id,
           string_agg(a.account_code, ', ' ORDER BY a.account_code) AS codes
    FROM pending_keys pk
    JOIN accounts a
      ON a.tenant_id = v_tenant AND a.is_active AND a.is_postable
     AND fn_normalize_import_key(a.account_name) = pk.k
    GROUP BY pk.k
  )
  UPDATE petty_cash_import_lines l
  SET resolved_account_id = CASE WHEN c.n = 1 THEN c.account_id END,
      resolution_tier     = CASE WHEN c.n = 1 THEN 'account_name' END,
      resolution_key      = CASE WHEN c.n = 1 THEN c.k END,
      status              = CASE WHEN c.n = 1 THEN 'pending' ELSE 'blocked' END,
      error_code          = CASE WHEN c.n > 1 THEN 'AMBIGUOUS_ACCOUNT_NAME' END,
      error_message       = CASE WHEN c.n > 1 THEN
        'Account type "' || coalesce(l.raw_account_type, '') || '" matches ' || c.n ||
        ' accounts by name (' || c.codes || '). Pick one on this row, or map it under Suspense Clearing.' END
  FROM candidates c
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status = 'pending' AND l.resolved_account_id IS NULL
    AND fn_normalize_import_key(l.raw_account_type) = c.k;

  UPDATE petty_cash_import_lines l
  SET resolved_account_id = a.id,
      resolution_tier     = 'account_code',
      resolution_key      = a.account_code
  FROM accounts a
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status = 'pending' AND l.resolved_account_id IS NULL
    AND a.tenant_id = v_tenant
    AND a.account_code = btrim(coalesce(l.raw_account_type, ''))
    AND btrim(coalesce(l.raw_account_type, '')) <> '';

  UPDATE petty_cash_import_lines l
  SET resolved_account_id = m.account_id,
      resolution_tier     = 'description_map',
      resolution_key      = m.match_key
  FROM petty_cash_account_map m
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status = 'pending' AND l.resolved_account_id IS NULL
    AND m.tenant_id = v_tenant AND m.match_type = 'description'
    AND m.match_key = fn_normalize_import_key(l.raw_description);

  UPDATE petty_cash_import_lines l
  SET resolved_account_id = CASE WHEN v_suspense IS NOT NULL THEN v_suspense END,
      resolution_tier     = CASE WHEN v_suspense IS NOT NULL THEN 'suspense' END,
      resolution_key      = CASE WHEN v_suspense IS NOT NULL
                                 THEN fn_normalize_import_key(l.raw_account_type) END,
      status              = CASE WHEN v_suspense IS NOT NULL THEN 'pending' ELSE 'blocked' END,
      error_code          = CASE WHEN v_suspense IS NULL THEN 'SUSPENSE_NOT_CONFIGURED' END,
      error_message       = CASE WHEN v_suspense IS NULL THEN
        'No suspense account is configured, so unmatched rows have nowhere to go. Set one under Settings → Account Mapping.' END
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status = 'pending' AND l.resolved_account_id IS NULL;

  -- ═══ Phase C — account-level validation (blocking) ═══
  -- MATERIALIZED here is a correctness-of-plan matter, not a style choice.
  -- Inlined, this becomes a self-join of petty_cash_import_lines on id, and
  -- because the tenant/RLS predicates make the planner estimate one row per
  -- side it picks a nested loop: 2,000 x 1,000 = 2M comparisons, 34 s for a
  -- 2,000-row batch. Materialising gives the CTE a real row count and the
  -- join becomes a hash join. Phase A was only ever fast because its CTEs
  -- happened to be materialised already.
  WITH checked AS MATERIALIZED (
    SELECT l.id,
           CASE
             WHEN a.id IS NULL THEN 'ACCOUNT_NOT_FOUND'
             WHEN a.id = v_fund_gl THEN 'SAME_ACCOUNT_VIOLATION'
             WHEN EXISTS (
               SELECT 1 FROM petty_cash_accounts pca
               WHERE pca.tenant_id = v_tenant AND pca.account_id = a.id
             ) THEN 'PETTY_CASH_GL_TARGET'
             WHEN NOT a.is_postable THEN 'ACCOUNT_NOT_POSTABLE'
             WHEN NOT a.is_active THEN 'ACCOUNT_INACTIVE'
             WHEN l.direction = 'out'
              AND a.account_type NOT IN ('Asset', 'Expense', 'Other Expense', 'Cost of Goods Sold')
               THEN 'INVALID_ACCOUNT_TYPE_OUT'
             WHEN l.direction = 'in'
              AND a.account_type NOT IN ('Asset', 'Liability', 'Income', 'Other Income', 'Equity')
               THEN 'INVALID_ACCOUNT_TYPE_IN'
           END AS code,
           a.account_code, a.account_name, a.account_type
    FROM petty_cash_import_lines l
    LEFT JOIN accounts a ON a.id = l.resolved_account_id AND a.tenant_id = v_tenant
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status = 'pending' AND l.resolved_account_id IS NOT NULL
  )
  UPDATE petty_cash_import_lines l
  SET status        = 'blocked',
      error_code    = ch.code,
      error_message = CASE ch.code
        WHEN 'ACCOUNT_NOT_FOUND'        THEN 'The selected account does not exist for this tenant.'
        WHEN 'SAME_ACCOUNT_VIOLATION'   THEN 'This resolves to the GL account behind the fund itself, which would debit and credit the same account.'
        WHEN 'PETTY_CASH_GL_TARGET'     THEN 'Account ' || ch.account_code || ' is registered as a petty cash fund and cannot be the contra side of a petty cash movement.'
        WHEN 'ACCOUNT_NOT_POSTABLE'     THEN 'Account ' || ch.account_code || ' (' || ch.account_name || ') is a header account and cannot be posted to. Pick one of its children.'
        WHEN 'ACCOUNT_INACTIVE'         THEN 'Account ' || ch.account_code || ' (' || ch.account_name || ') is inactive.'
        WHEN 'INVALID_ACCOUNT_TYPE_OUT' THEN 'Money out of the fund must post to an Asset, Expense, Other Expense or Cost of Goods Sold account. ' || ch.account_code || ' is ' || ch.account_type || '.'
        WHEN 'INVALID_ACCOUNT_TYPE_IN'  THEN 'Money into the fund must post to an Asset, Liability, Income, Other Income or Equity account. ' || ch.account_code || ' is ' || ch.account_type || '.'
      END
  FROM checked ch
  WHERE l.id = ch.id AND l.tenant_id = v_tenant AND ch.code IS NOT NULL;

  -- ═══ Phase D — duplicate flagging (non-blocking) ═══
  WITH keyed AS MATERIALIZED (
    SELECT l.id, l.row_no,
           first_value(l.id) OVER w AS first_id,
           row_number()      OVER w AS rn
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('pending', 'blocked')
      AND l.amount IS NOT NULL AND l.direction IS NOT NULL
    WINDOW w AS (
      PARTITION BY l.parsed_date,
                   coalesce(fn_normalize_import_key(l.raw_voucher_no), ''),
                   coalesce(fn_normalize_import_key(l.raw_description), ''),
                   l.amount, l.direction
      ORDER BY l.row_no
    )
  )
  UPDATE petty_cash_import_lines l
  SET is_duplicate = true, duplicate_of = k.first_id
  FROM keyed k
  WHERE l.id = k.id AND l.tenant_id = v_tenant AND k.rn > 1;

  UPDATE petty_cash_import_lines l
  SET is_duplicate = true, duplicate_of = prior.id
  FROM (
    SELECT DISTINCT ON (pl.parsed_date, ck, dk, pl.amount, pl.direction)
           pl.id, pl.parsed_date, pl.amount, pl.direction,
           coalesce(fn_normalize_import_key(pl.raw_voucher_no), '')   AS ck,
           coalesce(fn_normalize_import_key(pl.raw_description), '') AS dk
    FROM petty_cash_import_lines pl
    JOIN petty_cash_import_batches pb ON pb.id = pl.batch_id
    WHERE pl.tenant_id = v_tenant AND pb.tenant_id = v_tenant
      AND pb.petty_cash_account_id = v_fund
      AND pb.id <> p_batch_id AND pb.status = 'posted' AND pl.status = 'posted'
    ORDER BY pl.parsed_date, ck, dk, pl.amount, pl.direction, pl.row_no
  ) prior
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.is_duplicate = false AND l.status IN ('pending', 'blocked')
    AND l.parsed_date = prior.parsed_date
    AND l.amount = prior.amount
    AND l.direction = prior.direction
    AND coalesce(fn_normalize_import_key(l.raw_voucher_no), '')   = prior.ck
    AND coalesce(fn_normalize_import_key(l.raw_description), '') = prior.dk;

  -- ═══ Phase E — final statuses ═══
  UPDATE petty_cash_import_lines l
  SET status = CASE WHEN l.resolution_tier = 'suspense' THEN 'suspense' ELSE 'ok' END
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant AND l.status = 'pending';

  UPDATE petty_cash_import_batches
  SET status = 'resolved', resolved_at = now()
  WHERE id = p_batch_id AND tenant_id = v_tenant;

  SELECT jsonb_build_object(
           'batch_id',   p_batch_id,
           'total',      count(*),
           'ok',         count(*) FILTER (WHERE status = 'ok'),
           'suspense',   count(*) FILTER (WHERE status = 'suspense'),
           'blocked',    count(*) FILTER (WHERE status = 'blocked'),
           'excluded',   count(*) FILTER (WHERE status = 'excluded'),
           'posted',     count(*) FILTER (WHERE status = 'posted'),
           'duplicates', count(*) FILTER (WHERE is_duplicate),
           'blocked_by_code', coalesce((
             SELECT jsonb_object_agg(error_code, n)
             FROM (SELECT error_code, count(*) AS n
                   FROM petty_cash_import_lines
                   WHERE batch_id = p_batch_id AND tenant_id = v_tenant
                     AND status = 'blocked' AND error_code IS NOT NULL
                   GROUP BY error_code) c
           ), '{}'::jsonb),
           'unmapped_account_types', coalesce((
             SELECT jsonb_agg(DISTINCT resolution_key)
             FROM petty_cash_import_lines
             WHERE batch_id = p_batch_id AND tenant_id = v_tenant
               AND status = 'suspense' AND resolution_key IS NOT NULL
           ), '[]'::jsonb)
         )
    INTO v_result
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_petty_cash_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID := get_user_tenant_id();
  v_tenant       UUID;
  v_fund         UUID;
  v_gl           UUID;
  v_status       TEXT;
  v_allow_neg    BOOLEAN;
  v_grouping     TEXT;
  v_user         UUID;
  v_blocked      INTEGER;
  v_incomplete   INTEGER;
  v_opening      NUMERIC(14,2);
  v_total_out    NUMERIC(14,2);
  v_total_in     NUMERIC(14,2);
  v_excluded     INTEGER;
  v_bad          RECORD;
  v_lowest       NUMERIC(14,2);
  v_yr           RECORD;
  v_start        INTEGER;
  v_vouchers     INTEGER := 0;
  v_receipts     INTEGER := 0;
  v_lines        INTEGER := 0;
BEGIN
  SELECT b.tenant_id, b.petty_cash_account_id, b.status, b.allow_negative_balance,
         b.grouping_mode, pca.account_id
    INTO v_tenant, v_fund, v_status, v_allow_neg, v_grouping, v_gl
  FROM petty_cash_import_batches b
  JOIN petty_cash_accounts pca ON pca.id = b.petty_cash_account_id
  WHERE b.id = p_batch_id
  FOR UPDATE OF b;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: import batch % does not exist', p_batch_id;
  END IF;
  IF v_tenant <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: import batch % belongs to another tenant', p_batch_id;
  END IF;
  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'BATCH_NOT_RESOLVED: batch is % — resolve it first, and post only once', v_status;
  END IF;

  SELECT count(*) INTO v_blocked
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'blocked';
  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'BLOCKED_LINES: % line(s) must be corrected, excluded, or the batch discarded before posting', v_blocked;
  END IF;

  -- A line marked ready must actually BE ready. The UI once let a manual
  -- account choice clear a block without fixing the underlying problem, which
  -- sent a row with no date into journal_entries and failed on the not-null
  -- constraint half way through posting. Fail here instead, before anything
  -- is written, and say what to do about it.
  SELECT count(*) INTO v_incomplete
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant
    AND status IN ('ok', 'suspense')
    AND (parsed_date IS NULL OR amount IS NULL OR direction IS NULL
         OR resolved_account_id IS NULL);

  IF v_incomplete > 0 THEN
    RAISE EXCEPTION
      'INCOMPLETE_LINES: % line(s) are marked ready but have no usable date, amount, direction or account. Re-resolve the batch to re-check them.',
      v_incomplete;
  END IF;

  SELECT count(*) INTO v_excluded
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'excluded';

  SELECT id INTO v_user FROM users WHERE auth_user_id = auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NO_USER: no application user for the current session';
  END IF;

  PERFORM set_config('app.pc_import_bulk', '1', true);
  v_opening := get_petty_cash_balance(v_fund);

  SELECT s.row_no, s.parsed_date, s.running INTO v_bad
  FROM (
    SELECT l.row_no, l.parsed_date,
           v_opening + sum(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END)
             OVER (ORDER BY l.parsed_date, l.row_no ROWS UNBOUNDED PRECEDING) AS running
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
  ) s
  WHERE s.running < 0
  ORDER BY s.parsed_date, s.row_no
  LIMIT 1;

  IF FOUND AND NOT v_allow_neg THEN
    RAISE EXCEPTION
      'INSUFFICIENT_FUND: row % (%) overdraws the fund by %. Opening balance is %. Post the opening float first, or allow this batch to go negative if the float predates the system.',
      v_bad.row_no, v_bad.parsed_date, abs(v_bad.running), v_opening;
  END IF;

  SELECT min(s.running) INTO v_lowest
  FROM (
    SELECT v_opening + sum(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END)
             OVER (ORDER BY l.parsed_date, l.row_no ROWS UNBOUNDED PRECEDING) AS running
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
  ) s;

  -- ── Groups, materialised once ──────────────────────────────────────────
  -- grp is the whole grouping rule: the paper voucher, or the row itself.
  CREATE TEMP TABLE _pc_post_groups (
    grp          TEXT,
    direction    TEXT,
    parsed_date  DATE,
    vno          TEXT,
    nm           TEXT,
    total        NUMERIC(14,2),
    yr           INTEGER,
    je_id        UUID,
    voucher_id   UUID,
    anchor       UUID,
    rn_in_year   INTEGER,
    serial       INTEGER,
    voucher_number TEXT
  ) ON COMMIT DROP;

  INSERT INTO _pc_post_groups
    (grp, direction, parsed_date, vno, nm, total, yr, je_id, voucher_id, anchor, rn_in_year)
  SELECT g.grp, g.direction, g.parsed_date, g.vno, g.nm, g.total, g.yr,
         gen_random_uuid(), gen_random_uuid(), g.anchor,
         CASE WHEN g.direction = 'out'
              THEN row_number() OVER (PARTITION BY g.yr, g.direction
                                      ORDER BY g.parsed_date, g.grp)
         END
  FROM (
    SELECT CASE WHEN v_grouping = 'row'
                THEN l.row_no::TEXT
                ELSE coalesce(l.raw_voucher_no, '') || E'' || coalesce(l.raw_name, '')
           END                              AS grp,
           l.direction,
           l.parsed_date,
           max(coalesce(l.raw_voucher_no, '')) AS vno,
           max(coalesce(l.raw_name, ''))       AS nm,
           sum(l.amount)                       AS total,
           extract(year FROM l.parsed_date)::INTEGER AS yr,
           (array_agg(l.id ORDER BY l.row_no))[1] AS anchor
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
      AND l.status IN ('ok', 'suspense')
    GROUP BY 1, l.direction, l.parsed_date, extract(year FROM l.parsed_date)::INTEGER
  ) g;

  -- One serial block per year the outflows span (normally a single year).
  FOR v_yr IN
    SELECT yr, count(*) AS n FROM _pc_post_groups WHERE direction = 'out' GROUP BY yr ORDER BY yr
  LOOP
    v_start := next_pcv_serial_block(v_tenant, v_yr.yr, v_yr.n::INTEGER);
    UPDATE _pc_post_groups
    SET serial = v_start + rn_in_year - 1,
        voucher_number = 'PCV-' || v_yr.yr::TEXT || '-' ||
                         lpad((v_start + rn_in_year - 1)::TEXT, 4, '0')
    WHERE direction = 'out' AND yr = v_yr.yr;
  END LOOP;

  -- Same grouping expression, applied to the lines, so every insert below can
  -- join a line to its group.
  CREATE TEMP TABLE _pc_post_lines ON COMMIT DROP AS
  SELECT l.id, l.row_no, l.parsed_date, l.direction, l.amount,
         l.resolved_account_id, l.raw_description,
         CASE WHEN v_grouping = 'row'
              THEN l.row_no::TEXT
              ELSE coalesce(l.raw_voucher_no, '') || E'' || coalesce(l.raw_name, '')
         END AS grp
  FROM petty_cash_import_lines l
  WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant
    AND l.status IN ('ok', 'suspense');

  CREATE INDEX ON _pc_post_lines (grp, direction, parsed_date);

  -- ── Journal entries: outflow vouchers and inflow receipts, one pass ────
  INSERT INTO journal_entries
    (id, tenant_id, entry_date, description, reference, status, posted_at,
     is_system_generated, entry_type, cash_flow_category, source_type, source_id, created_by)
  SELECT g.je_id, v_tenant, g.parsed_date,
         CASE WHEN g.direction = 'out'
              THEN 'Petty Cash Voucher ' || g.voucher_number ||
                   CASE WHEN g.vno <> '' THEN ' (' || g.vno || ')' ELSE '' END
              ELSE 'Petty Cash Receipt' || CASE WHEN g.nm <> '' THEN ' — ' || g.nm ELSE '' END
         END,
         CASE WHEN g.direction = 'out'
              THEN CASE WHEN g.vno <> '' THEN g.vno ELSE g.voucher_number END
              ELSE nullif(g.vno, '')
         END,
         'posted', now(), true,
         CASE WHEN g.direction = 'out' THEN 'petty_cash' ELSE 'petty_cash_import_receipt' END,
         'operating', 'petty_cash_import',
         -- Each entry names the document that produced it, never the batch:
         -- idx_je_unique_source requires (source_type, source_id) to be unique.
         CASE WHEN g.direction = 'out' THEN g.voucher_id ELSE g.anchor END,
         v_user
  FROM _pc_post_groups g;

  -- Contra legs, one per import line.
  INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
  SELECT g.je_id, v_tenant, l.resolved_account_id,
         CASE WHEN l.direction = 'out' THEN l.amount ELSE 0 END,
         CASE WHEN l.direction = 'out' THEN 0 ELSE l.amount END,
         l.raw_description
  FROM _pc_post_lines l
  JOIN _pc_post_groups g
    ON g.grp = l.grp AND g.direction = l.direction AND g.parsed_date = l.parsed_date;

  -- Fund legs, one per group. Both sides explicit, never inferred.
  INSERT INTO journal_lines (journal_entry_id, tenant_id, account_id, debit, credit, memo)
  SELECT g.je_id, v_tenant, v_gl,
         CASE WHEN g.direction = 'in'  THEN g.total ELSE 0 END,
         CASE WHEN g.direction = 'out' THEN g.total ELSE 0 END,
         CASE WHEN g.direction = 'out' THEN 'Petty cash paid out' ELSE 'Petty cash received' END
  FROM _pc_post_groups g;

  INSERT INTO petty_cash_vouchers
    (id, tenant_id, voucher_number, date, paid_to, total_amount, status,
     petty_cash_account_id, prepared_by, journal_entry_id, approved_at)
  SELECT g.voucher_id, v_tenant, g.voucher_number, g.parsed_date, nullif(g.nm, ''),
         g.total, 'approved', v_fund, v_user, g.je_id, now()
  FROM _pc_post_groups g
  WHERE g.direction = 'out';

  -- trg_pcv_line_account_integrity fires per row here. Resolver Phase C
  -- already guarantees it passes, so a raise is a resolver bug and correctly
  -- aborts the whole transaction.
  INSERT INTO petty_cash_voucher_lines (voucher_id, line_no, date, description, account_id, amount)
  SELECT g.voucher_id,
         row_number() OVER (PARTITION BY g.voucher_id ORDER BY l.row_no),
         l.parsed_date, l.raw_description, l.resolved_account_id, l.amount
  FROM _pc_post_lines l
  JOIN _pc_post_groups g
    ON g.grp = l.grp AND g.direction = l.direction AND g.parsed_date = l.parsed_date
  WHERE l.direction = 'out';

  UPDATE petty_cash_import_lines t
  SET voucher_id = CASE WHEN g.direction = 'out' THEN g.voucher_id END,
      journal_entry_id = g.je_id,
      status = 'posted'
  FROM _pc_post_lines l
  JOIN _pc_post_groups g
    ON g.grp = l.grp AND g.direction = l.direction AND g.parsed_date = l.parsed_date
  WHERE t.id = l.id AND t.tenant_id = v_tenant;

  SELECT count(*) FILTER (WHERE direction = 'out'),
         count(*) FILTER (WHERE direction = 'in')
    INTO v_vouchers, v_receipts
  FROM _pc_post_groups;

  SELECT count(*),
         coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0),
         coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0)
    INTO v_lines, v_total_out, v_total_in
  FROM petty_cash_import_lines
  WHERE batch_id = p_batch_id AND tenant_id = v_tenant AND status = 'posted';

  UPDATE petty_cash_import_batches
  SET status = 'posted', posted_at = now()
  WHERE id = p_batch_id AND tenant_id = v_tenant;

  PERFORM recalc_budget_for_pc_import_batch(p_batch_id);
  PERFORM sync_pc_import_batch_transactions(p_batch_id);
  PERFORM set_config('app.pc_import_bulk', '0', true);

  DROP TABLE IF EXISTS _pc_post_groups;
  DROP TABLE IF EXISTS _pc_post_lines;

  RETURN jsonb_build_object(
    'batch_id',        p_batch_id,
    'vouchers_created', v_vouchers,
    'receipts_created', v_receipts,
    'journal_entries',  v_vouchers + v_receipts,
    'lines_posted',     v_lines,
    'lines_excluded',   v_excluded,
    'total_out',        v_total_out,
    'total_in',         v_total_in,
    'net_movement',     v_total_in - v_total_out,
    'opening_balance',  v_opening,
    'closing_balance',  v_opening - v_total_out + v_total_in,
    'lowest_balance',   coalesce(v_lowest, v_opening),
    'opening_float_needed',
      CASE WHEN coalesce(v_lowest, 0) < 0 THEN abs(v_lowest) ELSE 0 END
  );
END;
$$;

COMMENT ON FUNCTION public.post_petty_cash_import_batch(UUID) IS
  'Posts a resolved petty cash import batch in one transaction, set-based. Refuses blocked lines, refuses lines that claim to be ready but are incomplete, and refuses a negative running balance unless the batch opted in.';
