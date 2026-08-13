-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — single Amount column, and per-row voucher grouping
--
-- Not every petty cash book carries Debit and Credit. A common shape is:
--
--     Date | Description | Account type | Amount
--
-- With one amount column the direction can no longer be read off which column
-- was filled in, and with no Voucher No. column rows can no longer be grouped
-- into the paper voucher they belonged to. Both become explicit properties of
-- the batch rather than anything inferred from the data:
--
--   amount_mode
--     debit_credit   two columns, direction from whichever is populated (default)
--     single_out     one column, every row is money OUT; a negative blocks
--     single_in      one column, every row is money IN;  a negative blocks
--     single_signed  one column, positive is OUT and negative is IN
--
--   grouping_mode
--     voucher_no     one voucher per (date, voucher no, name) — the paper voucher
--     row            one voucher per sheet row
--
-- single_out deliberately BLOCKS a negative rather than quietly treating it as
-- money in. A book whose author says "every row is a payment" and then contains
-- a negative is telling us something we do not understand, and guessing the
-- direction of cash is exactly the class of mistake this module refuses to make.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.petty_cash_import_lines
  ADD COLUMN IF NOT EXISTS raw_amount TEXT;

COMMENT ON COLUMN public.petty_cash_import_lines.raw_amount IS
  'Verbatim single Amount cell, for sheets that carry one amount column instead of Debit/Credit. Never mutated; raw_debit/raw_credit stay null for those files.';

ALTER TABLE public.petty_cash_import_batches
  ADD COLUMN IF NOT EXISTS amount_mode TEXT NOT NULL DEFAULT 'debit_credit';

ALTER TABLE public.petty_cash_import_batches
  ADD COLUMN IF NOT EXISTS grouping_mode TEXT NOT NULL DEFAULT 'voucher_no';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pc_import_batches_amount_mode_chk') THEN
    ALTER TABLE public.petty_cash_import_batches
      ADD CONSTRAINT pc_import_batches_amount_mode_chk
      CHECK (amount_mode IN ('debit_credit', 'single_out', 'single_in', 'single_signed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pc_import_batches_grouping_mode_chk') THEN
    ALTER TABLE public.petty_cash_import_batches
      ADD CONSTRAINT pc_import_batches_grouping_mode_chk
      CHECK (grouping_mode IN ('voucher_no', 'row'));
  END IF;
END $$;

COMMENT ON COLUMN public.petty_cash_import_batches.amount_mode IS
  'How the sheet expresses direction. debit_credit = two columns; single_* = one Amount column, with the suffix naming the direction every row carries (single_signed uses the sign).';
COMMENT ON COLUMN public.petty_cash_import_batches.grouping_mode IS
  'voucher_no = one voucher per (date, voucher no, name), rebuilding the paper voucher. row = one voucher per sheet row, for books with no voucher number.';

-- ── Resolver: Phase A now reads whichever amount shape the batch declares ──
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
  WITH parsed AS (
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
  ), verdict AS (
    SELECT p.id,
           CASE
             WHEN p.parsed_date IS NULL THEN 'DATE_UNPARSEABLE'
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
  WITH checked AS (
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
  WITH keyed AS (
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
