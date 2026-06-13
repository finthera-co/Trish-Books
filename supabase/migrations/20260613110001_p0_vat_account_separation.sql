-- ════════════════════════════════════════════════════════════════════
-- P0 — Separate VAT input/output accounts + GL-link tax_records
-- ════════════════════════════════════════════════════════════════════
-- Context: the full Tax Engine (migrations 20260613100001-11) already
-- separates output/input VAT per tax_code (output_liability_account_id /
-- input_receivable_account_id) and writes the GL-linked sub-ledger
-- public.tax_transactions. This P0 migration handles the LEGACY surface
-- that the engine does not: documents posted WITHOUT a tax_code/tax_group
-- (the non-engine fallback path), which still resolve a single shared
-- account (account_settings.tax_payable_account_id).
--
-- What this does:
--   * Adds account_settings.vat_output_payable_account_id /
--     vat_input_receivable_account_id, mapped to the engine's already-seeded
--     canonical accounts ('VAT Output Payable' 2310, 'VAT Input Receivable'
--     1310) so legacy and engine paths converge on the same accounts.
--   * GL-links public.tax_records (adds tenant_id, journal_entry_id,
--     direction, source_type, source_id, transaction_date) and fixes its
--     RLS to allow tenant-scoped writes.
--
-- What this deliberately does NOT do (would regress the merged engine):
--   * It does NOT recreate post_supplier_bill. The live version
--     (20260613100010) already DEBITS input_receivable_account_id per line,
--     does reverse-charge / cost-capitalization / 3-tier resolution and
--     writes tax_transactions. There is no remaining legacy single-account
--     collision on the bill side (bills only post tax via tax_codes), so
--     P0 step 1d is a no-op here.
--   * It does NOT drop tax_payable_account_id (kept as legacy fallback).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1a. Dedicated VAT account settings ───────────────────────────────
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS vat_output_payable_account_id   uuid REFERENCES public.accounts(id),  -- Cr on sales (liability)
  ADD COLUMN IF NOT EXISTS vat_input_receivable_account_id uuid REFERENCES public.accounts(id);  -- Dr on purchases (asset)

-- ── 1b. Ensure the canonical COA accounts exist, then backfill ───────
-- Reuse the engine's ensure_tax_account (idempotent, matches by name first)
-- so we converge on its already-seeded 2310/1310 accounts rather than
-- creating duplicates.
DO $$
DECLARE
  v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.ensure_tax_account(v_t, '2310', 'VAT Output Payable',   'Liability', 'Tax Payable',    'credit');
    PERFORM public.ensure_tax_account(v_t, '1310', 'VAT Input Receivable', 'Asset',     'Tax Receivable', 'debit');
  END LOOP;
END $$;

-- Output: reuse the account that has historically accumulated output VAT
-- (the shared legacy account) so prior balances stay in one place.
-- Do NOT overwrite a value an admin already configured.
UPDATE public.account_settings s
   SET vat_output_payable_account_id = s.tax_payable_account_id
 WHERE s.vat_output_payable_account_id IS NULL
   AND s.tax_payable_account_id IS NOT NULL;

-- Output fallback: tenants with no legacy tax_payable_account_id map to the
-- engine's canonical 'VAT Output Payable' account.
UPDATE public.account_settings s
   SET vat_output_payable_account_id = a.id
  FROM public.accounts a
 WHERE a.tenant_id = s.tenant_id
   AND a.account_name = 'VAT Output Payable'
   AND s.vat_output_payable_account_id IS NULL;

-- Input: map to the engine's canonical 'VAT Input Receivable' (asset).
UPDATE public.account_settings s
   SET vat_input_receivable_account_id = a.id
  FROM public.accounts a
 WHERE a.tenant_id = s.tenant_id
   AND a.account_name = 'VAT Input Receivable'
   AND s.vat_input_receivable_account_id IS NULL;

-- ── 1c. GL-link tax_records + fix RLS ────────────────────────────────
ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS tenant_id        uuid REFERENCES public.tenants(id),
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS direction        text CHECK (direction IN ('output','input')),
  ADD COLUMN IF NOT EXISTS source_type      text,   -- 'invoice' | 'supplier_bill'
  ADD COLUMN IF NOT EXISTS source_id        uuid,
  ADD COLUMN IF NOT EXISTS transaction_date date;

-- Bill-side / engine-less records have no invoice and no tax_id concept.
ALTER TABLE public.tax_records ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE public.tax_records ALTER COLUMN tax_id     DROP NOT NULL;

-- Backfill tenant_id on legacy rows from their invoice.
UPDATE public.tax_records tr
   SET tenant_id = i.tenant_id
  FROM public.invoices i
 WHERE tr.invoice_id = i.id AND tr.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tax_records_tenant_date ON public.tax_records(tenant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_tax_records_source      ON public.tax_records(source_type, source_id);

-- RLS hygiene: add tenant-scoped write policy (was SELECT-only).
DROP POLICY IF EXISTS "Authorized users can manage tax records" ON public.tax_records;
CREATE POLICY "Authorized users can manage tax records"
  ON public.tax_records FOR ALL
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

COMMIT;
