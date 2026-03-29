
-- Add invoice/bill tracking columns to AR and AP subledger tables
ALTER TABLE public.ar_subledger ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.ar_subledger ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.ap_subledger ADD COLUMN IF NOT EXISTS bill_no text;
ALTER TABLE public.ap_subledger ADD COLUMN IF NOT EXISTS due_date date;

-- Add cost/life/salvage columns to asset_subledger for richer asset tracking
ALTER TABLE public.asset_subledger ADD COLUMN IF NOT EXISTS cost numeric NOT NULL DEFAULT 0;
ALTER TABLE public.asset_subledger ADD COLUMN IF NOT EXISTS life_years integer;
ALTER TABLE public.asset_subledger ADD COLUMN IF NOT EXISTS salvage numeric NOT NULL DEFAULT 0;
