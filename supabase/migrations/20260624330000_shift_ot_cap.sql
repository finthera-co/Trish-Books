-- #7 — statutory OT cap (compliance flag). SL labour law limits overtime (~12h/
-- week). Worked OT is still paid, so this is a per-period ceiling the payroll form
-- warns on — it does not reduce pay. 0 = no cap.
ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS ot_cap_hours numeric NOT NULL DEFAULT 0;
