-- Gap 6 — optionally base monthly OT on basic + allowances.
-- The derived OT hourly rate was basic / (workingDays × stdHours), excluding
-- allowances. Companies whose OT policy includes fixed allowances were understated.
-- Add a per-shift toggle (default false → unchanged) that, when on, derives the OT
-- rate from basic + EPF-able allowances.
ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS ot_includes_allowances boolean NOT NULL DEFAULT false;
