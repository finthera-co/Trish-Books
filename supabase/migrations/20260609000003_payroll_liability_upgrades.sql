-- Payroll Liability Tracking — Industrial Grade Upgrades

-- ── 1a. Add void support to payroll_remittances ─────────────────────────────
ALTER TABLE public.payroll_remittances
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'voided')),
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid
    REFERENCES public.journal_entries(id);

-- ── 1b. Replace table-level unique constraint with a partial unique index ────
-- Active remittances deduplicated; voided ones can co-exist (historical record).
ALTER TABLE public.payroll_remittances
  DROP CONSTRAINT IF EXISTS payroll_remittances_tenant_id_remittance_type_period_key;

DROP INDEX IF EXISTS payroll_remittances_tenant_id_remittance_type_period_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_remittances_active
  ON public.payroll_remittances(tenant_id, remittance_type, period)
  WHERE status = 'posted';

-- ── 1c. Payroll liability summary view ──────────────────────────────────────
-- Groups accrued EPF/ETF amounts by run period_start month so the period key
-- matches what users enter manually when recording remittances (YYYY-MM).
-- Due date = last day of the month following the run period end.
CREATE OR REPLACE VIEW public.payroll_liability_summary AS
WITH accrued AS (
  SELECT
    pr.tenant_id,
    pr.component_code                                              AS remittance_type,
    to_char(run.period_start::date, 'YYYY-MM')                    AS period,
    SUM(pr.value)                                                  AS accrued_amount,
    (date_trunc('month', MAX(run.period_end::date))
      + INTERVAL '2 months - 1 day')::date                        AS due_date
  FROM public.payroll_results pr
  JOIN public.payroll_runs run ON run.id = pr.run_id
  WHERE run.status IN ('processed', 'finalized')
    AND pr.component_code IN ('EPF_EMPLOYEE', 'EPF_EMPLOYER', 'ETF_EMPLOYER')
  GROUP BY pr.tenant_id, pr.component_code,
           to_char(run.period_start::date, 'YYYY-MM')
),
remitted AS (
  SELECT tenant_id, remittance_type, period,
         SUM(amount) AS remitted_amount
  FROM   public.payroll_remittances
  WHERE  status = 'posted'
  GROUP  BY tenant_id, remittance_type, period
)
SELECT
  a.tenant_id,
  a.remittance_type,
  a.period,
  a.accrued_amount,
  COALESCE(r.remitted_amount, 0)                                  AS remitted_amount,
  a.accrued_amount - COALESCE(r.remitted_amount, 0)               AS outstanding_amount,
  a.due_date,
  CASE
    WHEN a.accrued_amount - COALESCE(r.remitted_amount, 0) <= 0  THEN 'FULLY_REMITTED'
    WHEN CURRENT_DATE > a.due_date                                THEN 'OVERDUE'
    WHEN CURRENT_DATE > a.due_date - INTERVAL '7 days'           THEN 'DUE_SOON'
    ELSE 'PENDING'
  END AS remittance_status
FROM accrued a
LEFT JOIN remitted r USING (tenant_id, remittance_type, period);
