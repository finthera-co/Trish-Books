-- ═══════════════════════════════════════════════════════════════════════════
-- BANK CATEGORIZATION — global canonical-variant seed.
--
-- Variants verified against the real Sampath payment-analysis workbook.
-- tenant_id IS NULL = global rows visible to every tenant (read-only via
-- RLS); tenants extend the map through Suspense Clearing "teach the engine".
-- Idempotent: keyed on the UNIQUE NULLS NOT DISTINCT (tenant_id, raw_variant)
-- constraint. Must stay in sync with DEFAULT_CANONICAL_VARIANTS in
-- src/lib/bankCategorization/canonicalize.ts.
--
-- The category→account map (bank_category_account_map) is intentionally NOT
-- seeded: accounts are tenant-specific, and mappings only grow through
-- human-confirmed choices. Unmapped categories go to Suspense — never guessed.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.bank_category_canonical_map (tenant_id, raw_variant, canonical_category)
VALUES
  (NULL, 'harvest', 'harvest'),
  (NULL, 'harvset', 'harvest'),
  (NULL, 'harvest reverse', 'harvest_reversal'),
  (NULL, 'salary', 'salary'),
  (NULL, 'basic salary', 'salary'),
  (NULL, 'salary reverse', 'salary_reversal'),
  (NULL, 'orc/travelling allowance', 'orc_travelling_allowance'),
  (NULL, 'orc & travel allowance', 'orc_travelling_allowance'),
  (NULL, 'orc & travelling allowance', 'orc_travelling_allowance'),
  (NULL, 'orc & travelling allowane', 'orc_travelling_allowance'),
  (NULL, 'orc/travel allowance', 'orc_travelling_allowance'),
  (NULL, 'orc', 'orc_travelling_allowance'),
  (NULL, 'orc payment', 'orc_travelling_allowance'),
  (NULL, 'travel allowance', 'orc_travelling_allowance'),
  (NULL, 'travel', 'orc_travelling_allowance'),
  (NULL, 'fuel allowance', 'fuel'),
  (NULL, 'bank fee', 'bank_charges'),
  (NULL, 'bank fees', 'bank_charges'),
  (NULL, 'sampath', 'bank_charges'),
  (NULL, 'legal & compliance cost', 'legal_compliance'),
  (NULL, 'lawyer payment', 'legal_compliance'),
  (NULL, 'lawyer payments', 'legal_compliance'),
  (NULL, 'building rent', 'building_rent'),
  (NULL, 'rent', 'building_rent'),
  (NULL, 'car rent', 'vehicle_rent'),
  (NULL, 'vehicle rent', 'vehicle_rent'),
  (NULL, 'welfare', 'welfare'),
  (NULL, 'welfare expense', 'welfare'),
  (NULL, 'delectaa', 'delecta'),
  (NULL, 'deelectaa', 'delecta'),
  (NULL, 'delecta bottle', 'delecta'),
  (NULL, 'other admin expenses', 'admin_other'),
  (NULL, 'other admin expense', 'admin_other'),
  (NULL, 'fixed allowance', 'fixed_allowance'),
  (NULL, 'fixed', 'fixed_allowance'),
  (NULL, 'commission', 'commission'),
  (NULL, 'green crest', 'green_crest'),
  (NULL, 'petty cash', 'petty_cash'),
  (NULL, 'plantation', 'plantation'),
  (NULL, 'plantation operations', 'plantation'),
  (NULL, 'trainning & devolopment', 'training_development'),
  (NULL, 'suspense', 'suspense')
ON CONFLICT (tenant_id, raw_variant) DO NOTHING;
