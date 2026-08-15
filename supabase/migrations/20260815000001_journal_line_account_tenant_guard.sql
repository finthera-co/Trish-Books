-- ═══════════════════════════════════════════════════════════════════════════
-- Close cross-tenant account injection on journal lines.
--
-- The gap: several edge functions take an account id straight from the request
-- body — ar-write-off (bad_debt_account_id, allowance_account_id, ar_account_id),
-- post-payment-received (ar_account_id), post-asset-transaction (cash_account_id)
-- — and post with the service_role client, which does not apply the accounts RLS
-- policy. So `.eq("id", account_id)` resolves ANY tenant's account, and the line
-- is written against it.
--
-- What was already in place, and why it was not enough:
--   • trg_journal_lines_set_tenant derives the LINE's tenant from its parent
--     entry, so the line cannot be filed under the wrong tenant — but it says
--     nothing about which tenant owns the ACCOUNT the line points at.
--   • The FK on account_id proves the account exists. Not who owns it.
--   • fn_prevent_posting_non_postable checks is_postable. Not tenancy.
--
-- Result today: tenant A can post a debit to tenant B's account. The line counts
-- under A's entry for the trial balance, but every account-scoped read — the
-- account register, GL by account, the account report — filters on account_id,
-- so B's account page shows A's movement.
--
-- Fixed here rather than only in each function because the insert paths are many
-- (edge functions, posting RPCs, imports) and one of them will be missed. The
-- per-function checks added alongside this exist to return a readable error; this
-- is the thing that makes the guarantee.
--
-- Cost: folded into the existing per-line trigger, which already looks the
-- account up, so this adds one PK lookup on journal_entries per line on the
-- normal path and nothing at all on the bulk bank-import path.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_prevent_posting_non_postable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_postable  BOOLEAN;
  v_acct_label   TEXT;
  v_acct_tenant  UUID;
  v_entry_tenant UUID;
BEGIN
  -- Bank import posts only to accounts it has already verified are active,
  -- postable leaves of the importing tenant (see import_bank_statement_post).
  -- Skip the per-line lookup.
  IF current_setting('app.bank_import_bulk', true) = '1' THEN
    RETURN NEW;
  END IF;

  SELECT is_postable, account_code || ' ' || account_name, tenant_id
    INTO v_is_postable, v_acct_label, v_acct_tenant
  FROM public.accounts WHERE id = NEW.account_id;

  -- The FK would catch this too, but a named account beats a constraint name in
  -- the error a user actually sees.
  IF v_acct_tenant IS NULL THEN
    RAISE EXCEPTION
      'POSTING_VIOLATION: Account % does not exist.', NEW.account_id
      USING ERRCODE = 'P0003';
  END IF;

  IF v_is_postable = FALSE THEN
    RAISE EXCEPTION
      'POSTING_VIOLATION: Account % is a summary/parent account (is_postable = false). Post to one of its child accounts instead.',
      v_acct_label USING ERRCODE = 'P0003';
  END IF;

  -- Read the parent entry rather than NEW.tenant_id: this trigger sorts before
  -- trg_journal_lines_set_tenant ('_' < 's'), so at this point NEW.tenant_id is
  -- still whatever the caller supplied — exactly the value that cannot be
  -- trusted here. The parent entry is the authority, same as it is there.
  SELECT tenant_id INTO v_entry_tenant
  FROM public.journal_entries WHERE id = NEW.journal_entry_id;

  IF v_entry_tenant IS NOT NULL AND v_acct_tenant <> v_entry_tenant THEN
    RAISE EXCEPTION
      'POSTING_VIOLATION: Account % belongs to a different company than the journal entry it is being posted to.',
      v_acct_label USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$function$;

-- The trigger itself is unchanged (BEFORE INSERT, per row); only the function
-- body above moved. Re-asserted so a fresh database built from migrations alone
-- is never left with the function but not the trigger.
DROP TRIGGER IF EXISTS trg_journal_line_postable ON public.journal_lines;
CREATE TRIGGER trg_journal_line_postable
  BEFORE INSERT ON public.journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_posting_non_postable();
