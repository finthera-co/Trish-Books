-- ─────────────────────────────────────────────────────────────────────────────
-- AR receipts + credit notes: industrial-grade hardening
--
--  A. payments_received becomes a first-class receipt header: tenant/customer
--     stamped, one receipt can settle MANY invoices via
--     payment_received_allocations (mirrors AP's bill_payment_allocations),
--     carries currency/FX, a status lifecycle (posted → voided), and an
--     idempotency request_id so a double-click can never record twice.
--     All writes move server-side (post-payment-received edge function);
--     client write policies are dropped.
--  B. ar_credit_notes gets line items (ar_credit_note_items), document totals,
--     a draft → posted → voided lifecycle, and the SAME tiered approval
--     machinery as invoices (threshold, tiers, appointed approvers, SoD,
--     tamper-proof columns, append-only history). Posted notes are immutable.
--  C. AR reversal machinery: new ar_transaction_type values PAYMENT_REVERSAL /
--     CREDIT_NOTE_REVERSAL restore invoice outstanding + customer balance so
--     bounced-cheque (NSF) voids are first-class.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- C1. Enum extensions (usable after this transaction commits; nothing below
--     inserts rows with the new values)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TYPE ar_transaction_type ADD VALUE IF NOT EXISTS 'PAYMENT_REVERSAL';
ALTER TYPE ar_transaction_type ADD VALUE IF NOT EXISTS 'CREDIT_NOTE_REVERSAL';

-- ═══════════════════════════════════════════════════════════════════════════
-- A1. payments_received: receipt-header columns
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.payments_received
  ADD COLUMN IF NOT EXISTS tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS customer_id     UUID REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS payment_number  TEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  ADD COLUMN IF NOT EXISTS currency        TEXT NOT NULL DEFAULT 'LKR',
  ADD COLUMN IF NOT EXISTS exchange_rate   NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unapplied_amount NUMERIC NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
  ADD COLUMN IF NOT EXISTS deposit_id      UUID REFERENCES public.customer_deposits(id),
  ADD COLUMN IF NOT EXISTS funded_by_deposit_id UUID REFERENCES public.customer_deposits(id),
  ADD COLUMN IF NOT EXISTS request_id      UUID,
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS voided_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by       UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason     TEXT,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES public.journal_entries(id);

COMMENT ON COLUMN public.payments_received.deposit_id IS
  'Customer deposit CREATED from this receipt''s overpayment remainder.';
COMMENT ON COLUMN public.payments_received.funded_by_deposit_id IS
  'Deposit this receipt was FUNDED from (deposit application; no bank movement).';

-- Backfill tenant/customer from the linked invoice (invoice_id was NOT NULL
-- for every historical row).
UPDATE public.payments_received p
SET tenant_id   = COALESCE(p.tenant_id, i.tenant_id),
    customer_id = COALESCE(p.customer_id, i.customer_id)
FROM public.invoices i
WHERE i.id = p.invoice_id
  AND (p.tenant_id IS NULL OR p.customer_id IS NULL);

-- Orphans (invoice deleted via CASCADE race) cannot be tenant-attributed;
-- there should be none, but guard the NOT NULL promotion.
DELETE FROM public.payments_received WHERE tenant_id IS NULL;
ALTER TABLE public.payments_received ALTER COLUMN tenant_id SET NOT NULL;

-- A receipt may now settle many invoices → header link becomes optional.
-- (Kept populated when a receipt settles exactly one invoice, for legacy reads.)
ALTER TABLE public.payments_received ALTER COLUMN invoice_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_received_tenant_cust
  ON public.payments_received (tenant_id, customer_id, payment_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_received_request
  ON public.payments_received (tenant_id, request_id)
  WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_received_number
  ON public.payments_received (tenant_id, payment_number)
  WHERE payment_number IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- A2. payment_received_allocations — one receipt, many invoices
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payment_received_allocations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id  UUID NOT NULL REFERENCES public.payments_received(id) ON DELETE CASCADE,
  invoice_id  UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  -- Document-currency amount of AR relieved on this invoice.
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  -- Base-currency (LKR) amount at the INVOICE's booked rate (clears AR at cost).
  amount_base NUMERIC NOT NULL CHECK (amount_base > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_allocation UNIQUE (payment_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_pra_invoice ON public.payment_received_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS idx_pra_payment ON public.payment_received_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_pra_tenant  ON public.payment_received_allocations (tenant_id);

ALTER TABLE public.payment_received_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pra_select ON public.payment_received_allocations;
CREATE POLICY pra_select ON public.payment_received_allocations
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
-- No write policies: allocations are written only by the service-role edge
-- function so they can never drift from the journal they mirror.
GRANT SELECT ON public.payment_received_allocations TO authenticated;

-- Backfill: every historical payment settled exactly one invoice.
INSERT INTO public.payment_received_allocations (tenant_id, payment_id, invoice_id, amount, amount_base)
SELECT p.tenant_id, p.id, p.invoice_id, p.amount,
       ROUND(p.amount * COALESCE(i.exchange_rate, 1), 2)
FROM public.payments_received p
JOIN public.invoices i ON i.id = p.invoice_id
WHERE p.invoice_id IS NOT NULL
  AND p.amount > 0
ON CONFLICT (payment_id, invoice_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- A3. payments_received RLS: reads stay tenant-wide, writes go server-side only
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can view own tenant payments received" ON public.payments_received;
DROP POLICY IF EXISTS "Authorized users can manage payments received" ON public.payments_received;
CREATE POLICY "payments_received_select" ON public.payments_received
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- A4. Receipt numbering: atomic per-tenant/year counter (RCP-YYYY-NNNN)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.receipt_counters (
  tenant_id   UUID    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);
ALTER TABLE public.receipt_counters ENABLE ROW LEVEL SECURITY;
-- Counter is only touched via the SECURITY DEFINER RPC (RLS denies direct access).

CREATE OR REPLACE FUNCTION public.next_receipt_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.receipt_counters (tenant_id, year, last_number)
  VALUES (p_tenant_id, v_year, 1)
  ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_number = public.receipt_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'RCP-' || v_year::TEXT || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_receipt_number(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.next_receipt_number(UUID) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- A5. Posted receipts are immutable except the void transition
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.block_posted_payment_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Receipts cannot be deleted. Void receipt % instead.', COALESCE(OLD.payment_number, OLD.id::text);
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'Receipt % is voided and immutable.', COALESCE(OLD.payment_number, OLD.id::text);
  END IF;

  -- posted → voided may only stamp the void columns; every financial field is frozen.
  IF NEW.amount        IS DISTINCT FROM OLD.amount
     OR NEW.payment_date  IS DISTINCT FROM OLD.payment_date
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
     OR NEW.ar_account_id   IS DISTINCT FROM OLD.ar_account_id
     OR NEW.wht_amount      IS DISTINCT FROM OLD.wht_amount
     OR NEW.currency        IS DISTINCT FROM OLD.currency
     OR NEW.exchange_rate   IS DISTINCT FROM OLD.exchange_rate
     OR NEW.customer_id     IS DISTINCT FROM OLD.customer_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     -- journal_entry_id is write-once: the posting flow stamps it right after
     -- the JE is created; it can never change afterwards.
     OR (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'Posted receipt % is immutable. Void it instead.', COALESCE(OLD.payment_number, OLD.id::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_posted_payment_edits ON public.payments_received;
CREATE TRIGGER trg_block_posted_payment_edits
  BEFORE UPDATE OR DELETE ON public.payments_received
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_payment_edits();

-- Allocations mirror a posted journal: append-only, removed only with their receipt.
CREATE OR REPLACE FUNCTION public.block_allocation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allow the cascade when the parent receipt row is gone (should not happen
    -- in practice; receipts are voided, never deleted).
    IF EXISTS (SELECT 1 FROM public.payments_received WHERE id = OLD.payment_id) THEN
      RAISE EXCEPTION 'Payment allocations are immutable. Void the receipt instead.';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Payment allocations are immutable. Void the receipt instead.';
END;
$$;
DROP TRIGGER IF EXISTS trg_block_allocation_mutation ON public.payment_received_allocations;
CREATE TRIGGER trg_block_allocation_mutation
  BEFORE UPDATE OR DELETE ON public.payment_received_allocations
  FOR EACH ROW EXECUTE FUNCTION public.block_allocation_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- A6. customer_deposits: allow a 'voided' terminal state (overpayment deposits
--     die with their receipt) + trace which receipt created a deposit
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.customer_deposits DROP CONSTRAINT IF EXISTS customer_deposits_status_check;
ALTER TABLE public.customer_deposits
  ADD CONSTRAINT customer_deposits_status_check
  CHECK (status IN ('unapplied','partially_applied','applied','voided'));
ALTER TABLE public.customer_deposits
  ADD COLUMN IF NOT EXISTS source_payment_id UUID REFERENCES public.payments_received(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- B1. ar_credit_notes: document totals, lifecycle, approval columns
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.ar_credit_notes
  ADD COLUMN IF NOT EXISTS subtotal        NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount      NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency        TEXT NOT NULL DEFAULT 'LKR',
  ADD COLUMN IF NOT EXISTS exchange_rate   NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS posted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by       UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS voided_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by       UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason     TEXT,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approved_by     UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note   TEXT,
  ADD COLUMN IF NOT EXISTS required_approvals INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approvals_count INTEGER NOT NULL DEFAULT 0;

-- Lifecycle: historical rows were auto-posted at creation ('applied') — map to
-- 'posted'. New notes are created 'draft' and posted server-side.
UPDATE public.ar_credit_notes SET status = 'posted' WHERE status = 'applied';
UPDATE public.ar_credit_notes SET subtotal = amount WHERE subtotal = 0 AND amount > 0;
ALTER TABLE public.ar_credit_notes DROP CONSTRAINT IF EXISTS ar_credit_notes_status_check;
ALTER TABLE public.ar_credit_notes
  ADD CONSTRAINT ar_credit_notes_status_check CHECK (status IN ('draft','posted','voided'));
ALTER TABLE public.ar_credit_notes ALTER COLUMN status SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS idx_ar_cn_tenant_status ON public.ar_credit_notes (tenant_id, status);

-- Per-tenant unique numbers (was previously unenforced).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_cn_number
  ON public.ar_credit_notes (tenant_id, credit_note_number);

-- ═══════════════════════════════════════════════════════════════════════════
-- B2. ar_credit_note_items — line-level detail with tax codes + restock flag
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ar_credit_note_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id    UUID NOT NULL REFERENCES public.ar_credit_notes(id) ON DELETE CASCADE,
  description       TEXT,
  quantity          NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price        NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_amount   NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  is_tax_inclusive  BOOLEAN NOT NULL DEFAULT false,
  account_id        UUID REFERENCES public.accounts(id),
  product_id        UUID REFERENCES public.products(id),
  inventory_item_id UUID REFERENCES public.inventory_items(id),
  tax_code_id       UUID REFERENCES public.tax_codes(id),
  tax_group_id      UUID REFERENCES public.tax_groups(id),
  -- When true and the product is inventory-tracked, posting returns the goods
  -- to stock (Dr Inventory / Cr COGS + a 'return' stock movement).
  restock           BOOLEAN NOT NULL DEFAULT false,
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ar_cn_items_parent ON public.ar_credit_note_items (credit_note_id);

ALTER TABLE public.ar_credit_note_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ar_cn_items_rw ON public.ar_credit_note_items;
CREATE POLICY ar_cn_items_rw ON public.ar_credit_note_items
  FOR ALL TO authenticated
  USING (credit_note_id IN (SELECT id FROM public.ar_credit_notes WHERE tenant_id = public.get_user_tenant_id()))
  WITH CHECK (credit_note_id IN (SELECT id FROM public.ar_credit_notes WHERE tenant_id = public.get_user_tenant_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ar_credit_note_items TO authenticated;

-- Lines are editable only while the parent note is a draft.
CREATE OR REPLACE FUNCTION public.block_posted_credit_note_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_cn_id  UUID := COALESCE(NEW.credit_note_id, OLD.credit_note_id);
BEGIN
  SELECT status INTO v_status FROM public.ar_credit_notes WHERE id = v_cn_id;
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot modify lines of a % credit note.', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_block_posted_cn_lines ON public.ar_credit_note_items;
CREATE TRIGGER trg_block_posted_cn_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.ar_credit_note_items
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_credit_note_lines();

-- ═══════════════════════════════════════════════════════════════════════════
-- B3. Posted credit notes are immutable (void is the only exit)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.block_posted_credit_note_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Cannot delete % credit note %. Void it instead.', OLD.status, OLD.credit_note_number;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'Credit note % is voided and immutable.', OLD.credit_note_number;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.amount           IS DISTINCT FROM OLD.amount
       OR NEW.subtotal      IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_amount    IS DISTINCT FROM OLD.tax_amount
       OR NEW.credit_date   IS DISTINCT FROM OLD.credit_date
       OR NEW.customer_id   IS DISTINCT FROM OLD.customer_id
       OR NEW.invoice_id    IS DISTINCT FROM OLD.invoice_id
       OR NEW.currency      IS DISTINCT FROM OLD.currency
       OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
       OR NEW.credit_note_number IS DISTINCT FROM OLD.credit_note_number
       OR NEW.journal_entry_id   IS DISTINCT FROM OLD.journal_entry_id THEN
      RAISE EXCEPTION 'Posted credit note % is immutable. Void it instead.', OLD.credit_note_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_posted_cn_edits ON public.ar_credit_notes;
CREATE TRIGGER trg_block_posted_cn_edits
  BEFORE UPDATE OR DELETE ON public.ar_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_credit_note_edits();

-- ═══════════════════════════════════════════════════════════════════════════
-- B4. Credit-note approval: same machinery as invoices
--     Threshold: credit_note_approval_threshold, falling back to the invoice
--     threshold (a credit note is at least as risky as the invoice it undoes).
--     Tiers + appointed approvers are shared with invoices.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS credit_note_approval_threshold NUMERIC;
COMMENT ON COLUMN public.account_settings.credit_note_approval_threshold IS
  'BASE-currency total at/above which a credit note needs approval. NULL → falls back to invoice_approval_threshold.';

CREATE TABLE IF NOT EXISTS public.credit_note_approval_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id UUID NOT NULL REFERENCES public.ar_credit_notes(id) ON DELETE CASCADE,
  actor_id       UUID REFERENCES public.users(id),
  action         TEXT NOT NULL CHECK (action IN ('submitted','approved','rejected')),
  note           TEXT,
  amount_base    NUMERIC,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cn_approval_hist ON public.credit_note_approval_history (credit_note_id, created_at);
ALTER TABLE public.credit_note_approval_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cn_approval_hist_select ON public.credit_note_approval_history;
CREATE POLICY cn_approval_hist_select ON public.credit_note_approval_history
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
GRANT SELECT ON public.credit_note_approval_history TO authenticated;

-- Reassessment: runs on insert and whenever the money fields change (drafts only;
-- the immutability trigger blocks money changes after posting).
CREATE OR REPLACE FUNCTION public.set_credit_note_approval_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_threshold NUMERIC;
  v_tiers     JSONB;
  v_base      NUMERIC;
  v_required  INTEGER := 0;
BEGIN
  SELECT COALESCE(credit_note_approval_threshold, invoice_approval_threshold),
         invoice_approval_tiers
    INTO v_threshold, v_tiers
  FROM public.account_settings WHERE tenant_id = NEW.tenant_id;

  v_base := NEW.amount * COALESCE(NEW.exchange_rate, 1);

  SELECT COALESCE(MAX((t->>'required_approvals')::int), 0) INTO v_required
  FROM jsonb_array_elements(COALESCE(v_tiers, '[]'::jsonb)) t
  WHERE v_base >= (t->>'min_amount')::numeric;

  IF v_required = 0 AND v_threshold IS NOT NULL AND v_threshold > 0 AND v_base >= v_threshold THEN
    v_required := 1;
  END IF;

  IF v_required > 0 THEN
    NEW.approval_status := 'pending';
    NEW.required_approvals := v_required;
  ELSE
    NEW.approval_status := 'not_required';
    NEW.required_approvals := 0;
  END IF;

  NEW.approvals_count := 0;
  NEW.approved_by := NULL;
  NEW.approved_at := NULL;
  NEW.approval_note := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cn_approval ON public.ar_credit_notes;
CREATE TRIGGER trg_cn_approval
  BEFORE INSERT OR UPDATE OF amount, exchange_rate ON public.ar_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_credit_note_approval_status();

-- Tamper guard: approval columns only move via approve_credit_note();
-- created_by is write-once. Fires before the reassessment trigger ('a' prefix).
CREATE OR REPLACE FUNCTION public.guard_credit_note_approval_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable' USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by)
     OR (NEW.approval_status IS DISTINCT FROM OLD.approval_status
         AND NEW.approval_status IN ('approved','rejected')) THEN
    IF current_setting('app.credit_note_approving', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'approval_status can only be changed via approve_credit_note()' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS a_guard_cn_approval ON public.ar_credit_notes;
CREATE TRIGGER a_guard_cn_approval
  BEFORE UPDATE ON public.ar_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_approval_columns();

-- Round marker + notify appointed approvers (same pool as invoices).
CREATE OR REPLACE FUNCTION public.notify_credit_note_approvers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status = 'pending'
     AND (TG_OP = 'INSERT'
          OR OLD.approval_status IS DISTINCT FROM NEW.approval_status
          OR OLD.amount        IS DISTINCT FROM NEW.amount
          OR OLD.exchange_rate IS DISTINCT FROM NEW.exchange_rate) THEN

    INSERT INTO public.credit_note_approval_history (tenant_id, credit_note_id, actor_id, action, note, amount_base)
    VALUES (NEW.tenant_id, NEW.id, NEW.created_by, 'submitted', NULL,
            NEW.amount * COALESCE(NEW.exchange_rate, 1));

    INSERT INTO public.notifications (tenant_id, user_id, type, title, message, link)
    SELECT NEW.tenant_id, e.user_id, 'warning', 'Credit note needs approval',
           'Credit note ' || NEW.credit_note_number || ' needs approval (' ||
           NEW.required_approvals || ' approver' || CASE WHEN NEW.required_approvals > 1 THEN 's' ELSE '' END ||
           ') before it can be posted.',
           '/accounting/credit-notes'
    FROM public.eligible_invoice_approvers(NEW.tenant_id) e
    WHERE e.user_id <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_cn_approvers ON public.ar_credit_notes;
CREATE TRIGGER trg_notify_cn_approvers
  AFTER INSERT OR UPDATE OF approval_status, amount, exchange_rate ON public.ar_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.notify_credit_note_approvers();

-- approve_credit_note(): N distinct approvers per round, SoD, reason-required
-- rejections, append-only history — mirrors approve_invoice().
CREATE OR REPLACE FUNCTION public.approve_credit_note(
  p_credit_note_id UUID,
  p_decision       TEXT,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_cn          public.ar_credit_notes;
  v_is_eligible BOOLEAN;
  v_eligible_n  INTEGER;
  v_self        BOOLEAN;
  v_note        TEXT;
  v_base        NUMERIC;
  v_submitted   TIMESTAMPTZ;
  v_collected   INTEGER;
  v_required    INTEGER;
  v_final       BOOLEAN;
BEGIN
  SELECT u.id, u.tenant_id INTO v_user_id, v_tenant_id
  FROM public.users u WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'BAD_DECISION'; END IF;
  IF p_decision = 'rejected' AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: a reason is required to reject' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cn FROM public.ar_credit_notes WHERE id = p_credit_note_id AND tenant_id = v_tenant_id;
  IF v_cn.id IS NULL THEN RAISE EXCEPTION 'CREDIT_NOTE_NOT_FOUND'; END IF;
  IF v_cn.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_PENDING: credit note is %', v_cn.approval_status USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.eligible_invoice_approvers(v_tenant_id) e WHERE e.user_id = v_user_id),
         (SELECT count(*) FROM public.eligible_invoice_approvers(v_tenant_id))
    INTO v_is_eligible, v_eligible_n;
  IF NOT v_is_eligible THEN
    RAISE EXCEPTION 'NOT_AN_APPROVER: you are not appointed to approve credit notes' USING ERRCODE = 'P0001';
  END IF;

  v_self := v_cn.created_by IS NOT NULL AND v_cn.created_by = v_user_id;
  IF v_self AND v_eligible_n > 1 THEN
    RAISE EXCEPTION 'SEGREGATION_OF_DUTIES: the approver cannot be the credit-note creator' USING ERRCODE = 'P0001';
  END IF;
  v_base := v_cn.amount * COALESCE(v_cn.exchange_rate, 1);
  v_note := CASE WHEN v_self THEN COALESCE(p_note || ' ', '') || '[self-approved: sole eligible approver]' ELSE p_note END;

  PERFORM set_config('app.credit_note_approving', '1', true);

  IF p_decision = 'rejected' THEN
    UPDATE public.ar_credit_notes
       SET approval_status = 'rejected', approved_by = v_user_id, approved_at = now(), approval_note = v_note
     WHERE id = p_credit_note_id;
    INSERT INTO public.credit_note_approval_history (tenant_id, credit_note_id, actor_id, action, note, amount_base)
    VALUES (v_tenant_id, p_credit_note_id, v_user_id, 'rejected', v_note, v_base);
    INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
    VALUES ('Credit Note Rejected', 'ar_credit_notes', p_credit_note_id, v_user_id, v_tenant_id,
            jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'note', v_note));
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  SELECT max(created_at) INTO v_submitted
  FROM public.credit_note_approval_history WHERE credit_note_id = p_credit_note_id AND action = 'submitted';

  IF EXISTS (
    SELECT 1 FROM public.credit_note_approval_history
    WHERE credit_note_id = p_credit_note_id AND action = 'approved' AND actor_id = v_user_id
      AND (v_submitted IS NULL OR created_at >= v_submitted)
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED: you have already approved this credit note' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.credit_note_approval_history (tenant_id, credit_note_id, actor_id, action, note, amount_base)
  VALUES (v_tenant_id, p_credit_note_id, v_user_id, 'approved', p_note, v_base);

  SELECT count(DISTINCT actor_id) INTO v_collected
  FROM public.credit_note_approval_history
  WHERE credit_note_id = p_credit_note_id AND action = 'approved'
    AND (v_submitted IS NULL OR created_at >= v_submitted);

  v_required := GREATEST(v_cn.required_approvals, 1);
  v_final := v_collected >= v_required;

  IF v_final THEN
    UPDATE public.ar_credit_notes
       SET approval_status = 'approved', approved_by = v_user_id, approved_at = now(),
           approval_note = v_note, approvals_count = v_collected
     WHERE id = p_credit_note_id;
  ELSE
    UPDATE public.ar_credit_notes SET approvals_count = v_collected WHERE id = p_credit_note_id;
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, tenant_id, details)
  VALUES ('Credit Note Approved', 'ar_credit_notes', p_credit_note_id, v_user_id, v_tenant_id,
          jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'collected', v_collected,
                             'required', v_required, 'final', v_final, 'self_approved', v_self));

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_final THEN 'approved' ELSE 'pending' END,
                            'collected', v_collected, 'required', v_required, 'final', v_final);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_credit_note(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_credit_note(UUID, TEXT, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- C2. Reversal-aware sub-ledger triggers
-- ═══════════════════════════════════════════════════════════════════════════
-- Apply/unapply against the linked invoice transaction.
CREATE OR REPLACE FUNCTION fn_apply_ar_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new_outstanding NUMERIC(15,2);
BEGIN
  IF NEW.related_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_type IN ('PAYMENT', 'CREDIT_NOTE', 'WRITE_OFF') THEN
    UPDATE ar_transactions
    SET
      outstanding_amount = GREATEST(0, outstanding_amount - NEW.amount),
      status = CASE
        WHEN NEW.transaction_type = 'WRITE_OFF'
          THEN 'WRITTEN_OFF'::ar_transaction_status
        WHEN GREATEST(0, outstanding_amount - NEW.amount) = 0
          THEN 'PAID'::ar_transaction_status
        ELSE 'PARTIALLY_PAID'::ar_transaction_status
      END,
      updated_at = NOW()
    WHERE id = NEW.related_transaction_id
      AND tenant_id = NEW.tenant_id;

  ELSIF NEW.transaction_type IN ('PAYMENT_REVERSAL', 'CREDIT_NOTE_REVERSAL') THEN
    -- Restore outstanding (capped at the original amount) and re-open the doc.
    UPDATE ar_transactions
    SET
      outstanding_amount = LEAST(amount, outstanding_amount + NEW.amount),
      status = CASE
        WHEN LEAST(amount, outstanding_amount + NEW.amount) >= amount
          THEN 'OPEN'::ar_transaction_status
        ELSE 'PARTIALLY_PAID'::ar_transaction_status
      END,
      updated_at = NOW()
    WHERE id = NEW.related_transaction_id
      AND tenant_id = NEW.tenant_id
    RETURNING outstanding_amount INTO v_new_outstanding;
  END IF;

  RETURN NEW;
END;
$$;

-- Customer running balance: reversals add the money back.
CREATE OR REPLACE FUNCTION fn_update_customer_ar_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta NUMERIC(15,2) := 0;
BEGIN
  CASE NEW.transaction_type
    WHEN 'INVOICE'              THEN v_delta :=  NEW.amount;
    WHEN 'PAYMENT'              THEN v_delta := -NEW.amount;
    WHEN 'CREDIT_NOTE'          THEN v_delta := -NEW.amount;
    WHEN 'WRITE_OFF'            THEN v_delta := -NEW.amount;
    WHEN 'ADJUSTMENT'           THEN v_delta :=  NEW.amount;
    WHEN 'PAYMENT_REVERSAL'     THEN v_delta :=  NEW.amount;
    WHEN 'CREDIT_NOTE_REVERSAL' THEN v_delta :=  NEW.amount;
    ELSE v_delta := 0;
  END CASE;

  INSERT INTO customer_accounts (tenant_id, customer_id, current_balance)
  VALUES (NEW.tenant_id, NEW.customer_id, v_delta)
  ON CONFLICT (tenant_id, customer_id)
  DO UPDATE SET current_balance = customer_accounts.current_balance + v_delta,
                updated_at      = NOW();

  RETURN NEW;
END;
$$;
