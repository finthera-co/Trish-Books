
-- 1. Snapshots table
CREATE TABLE public.reconciliation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounts(id),
  as_of_date date NOT NULL,
  bank_balance numeric NOT NULL DEFAULT 0,
  ledger_balance numeric NOT NULL DEFAULT 0,
  cleared_balance numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  bank_txn_count integer NOT NULL DEFAULT 0,
  ledger_line_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','locked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id)
);

CREATE INDEX idx_recon_snapshots_recon ON public.reconciliation_snapshots(reconciliation_id);
CREATE INDEX idx_recon_snapshots_tenant ON public.reconciliation_snapshots(tenant_id);

ALTER TABLE public.reconciliation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_view_snapshots" ON public.reconciliation_snapshots
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "tenant_insert_snapshots" ON public.reconciliation_snapshots
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Block updates and deletes (immutable audit)
CREATE OR REPLACE FUNCTION public.block_snapshot_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation_snapshots is immutable: % not allowed', TG_OP;
END;$$;

CREATE TRIGGER trg_block_snapshot_update BEFORE UPDATE ON public.reconciliation_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.block_snapshot_immutable();
CREATE TRIGGER trg_block_snapshot_delete BEFORE DELETE ON public.reconciliation_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.block_snapshot_immutable();

-- 2. State machine column on bank_feed_transactions
ALTER TABLE public.bank_feed_transactions
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'unmatched'
  CHECK (state IN ('unmatched','suggested','matched','cleared','verified','reconciled','locked'));

CREATE INDEX IF NOT EXISTS idx_bft_state ON public.bank_feed_transactions(state);

-- 3. Lock columns on bank_reconciliations
ALTER TABLE public.bank_reconciliations
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.users(id);

-- Block edits to locked reconciliations
CREATE OR REPLACE FUNCTION public.block_locked_reconciliation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Reconciliation % is locked and cannot be modified', OLD.id;
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_block_locked_recon ON public.bank_reconciliations;
CREATE TRIGGER trg_block_locked_recon BEFORE UPDATE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.block_locked_reconciliation();

-- 4. Invariant log
CREATE TABLE public.reconciliation_invariant_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  invariant_name text NOT NULL,
  expected numeric,
  actual numeric,
  delta numeric,
  passed boolean NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_log_recon ON public.reconciliation_invariant_log(reconciliation_id);

ALTER TABLE public.reconciliation_invariant_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_view_invlog" ON public.reconciliation_invariant_log
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "tenant_insert_invlog" ON public.reconciliation_invariant_log
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE OR REPLACE FUNCTION public.block_invlog_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation_invariant_log is immutable: % not allowed', TG_OP;
END;$$;

CREATE TRIGGER trg_block_invlog_update BEFORE UPDATE ON public.reconciliation_invariant_log
  FOR EACH ROW EXECUTE FUNCTION public.block_invlog_immutable();
CREATE TRIGGER trg_block_invlog_delete BEFORE DELETE ON public.reconciliation_invariant_log
  FOR EACH ROW EXECUTE FUNCTION public.block_invlog_immutable();
