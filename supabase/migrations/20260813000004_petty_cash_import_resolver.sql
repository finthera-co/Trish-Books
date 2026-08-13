-- ═══════════════════════════════════════════════════════════════════════════
-- PETTY CASH IMPORT — deterministic line resolver
--
-- Turns staged raw cell text into a validated, account-resolved batch. Every
-- rule is an exact match on normalized text; nothing is guessed, nothing is
-- fuzzy-matched, and a row that cannot be resolved deterministically is either
-- routed to the configured suspense account or blocked with a code.
--
-- Re-runnable by design: the user fixes a mapping and re-resolves rather than
-- re-uploading. Posted and excluded lines are left alone, and manual overrides
-- survive a re-run.
--
-- Set-based throughout — one statement per phase/tier, no per-line loop.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Amount text → numeric ──────────────────────────────────────────────────
-- Mirrors parseImportAmount() in src/lib/pettyCashImportParser.ts. The browser
-- copy exists only to render a preview; THIS is the one that decides what gets
-- posted. Blank and dash placeholders are a real zero; anything else that is
-- not a number is NULL, which the resolver reports as AMOUNT_NOT_NUMERIC
-- rather than silently treating as zero.
CREATE OR REPLACE FUNCTION public.fn_parse_import_amount(p_raw TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v     TEXT;
  v_neg BOOLEAN := false;
BEGIN
  v := lower(btrim(coalesce(p_raw, '')));
  IF v = '' THEN RETURN 0; END IF;

  v := replace(v, 'රු', '');
  v := regexp_replace(v, 'lkr|rs\.|rs', '', 'g');
  v := regexp_replace(v, '\s', '', 'g');

  -- Placeholders accountants write for "nothing here".
  IF v IN ('', '-', '–', '—', 'n/a', 'na') THEN RETURN 0; END IF;

  -- (1,234.50) is the accounting negative.
  IF v ~ '^\(.*\)$' THEN
    v_neg := true;
    v := btrim(v, '()');
  END IF;

  IF v ~ '^[-–—]' THEN
    v_neg := true;
    v := substr(v, 2);
  ELSIF v ~ '^\+' THEN
    v := substr(v, 2);
  END IF;

  v := replace(v, ',', '');

  IF v !~ '^\d+(\.\d+)?$' THEN
    RETURN NULL;                        -- unparseable → caller blocks the row
  END IF;

  RETURN CASE WHEN v_neg THEN -(v::NUMERIC) ELSE v::NUMERIC END;
END;
$$;

COMMENT ON FUNCTION public.fn_parse_import_amount(TEXT) IS
  'Import amount text → numeric. Strips Rs./LKR/රු, spaces and thousands separators; blank and dash placeholders are 0; (n) is negative; anything else non-numeric is NULL so the resolver can block it instead of guessing zero.';

-- ── Resolver ───────────────────────────────────────────────────────────────
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
  v_status        TEXT;
  v_suspense      UUID;
  v_result        JSONB;
BEGIN
  SELECT b.petty_cash_account_id, b.amount_orientation, b.status,
         pca.account_id, pca.is_active
    INTO v_fund, v_orientation, v_status, v_fund_gl, v_fund_active
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

  -- ═══ Reset ═══ so a re-run after a mapping fix is a clean re-resolution.
  -- Posted and excluded lines are untouched; a manual override is a decision
  -- the user already made and survives.
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
  -- Evaluated in the documented order; the first rule that fires wins. The
  -- both/missing/negative rules require a successful parse, so garbage text
  -- falls through to AMOUNT_NOT_NUMERIC instead of masquerading as a zero.
  WITH parsed AS (
    SELECT l.id,
           l.parsed_date,
           fn_parse_import_amount(l.raw_debit)  AS d,
           fn_parse_import_amount(l.raw_credit) AS c,
           btrim(coalesce(l.raw_debit, ''))  <> '' AS has_debit_text,
           btrim(coalesce(l.raw_credit, '')) <> '' AS has_credit_text
    FROM petty_cash_import_lines l
    WHERE l.batch_id = p_batch_id AND l.tenant_id = v_tenant AND l.status = 'pending'
  ), verdict AS (
    SELECT p.id,
           CASE
             WHEN p.parsed_date IS NULL THEN 'DATE_UNPARSEABLE'
             WHEN p.d IS NOT NULL AND p.c IS NOT NULL AND p.d <> 0 AND p.c <> 0 THEN 'AMOUNT_BOTH_SIDES'
             WHEN p.d IS NOT NULL AND p.c IS NOT NULL AND p.d = 0 AND p.c = 0 THEN 'AMOUNT_MISSING'
             WHEN coalesce(p.d, 0) < 0 OR coalesce(p.c, 0) < 0 THEN 'AMOUNT_NEGATIVE'
             WHEN (p.has_debit_text AND p.d IS NULL) OR (p.has_credit_text AND p.c IS NULL) THEN 'AMOUNT_NOT_NUMERIC'
             WHEN NOT v_fund_active THEN 'FUND_INACTIVE'
             WHEN EXISTS (
               SELECT 1 FROM fiscal_periods fp
               WHERE fp.tenant_id = v_tenant
                 AND fp.status = 'closed'
                 AND p.parsed_date BETWEEN fp.period_start AND fp.period_end
             ) THEN 'PERIOD_LOCKED'
           END AS code,
           p.d, p.c
    FROM parsed p
  )
  UPDATE petty_cash_import_lines l
  SET status        = CASE WHEN v.code IS NULL THEN 'pending' ELSE 'blocked' END,
      error_code    = v.code,
      error_message = CASE v.code
        WHEN 'DATE_UNPARSEABLE'   THEN 'The date cell could not be read as a date. Correct it in the sheet, or exclude this row.'
        WHEN 'AMOUNT_BOTH_SIDES'  THEN 'Both Debit and Credit carry a value. A petty cash row is either money out or money in, never both.'
        WHEN 'AMOUNT_MISSING'     THEN 'Neither Debit nor Credit carries a value.'
        WHEN 'AMOUNT_NEGATIVE'    THEN 'A negative amount was parsed. Record the movement on the opposite column instead of negating it.'
        WHEN 'AMOUNT_NOT_NUMERIC' THEN 'The amount cell is not a number.'
        WHEN 'FUND_INACTIVE'      THEN 'The petty cash fund this batch targets is inactive. Reactivate it, or import into another fund.'
        WHEN 'PERIOD_LOCKED'      THEN 'The date falls in a closed fiscal period. Reopen the period or change the date.'
      END,
      -- Direction is read off the batch's orientation, never hardcoded.
      -- contra: Debit = money OUT of the fund.  fund: Debit = money IN.
      direction = CASE
        WHEN v.code IS NOT NULL THEN NULL
        WHEN v_orientation = 'contra' THEN CASE WHEN coalesce(v.d, 0) > 0 THEN 'out' ELSE 'in'  END
        ELSE                              CASE WHEN coalesce(v.d, 0) > 0 THEN 'in'  ELSE 'out' END
      END,
      amount = CASE
        WHEN v.code IS NOT NULL THEN NULL
        WHEN coalesce(v.d, 0) > 0 THEN v.d
        ELSE v.c
      END
  FROM verdict v
  WHERE l.id = v.id AND l.tenant_id = v_tenant;

  -- ═══ Phase B — resolution ladder ═══
  -- Each tier only sees lines that are still unresolved, so the first tier
  -- that fires for a line is the one that sticks.

  -- Tier 1: learned Account Type map. UNIQUE(tenant, type, key) ⇒ one match.
  UPDATE petty_cash_import_lines l
  SET resolved_account_id = m.account_id,
      resolution_tier     = 'account_type_map',
      resolution_key      = m.match_key
  FROM petty_cash_account_map m
  WHERE l.batch_id = p_batch_id
    AND l.tenant_id = v_tenant
    AND l.status = 'pending'
    AND l.resolved_account_id IS NULL
    AND m.tenant_id = v_tenant
    AND m.match_type = 'account_type'
    AND m.match_key = fn_normalize_import_key(l.raw_account_type);

  -- Tier 2: Account Type text = an account's name. Two accounts sharing a
  -- normalized name is not a tie to break — it is a question only the user
  -- can answer, so the row blocks and names the candidates.
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
      ON a.tenant_id = v_tenant
     AND a.is_active
     AND a.is_postable
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
  WHERE l.batch_id = p_batch_id
    AND l.tenant_id = v_tenant
    AND l.status = 'pending'
    AND l.resolved_account_id IS NULL
    AND fn_normalize_import_key(l.raw_account_type) = c.k;

  -- Tier 3: Account Type text = an account code verbatim.
  -- UNIQUE(tenant_id, account_code) ⇒ never ambiguous.
  UPDATE petty_cash_import_lines l
  SET resolved_account_id = a.id,
      resolution_tier     = 'account_code',
      resolution_key      = a.account_code
  FROM accounts a
  WHERE l.batch_id = p_batch_id
    AND l.tenant_id = v_tenant
    AND l.status = 'pending'
    AND l.resolved_account_id IS NULL
    AND a.tenant_id = v_tenant
    AND a.account_code = btrim(coalesce(l.raw_account_type, ''))
    AND btrim(coalesce(l.raw_account_type, '')) <> '';

  -- Tier 4: learned Description map.
  UPDATE petty_cash_import_lines l
  SET resolved_account_id = m.account_id,
      resolution_tier     = 'description_map',
      resolution_key      = m.match_key
  FROM petty_cash_account_map m
  WHERE l.batch_id = p_batch_id
    AND l.tenant_id = v_tenant
    AND l.status = 'pending'
    AND l.resolved_account_id IS NULL
    AND m.tenant_id = v_tenant
    AND m.match_type = 'description'
    AND m.match_key = fn_normalize_import_key(l.raw_description);

  -- Tier 5: suspense. Never auto-created — an unconfigured suspense account
  -- blocks the batch and points the user at Settings.
  UPDATE petty_cash_import_lines l
  SET resolved_account_id = CASE WHEN v_suspense IS NOT NULL THEN v_suspense END,
      resolution_tier     = CASE WHEN v_suspense IS NOT NULL THEN 'suspense' END,
      resolution_key      = CASE WHEN v_suspense IS NOT NULL
                                 THEN fn_normalize_import_key(l.raw_account_type) END,
      status              = CASE WHEN v_suspense IS NOT NULL THEN 'pending' ELSE 'blocked' END,
      error_code          = CASE WHEN v_suspense IS NULL THEN 'SUSPENSE_NOT_CONFIGURED' END,
      error_message       = CASE WHEN v_suspense IS NULL THEN
        'No suspense account is configured, so unmatched rows have nowhere to go. Set one under Settings → Account Mapping.' END
  WHERE l.batch_id = p_batch_id
    AND l.tenant_id = v_tenant
    AND l.status = 'pending'
    AND l.resolved_account_id IS NULL;

  -- ═══ Phase C — account-level validation (blocking) ═══
  -- Applies to whatever Phase B resolved, including manual overrides and the
  -- suspense account itself. The first four rules mirror
  -- trg_pcv_line_account_integrity exactly, so a failure surfaces here at
  -- staging rather than halfway through posting.
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
  -- Surfaced, never blocked: a canteen genuinely does buy Rs. 500 of milk
  -- twice in one day. The UI warns and lets the user exclude specific rows.

  -- Within this batch: every repeat after the earliest row_no.
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
  SET is_duplicate = true,
      duplicate_of = k.first_id
  FROM keyed k
  WHERE l.id = k.id AND l.tenant_id = v_tenant AND k.rn > 1;

  -- Against lines already posted from earlier batches for the same fund.
  UPDATE petty_cash_import_lines l
  SET is_duplicate = true,
      duplicate_of = prior.id
  FROM (
    SELECT DISTINCT ON (pl.parsed_date, ck, dk, pl.amount, pl.direction)
           pl.id, pl.parsed_date, pl.amount, pl.direction,
           coalesce(fn_normalize_import_key(pl.raw_voucher_no), '')   AS ck,
           coalesce(fn_normalize_import_key(pl.raw_description), '') AS dk
    FROM petty_cash_import_lines pl
    JOIN petty_cash_import_batches pb ON pb.id = pl.batch_id
    WHERE pl.tenant_id = v_tenant
      AND pb.tenant_id = v_tenant
      AND pb.petty_cash_account_id = v_fund
      AND pb.id <> p_batch_id
      AND pb.status = 'posted'
      AND pl.status = 'posted'
    ORDER BY pl.parsed_date, ck, dk, pl.amount, pl.direction, pl.row_no
  ) prior
  WHERE l.batch_id = p_batch_id
    AND l.tenant_id = v_tenant
    AND l.is_duplicate = false
    AND l.status IN ('pending', 'blocked')
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

  -- ═══ Summary ═══
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
           -- Drives the "teach the engine" UI: the distinct normalized keys
           -- that fell all the way through to suspense.
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

COMMENT ON FUNCTION public.resolve_petty_cash_import_lines(UUID) IS
  'Validates and account-resolves a staged petty cash import batch. Idempotent: re-running after a mapping fix produces the same result, preserving manual overrides and leaving posted/excluded lines alone.';
