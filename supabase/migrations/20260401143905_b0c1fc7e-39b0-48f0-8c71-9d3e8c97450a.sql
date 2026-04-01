
-- ═══════════════════════════════════════════════════════
-- PART 1: journal_entries — add source linking + posted_at
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON public.journal_entries (source_type, source_id);

-- ═══════════════════════════════════════════════════════
-- PART 2: journal_lines — add entity linking columns
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS vendor_id uuid,
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS asset_id uuid;

CREATE INDEX IF NOT EXISTS idx_journal_lines_customer ON public.journal_lines (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_vendor ON public.journal_lines (vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_item ON public.journal_lines (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_asset ON public.journal_lines (asset_id) WHERE asset_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════
-- PART 3: ar_subledger — add document linking + debit/credit/balance
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.ar_subledger
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journal_id uuid;

CREATE INDEX IF NOT EXISTS idx_ar_subledger_document ON public.ar_subledger (document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_ar_subledger_journal ON public.ar_subledger (journal_id);
CREATE INDEX IF NOT EXISTS idx_ar_subledger_tenant ON public.ar_subledger (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ar_subledger_customer ON public.ar_subledger (customer_id);

-- ═══════════════════════════════════════════════════════
-- PART 4: ap_subledger — add document linking + debit/credit/balance
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.ap_subledger
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journal_id uuid;

CREATE INDEX IF NOT EXISTS idx_ap_subledger_document ON public.ap_subledger (document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_ap_subledger_journal ON public.ap_subledger (journal_id);
CREATE INDEX IF NOT EXISTS idx_ap_subledger_tenant ON public.ap_subledger (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ap_subledger_vendor ON public.ap_subledger (vendor_id);

-- ═══════════════════════════════════════════════════════
-- PART 5: inventory_subledger — add document linking + debit/credit/balance
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.inventory_subledger
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journal_id uuid;

CREATE INDEX IF NOT EXISTS idx_inventory_subledger_document ON public.inventory_subledger (document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_inventory_subledger_journal ON public.inventory_subledger (journal_id);
CREATE INDEX IF NOT EXISTS idx_inventory_subledger_tenant ON public.inventory_subledger (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_subledger_item ON public.inventory_subledger (item_id);

-- ═══════════════════════════════════════════════════════
-- PART 6: asset_subledger — add document linking + debit/credit/balance
-- ═══════════════════════════════════════════════════════

ALTER TABLE public.asset_subledger
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journal_id uuid;

CREATE INDEX IF NOT EXISTS idx_asset_subledger_document ON public.asset_subledger (document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_asset_subledger_journal ON public.asset_subledger (journal_id);
CREATE INDEX IF NOT EXISTS idx_asset_subledger_tenant ON public.asset_subledger (tenant_id);
CREATE INDEX IF NOT EXISTS idx_asset_subledger_asset ON public.asset_subledger (asset_id);
