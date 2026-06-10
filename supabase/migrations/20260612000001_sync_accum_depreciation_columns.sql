-- The account_settings table has two columns that both represent the
-- accumulated depreciation fallback account, created by two separate migrations:
--   accum_depreciation_account_id        (from 20260610000001)
--   accumulated_depreciation_account_id  (from 20260611000001)
--
-- post-asset-transaction reads from accum_depreciation_account_id.
-- AccountMapping.tsx saves to accumulated_depreciation_account_id.
-- This trigger keeps them in sync so the edge function always has the latest value.

CREATE OR REPLACE FUNCTION public.fn_sync_accum_depreciation_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- When accumulated_depreciation_account_id changes, mirror to accum_depreciation_account_id
  IF NEW.accumulated_depreciation_account_id IS DISTINCT FROM OLD.accumulated_depreciation_account_id THEN
    NEW.accum_depreciation_account_id := NEW.accumulated_depreciation_account_id;
  END IF;

  -- When accum_depreciation_account_id changes (e.g. direct update), mirror the other way
  IF NEW.accum_depreciation_account_id IS DISTINCT FROM OLD.accum_depreciation_account_id
     AND NEW.accumulated_depreciation_account_id IS NOT DISTINCT FROM OLD.accumulated_depreciation_account_id THEN
    NEW.accumulated_depreciation_account_id := NEW.accum_depreciation_account_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_accum_depreciation ON public.account_settings;
CREATE TRIGGER trg_sync_accum_depreciation
BEFORE UPDATE ON public.account_settings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_accum_depreciation_columns();

-- One-time backfill: populate accum_depreciation_account_id from
-- accumulated_depreciation_account_id where it is already set
UPDATE public.account_settings
SET accum_depreciation_account_id = accumulated_depreciation_account_id
WHERE accumulated_depreciation_account_id IS NOT NULL
  AND (accum_depreciation_account_id IS NULL
    OR accum_depreciation_account_id IS DISTINCT FROM accumulated_depreciation_account_id);

-- And the reverse: populate accumulated_depreciation_account_id from
-- accum_depreciation_account_id where it is set but the other is not
UPDATE public.account_settings
SET accumulated_depreciation_account_id = accum_depreciation_account_id
WHERE accum_depreciation_account_id IS NOT NULL
  AND accumulated_depreciation_account_id IS NULL;
