-- Journal entry read-path indexes.
--
-- Context: a tenant with a bank-statement import now carries ~35k journal_entries
-- and ~70k journal_lines. The list, search and per-account ledger reads all fell
-- back to sorts and seq scans at that volume:
--
--   * paged list, deep page   57 ms  (Incremental Sort over 34,950 rows)
--   * ilike description/ref   52 ms  (Seq Scan, 34,920 rows discarded)
--
-- Both grow linearly with the table, so they get worse with every import.

-- 1. Paging/ordering. The list orders by entry_date desc, created_at desc, id desc
--    within a tenant. idx_journal_entries_entry_date only presorts the first key,
--    leaving an Incremental Sort that has to materialise every row up to the
--    requested offset. A composite in the exact sort order makes it a plain
--    backward index scan.
CREATE INDEX IF NOT EXISTS idx_je_tenant_paging
  ON public.journal_entries (tenant_id, entry_date DESC, created_at DESC, id DESC);

-- 2. Search. description/reference are matched with ILIKE '%term%', which no
--    btree can serve — hence the seq scan. Trigram GIN indexes handle infix
--    matching. (idx_journal_entries_external_ref is btree, so it only helps
--    prefix/equality lookups, not the search box.)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_je_description_trgm
  ON public.journal_entries USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_je_reference_trgm
  ON public.journal_entries USING gin (reference gin_trgm_ops);

-- 3. Per-account ledger. Ledger and AccountReport resolve "which entries touch
--    this account". idx_journal_lines_account_amounts leads with account_id but
--    omits journal_entry_id, so that lookup still needs a heap fetch per line.
--    INCLUDE-ing the join key and amounts keeps it index-only.
CREATE INDEX IF NOT EXISTS idx_jl_account_entry
  ON public.journal_lines (account_id, journal_entry_id) INCLUDE (debit, credit);

-- 4. Status is the other filter applied on every list read, and "posted" is the
--    overwhelming majority, so a partial index on the non-default keeps the
--    Voided tab off a full scan.
CREATE INDEX IF NOT EXISTS idx_je_tenant_voided
  ON public.journal_entries (tenant_id, entry_date DESC)
  WHERE status = 'voided';

ANALYZE public.journal_entries;
ANALYZE public.journal_lines;
