-- Reconciliation: PAYE/APIT is computed by the existing apit_schedules + taxEngine
-- (editable via TaxSettings). The parallel paye_tax_brackets table from the prior
-- migration is redundant and removed to avoid two competing tax-bracket sources.
-- Kept: employee_paye / total_paye columns, the PAYE component, and the EPF_BASE fix.
DROP TABLE IF EXISTS public.paye_tax_brackets CASCADE;
