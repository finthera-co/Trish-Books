-- The SOCI/SFP/CF period captions ("As At 31st March", "For the Year Ended
-- 31st March") were hardcoded at seed time, matching this codebase's
-- existing convention — but there was never a tenant setting driving it, so
-- it's wrong for any tenant whose fiscal year doesn't end in March. Adds the
-- setting; the caption becomes derived from it in the presentation layer
-- (FsStatementFace / the Changes in Equity page), not from the stored
-- fs_statements.period_caption string, so changing it later doesn't require
-- reseeding every statement.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS financial_year_end integer NOT NULL DEFAULT 3
  CHECK (financial_year_end BETWEEN 1 AND 12);

COMMENT ON COLUMN public.tenants.financial_year_end IS
  'Month (1-12) the tenant''s fiscal year ends in. Drives the "As At"/"For the Year Ended" caption on financial statements. Defaults to 3 (March), matching every statement seeded before this column existed.';
