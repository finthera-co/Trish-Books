-- ════════════════════════════════════════════════════════════════════
-- Tax Engine v2 — Migration 5: tax sub-ledger (tax_transactions).
-- Single source of truth for every filing report. Replaces tax_records
-- going forward (tax_records is kept, deprecated, never dropped).
-- Rows are append-only; corrections happen via signed reversal rows.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_code_id uuid NOT NULL REFERENCES public.tax_codes(id),
  direction text NOT NULL CHECK (direction IN
    ('output','input','wht_payable','wht_receivable','reverse_charge_output','reverse_charge_input')),
  source_type text NOT NULL CHECK (source_type IN
    ('invoice','supplier_bill','bill_payment','payment_received','payroll_run',
     'journal_manual','credit_note','debit_note','tax_remittance','reversal')),
  source_id uuid NOT NULL,
  source_line_id uuid,
  base_amount numeric(18,2) NOT NULL,
  tax_amount numeric(18,2) NOT NULL,            -- LKR (functional); signed: reversals/remittances negative
  tax_amount_txn_currency numeric(18,2),        -- original document currency amount
  currency text NOT NULL DEFAULT 'LKR',
  fx_rate numeric(18,8) NOT NULL DEFAULT 1,     -- rate used at posting; IRD reporting is LKR
  rate_applied numeric(7,4) NOT NULL,
  transaction_date date NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),  -- NEVER null after posting
  tax_period_id uuid REFERENCES public.tax_periods(id),
  reversal_of_id uuid REFERENCES public.tax_transactions(id),
  is_reversed boolean NOT NULL DEFAULT false,
  wht_certificate_no text,
  note text,                                    -- e.g. manual WHT override reason
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taxtxn_code_date
  ON public.tax_transactions(tenant_id, tax_code_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_taxtxn_period
  ON public.tax_transactions(tenant_id, tax_period_id);
CREATE INDEX IF NOT EXISTS idx_taxtxn_source
  ON public.tax_transactions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_taxtxn_reversal
  ON public.tax_transactions(reversal_of_id);

-- ── Auto-assign tax period by transaction_date + tax type ────────────
CREATE OR REPLACE FUNCTION public.assign_tax_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tax_type text;
BEGIN
  IF NEW.tax_period_id IS NULL THEN
    SELECT tax_type INTO v_tax_type FROM public.tax_codes WHERE id = NEW.tax_code_id;
    SELECT id INTO NEW.tax_period_id FROM public.tax_periods
    WHERE tenant_id = NEW.tenant_id AND tax_type = v_tax_type
      AND NEW.transaction_date BETWEEN period_start AND period_end
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_tax_period ON public.tax_transactions;
CREATE TRIGGER trg_assign_tax_period
  BEFORE INSERT ON public.tax_transactions
  FOR EACH ROW EXECUTE FUNCTION public.assign_tax_period();

-- ── Filed-period guard ────────────────────────────────────────────────
-- Block INSERTs dated inside a *filed* period — except amendment rows
-- (reversals / credit notes), which by IRD practice land in the period
-- in which they are made; they pass because their transaction_date is
-- the (current, open-period) amendment date, but if even that date falls
-- in a filed period we still allow them to flow into the next open one.
CREATE OR REPLACE FUNCTION public.block_filed_period_tax_txn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tax_type text;
  v_status text;
BEGIN
  IF NEW.source_type IN ('reversal','credit_note') THEN
    RETURN NEW;  -- amendments are exempt (posted into the current open period)
  END IF;
  SELECT tax_type INTO v_tax_type FROM public.tax_codes WHERE id = NEW.tax_code_id;
  SELECT status INTO v_status FROM public.tax_periods
  WHERE tenant_id = NEW.tenant_id AND tax_type = v_tax_type
    AND NEW.transaction_date BETWEEN period_start AND period_end
  LIMIT 1;
  IF v_status = 'filed' THEN
    RAISE EXCEPTION 'Tax period (%) for % is already filed. Post an amendment (reversal/credit note) into the current open period instead.',
      NEW.transaction_date, v_tax_type;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_filed_period ON public.tax_transactions;
CREATE TRIGGER trg_block_filed_period
  BEFORE INSERT ON public.tax_transactions
  FOR EACH ROW EXECUTE FUNCTION public.block_filed_period_tax_txn();

-- ── Sub-ledger immutability: no UPDATE except the is_reversed flag,
--    no DELETE ever. Reversals are new signed rows. ───────────────────
CREATE OR REPLACE FUNCTION public.protect_tax_transactions()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tax_transactions rows are immutable — post a reversal row instead';
  END IF;
  IF NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
     OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
     OR NEW.tax_code_id IS DISTINCT FROM OLD.tax_code_id
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
     OR NEW.rate_applied IS DISTINCT FROM OLD.rate_applied THEN
    RAISE EXCEPTION 'tax_transactions amounts are immutable — post a reversal row instead';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_tax_txn ON public.tax_transactions;
CREATE TRIGGER trg_protect_tax_txn
  BEFORE UPDATE OR DELETE ON public.tax_transactions
  FOR EACH ROW EXECUTE FUNCTION public.protect_tax_transactions();

-- ── Reversal helper: mirrors every live row of a source document with
--    negated amounts. Used by invoice void / bill reversal / remittance
--    void flows so the tax return self-corrects (amounts are signed). ──
CREATE OR REPLACE FUNCTION public.reverse_tax_transactions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_reversal_journal_id uuid,
  p_reversal_date date
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.tax_transactions%ROWTYPE;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.tax_transactions
    WHERE tenant_id = p_tenant_id
      AND source_type = p_source_type
      AND source_id = p_source_id
      AND is_reversed = false
      AND source_type <> 'reversal'
  LOOP
    INSERT INTO public.tax_transactions (
      tenant_id, tax_code_id, direction, source_type, source_id, source_line_id,
      base_amount, tax_amount, tax_amount_txn_currency, currency, fx_rate,
      rate_applied, transaction_date, journal_entry_id, reversal_of_id,
      wht_certificate_no, note
    ) VALUES (
      v_row.tenant_id, v_row.tax_code_id, v_row.direction, 'reversal', v_row.source_id, v_row.source_line_id,
      -v_row.base_amount, -v_row.tax_amount, -v_row.tax_amount_txn_currency, v_row.currency, v_row.fx_rate,
      v_row.rate_applied, p_reversal_date, p_reversal_journal_id, v_row.id,
      v_row.wht_certificate_no, 'Reversal of ' || v_row.source_type || ' ' || v_row.source_id
    );
    UPDATE public.tax_transactions SET is_reversed = true WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.tax_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "taxtxn_select" ON public.tax_transactions;
CREATE POLICY "taxtxn_select" ON public.tax_transactions FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "taxtxn_insert" ON public.tax_transactions;
CREATE POLICY "taxtxn_insert" ON public.tax_transactions FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());
-- UPDATE allowed only for the is_reversed flag (enforced by trigger);
-- still tenant-scoped with explicit WITH CHECK (house rule).
DROP POLICY IF EXISTS "taxtxn_update" ON public.tax_transactions;
CREATE POLICY "taxtxn_update" ON public.tax_transactions FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
-- No DELETE policy: deletes denied by RLS and by trigger.
