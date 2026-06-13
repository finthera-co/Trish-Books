-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 7: legacy data migration.
--
-- Assumptions (documented per spec):
--  * Every legacy public.taxes row was a sales-side tax → migrated as a
--    VAT-type, output-mode tax code named 'LEGACY-<n>' per tenant.
--  * Legacy rates have no history → single open-ended rate row effective
--    1900-01-01 so any historical document date resolves.
--  * products.tax_id (kept, deprecated) → products.default_tax_code_id.
--  * tax_records rows of POSTED invoices → tax_transactions (direction
--    'output', fx_rate 1 — no FX infrastructure existed; base_amount is
--    back-derived from amount/rate where rate > 0, else 0).
--  * journal_entry_id taken from the invoice's JE where resolvable; rows
--    without a JE are still migrated so filings stay complete.
--  * NOTE: at migration time no code path actually wrote tax_records, so
--    this backfill is defensive and may affect zero rows.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tax RECORD;
  v_code text;
  v_n int;
  v_code_id uuid;
BEGIN
  FOR v_tax IN
    SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.tenant_id ORDER BY t.tax_name) AS rn
    FROM public.taxes t
  LOOP
    v_code := 'LEGACY-' || v_tax.rn;

    -- Skip if this legacy tax was already migrated (idempotency:
    -- we tag the migrated code's name with the legacy row id).
    SELECT id INTO v_code_id FROM public.tax_codes
    WHERE tenant_id = v_tax.tenant_id AND name = v_tax.tax_name || ' (legacy ' || v_tax.id || ')';
    IF v_code_id IS NOT NULL THEN CONTINUE; END IF;

    -- Guarantee unique code per tenant even with concurrent reruns
    v_n := v_tax.rn;
    WHILE EXISTS (SELECT 1 FROM public.tax_codes WHERE tenant_id = v_tax.tenant_id AND code = v_code) LOOP
      v_n := v_n + 1;
      v_code := 'LEGACY-' || v_n;
    END LOOP;

    INSERT INTO public.tax_codes (
      tenant_id, code, name, tax_type, collection_mode,
      is_compound, is_recoverable, is_inclusive_default, is_active
    ) VALUES (
      v_tax.tenant_id, v_code, v_tax.tax_name || ' (legacy ' || v_tax.id || ')',
      'VAT', 'output', false, true, false, true
    )
    RETURNING id INTO v_code_id;

    INSERT INTO public.tax_code_rates (tenant_id, tax_code_id, rate, effective_from)
    VALUES (v_tax.tenant_id, v_code_id, v_tax.tax_rate, DATE '1900-01-01');

    -- Products that defaulted to this legacy tax
    UPDATE public.products
    SET default_tax_code_id = v_code_id
    WHERE tax_id = v_tax.id AND default_tax_code_id IS NULL AND default_tax_group_id IS NULL;

    -- Backfill the tax sub-ledger from tax_records of posted invoices
    INSERT INTO public.tax_transactions (
      tenant_id, tax_code_id, direction, source_type, source_id,
      base_amount, tax_amount, currency, fx_rate, rate_applied,
      transaction_date, journal_entry_id, note
    )
    SELECT
      i.tenant_id, v_code_id, 'output', 'invoice', i.id,
      CASE WHEN v_tax.tax_rate > 0 THEN round(tr.tax_amount / (v_tax.tax_rate / 100.0), 2) ELSE 0 END,
      tr.tax_amount,
      COALESCE(i.currency, 'LKR'), 1, v_tax.tax_rate,
      i.issue_date,
      (SELECT je.id FROM public.journal_entries je
        WHERE je.source_type = 'invoice' AND je.source_id = i.id
          AND je.status <> 'voided' LIMIT 1),
      'Backfilled from legacy tax_records'
    FROM public.tax_records tr
    JOIN public.invoices i ON i.id = tr.invoice_id
    WHERE tr.tax_id = v_tax.id
      AND i.status = 'posted'
      AND NOT EXISTS (
        SELECT 1 FROM public.tax_transactions tt
        WHERE tt.source_type = 'invoice' AND tt.source_id = i.id
          AND tt.tax_code_id = v_code_id
      );
  END LOOP;
END $$;
