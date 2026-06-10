-- ─────────────────────────────────────────────────────────────────────────────
-- Sync trigger: keep accum_depreciation_account_id and
-- accumulated_depreciation_account_id in sync on account_settings.
--
-- WHY:
--   Migration 20260610000001 created: accum_depreciation_account_id
--   Migration 20260611000001 created: accumulated_depreciation_account_id
--   Both columns exist. post-asset-transaction reads accum_depreciation_account_id.
--   AccountMapping.tsx saves accumulated_depreciation_account_id.
--   Without this trigger, values set via the UI never reach the edge function.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_sync_accum_depreciation_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- When the long-form column (saved by UI) changes, mirror to short-form (read by edge fn)
  IF NEW.accumulated_depreciation_account_id IS DISTINCT FROM
     OLD.accumulated_depreciation_account_id THEN
    NEW.accum_depreciation_account_id := NEW.accumulated_depreciation_account_id;
  END IF;

  -- When the short-form column changes directly, mirror to long-form
  IF NEW.accum_depreciation_account_id IS DISTINCT FROM
     OLD.accum_depreciation_account_id
     AND NEW.accumulated_depreciation_account_id IS NOT DISTINCT FROM
     OLD.accumulated_depreciation_account_id THEN
    NEW.accumulated_depreciation_account_id := NEW.accum_depreciation_account_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_accum_depreciation ON public.account_settings;

CREATE TRIGGER trg_sync_accum_depreciation
BEFORE UPDATE ON public.account_settings
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_accum_depreciation_columns();

-- One-time backfill in both directions to align any existing data
UPDATE public.account_settings
SET accum_depreciation_account_id = accumulated_depreciation_account_id
WHERE accumulated_depreciation_account_id IS NOT NULL
  AND (
    accum_depreciation_account_id IS NULL
    OR accum_depreciation_account_id IS DISTINCT FROM accumulated_depreciation_account_id
  );

UPDATE public.account_settings
SET accumulated_depreciation_account_id = accum_depreciation_account_id
WHERE accum_depreciation_account_id IS NOT NULL
  AND accumulated_depreciation_account_id IS NULL;
