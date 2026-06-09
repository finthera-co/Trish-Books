-- The is_control_account / requires_subledger / subledger_type flags were only
-- set by a one-shot backfill migration (20260403...). New tenants seeded after
-- that migration receive accounts without these flags, so findARAccountId /
-- findAPAccountId / findInventoryControlAccountId return null and opening-
-- balance posting fails. This migration adds a BEFORE INSERT trigger so every
-- future insert is auto-flagged, plus a backfill for existing accounts.

CREATE OR REPLACE FUNCTION fn_auto_control_account_flags()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only auto-derive if the caller did not explicitly mark this as a control account.
  -- This lets manual overrides (e.g. provisioned via UI) take precedence.
  IF NEW.is_control_account = false AND (NEW.subledger_type IS NULL OR NEW.subledger_type = 'none') THEN
    CASE lower(NEW.account_subtype)
      WHEN 'accounts receivable' THEN
        NEW.is_control_account  := true;
        NEW.requires_subledger  := true;
        NEW.subledger_type      := 'customer';
      WHEN 'accounts payable' THEN
        NEW.is_control_account  := true;
        NEW.requires_subledger  := true;
        NEW.subledger_type      := 'vendor';
      WHEN 'inventory' THEN
        NEW.is_control_account  := true;
        NEW.requires_subledger  := true;
        NEW.subledger_type      := 'inventory';
      ELSE
        IF lower(NEW.account_subtype) = ANY(ARRAY[
          'fixed asset', 'fixed assets', 'furniture & equipment',
          'furniture & fixtures', 'vehicles', 'buildings', 'machinery'
        ]) THEN
          NEW.is_control_account := true;
          NEW.requires_subledger := true;
          NEW.subledger_type     := 'fixed_asset';
        END IF;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_control_account_flags ON public.accounts;
CREATE TRIGGER trg_auto_control_account_flags
BEFORE INSERT ON public.accounts
FOR EACH ROW EXECUTE FUNCTION fn_auto_control_account_flags();

-- Backfill existing tenant accounts that are still missing flags
UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'customer'
WHERE lower(account_subtype) = 'accounts receivable'
  AND NOT is_control_account;

UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'vendor'
WHERE lower(account_subtype) = 'accounts payable'
  AND NOT is_control_account;

UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'inventory'
WHERE lower(account_subtype) = 'inventory'
  AND NOT is_control_account;

UPDATE public.accounts
SET is_control_account = true, requires_subledger = true, subledger_type = 'fixed_asset'
WHERE lower(account_subtype) = ANY(ARRAY[
  'fixed asset', 'fixed assets', 'furniture & equipment',
  'furniture & fixtures', 'vehicles', 'buildings', 'machinery'
])
  AND NOT is_control_account;
