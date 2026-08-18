-- ═══════════════════════════════════════════════════════════════════════════
-- Reverse depreciation postings, keep asset opening balances
--
-- The COA asset-adoption catch-up run (20260818120000_asset_registry_auto_adopt.sql)
-- posted one system-generated journal entry per tenant per period
-- (journal_entries.source_type = 'depreciation', unique_key LIKE 'dep_%') to
-- charge depreciation on newly-registered PP&E. This migration strips those
-- postings back out of the ledger while leaving the asset register's opening
-- balances untouched:
--   • fixed_assets.cost / acquisition_date / source_journal_line_id — kept
--   • asset_subledger 'acquisition' rows                            — kept
--   • journal_lines the original PP&E purchase posted                — kept
-- and undoes only what the catch-up run added:
--   • journal_entries / journal_lines with source_type = 'depreciation'
--   • asset_subledger rows with transaction_type = 'depreciation'
--   • fixed_assets.accumulated_depreciation reset to 0
--   • asset_depreciation schedule rows unlinked back to 'pending'
-- so post_depreciation_period can be re-run later if desired.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_je_count  INTEGER;
  v_fa_count  INTEGER;
BEGIN
  SELECT count(*) INTO v_je_count
  FROM journal_entries WHERE source_type = 'depreciation';

  IF v_je_count = 0 THEN
    RAISE NOTICE 'No depreciation journal entries found — nothing to reverse.';
    RETURN;
  END IF;

  -- 1. Sub-ledger movement rows tied to the depreciation journal lines.
  DELETE FROM asset_subledger sl
  USING journal_lines jl, journal_entries je
  WHERE sl.journal_line_id = jl.id
    AND jl.journal_entry_id = je.id
    AND je.source_type = 'depreciation';

  -- 2. Unlink the per-period schedule so it can be reposted later; the plan
  --    itself (depreciation_amount / accumulated_depreciation / net_book_value
  --    per period) is left as-is, only its posted status is undone.
  UPDATE asset_depreciation ad
  SET status = 'pending', journal_entry_id = NULL
  FROM journal_entries je
  WHERE ad.journal_entry_id = je.id
    AND je.source_type = 'depreciation';

  -- 3. The journal lines and entries themselves.
  DELETE FROM journal_lines jl
  USING journal_entries je
  WHERE jl.journal_entry_id = je.id
    AND je.source_type = 'depreciation';

  DELETE FROM journal_entries WHERE source_type = 'depreciation';

  -- 4. Reset accumulated depreciation on affected assets; only assets whose
  --    status was driven by depreciation ('fully_depreciated') go back to
  --    'active' — disposed/impaired assets (a separate event) are untouched.
  UPDATE fixed_assets
  SET accumulated_depreciation = 0,
      status = CASE WHEN status = 'fully_depreciated' THEN 'active' ELSE status END
  WHERE accumulated_depreciation > 0;
  GET DIAGNOSTICS v_fa_count = ROW_COUNT;

  RAISE NOTICE 'Reversed % depreciation journal entries; reset accumulated depreciation on % assets. Asset cost / opening balances untouched.',
    v_je_count, v_fa_count;
END $$;
