-- Gap 4 — no-pay-leave per-day rate must use the FULL contractual basic.
-- On the biometric path basic_salary stores the absence-reduced EARNED figure, so
-- deriving the leave per-day from it understated the deduction when an employee had
-- both absence and unpaid leave. Persist the full monthly basic alongside, so both
-- run creation and recalculation value no-pay leave at the contractual day rate.
ALTER TABLE public.payroll_run_items
  ADD COLUMN IF NOT EXISTS contractual_basic numeric;

-- Backfill existing rows: their stored basic_salary is the best available proxy.
UPDATE public.payroll_run_items
  SET contractual_basic = basic_salary
  WHERE contractual_basic IS NULL;
