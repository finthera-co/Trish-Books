-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4: AP Sub-Ledger Enhancement
-- Adds: supplier_accounts, ap_transactions, ap_aging_report RPC,
--       ap_reconciliation_check RPC, updated post_supplier_bill
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE ap_transaction_type AS ENUM (
    'INVOICE', 'DEBIT_NOTE', 'PAYMENT', 'PREPAYMENT', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_transaction_status AS ENUM (
    'OPEN', 'PARTIALLY_PAID', 'PAID', 'WRITTEN_OFF'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. supplier_accounts — one row per (tenant, vendor)
CREATE TABLE IF NOT EXISTS supplier_accounts (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  vendor_id           UUID          NOT NULL REFERENCES vendors(id)   ON DELETE CASCADE,
  ap_account_id       UUID          REFERENCES accounts(id),
  payment_terms_days  INTEGER       NOT NULL DEFAULT 30,
  current_balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_accounts_unique UNIQUE (tenant_id, vendor_id)
);

-- 3. ap_transactions — enriched AP sub-ledger
CREATE TABLE IF NOT EXISTS ap_transactions (
  id                     UUID                  DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              UUID                  NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  vendor_id              UUID                  NOT NULL REFERENCES vendors(id)   ON DELETE CASCADE,
  transaction_type       ap_transaction_type   NOT NULL,
  document_id            UUID,
  document_ref           TEXT,
  transaction_date       DATE                  NOT NULL,
  due_date               DATE,
  amount                 NUMERIC(15,2)         NOT NULL DEFAULT 0 CHECK (amount >= 0),
  outstanding_amount     NUMERIC(15,2)         NOT NULL DEFAULT 0,
  status                 ap_transaction_status NOT NULL DEFAULT 'OPEN',
  journal_entry_id       UUID REFERENCES journal_entries(id),
  journal_line_id        UUID REFERENCES journal_lines(id),
  ap_account_id          UUID REFERENCES accounts(id),
  related_transaction_id UUID REFERENCES ap_transactions(id),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_apt_tenant_vendor ON ap_transactions(tenant_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_apt_status        ON ap_transactions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_apt_due_date      ON ap_transactions(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_apt_document      ON ap_transactions(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_sa_tenant         ON supplier_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sa_vendor         ON supplier_accounts(vendor_id);

-- 5. RLS
ALTER TABLE supplier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_transactions    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_iso_supplier_accounts ON supplier_accounts
    USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tenant_iso_ap_transactions ON ap_transactions
    USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Trigger: apply payment / debit_note to linked invoice
CREATE OR REPLACE FUNCTION fn_apply_ap_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_type IN ('PAYMENT', 'DEBIT_NOTE', 'PREPAYMENT')
     AND NEW.related_transaction_id IS NOT NULL THEN
    UPDATE ap_transactions
    SET
      outstanding_amount = GREATEST(0, outstanding_amount - NEW.amount),
      status = CASE
        WHEN GREATEST(0, outstanding_amount - NEW.amount) = 0
          THEN 'PAID'::ap_transaction_status
        ELSE 'PARTIALLY_PAID'::ap_transaction_status
      END,
      updated_at = NOW()
    WHERE id = NEW.related_transaction_id
      AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_ap_payment ON ap_transactions;
CREATE TRIGGER trg_apply_ap_payment
  AFTER INSERT ON ap_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_apply_ap_payment();

-- 7. Trigger: maintain supplier_accounts.current_balance
CREATE OR REPLACE FUNCTION fn_update_supplier_ap_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta NUMERIC(15,2) := 0;
BEGIN
  CASE NEW.transaction_type
    WHEN 'INVOICE'    THEN v_delta :=  NEW.amount;  -- we owe more
    WHEN 'PAYMENT'    THEN v_delta := -NEW.amount;  -- we owe less
    WHEN 'DEBIT_NOTE' THEN v_delta := -NEW.amount;  -- reduces what we owe
    WHEN 'PREPAYMENT' THEN v_delta := -NEW.amount;  -- advance payment
    WHEN 'ADJUSTMENT' THEN v_delta :=  NEW.amount;  -- positive = increase owed
  END CASE;

  INSERT INTO supplier_accounts (tenant_id, vendor_id, current_balance)
  VALUES (NEW.tenant_id, NEW.vendor_id, v_delta)
  ON CONFLICT (tenant_id, vendor_id)
  DO UPDATE SET current_balance = supplier_accounts.current_balance + v_delta,
                updated_at      = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_supplier_ap_balance ON ap_transactions;
CREATE TRIGGER trg_update_supplier_ap_balance
  AFTER INSERT ON ap_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_update_supplier_ap_balance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ap_aging_report RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ap_aging_report(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
  v_result    JSON;
BEGIN
  v_tenant_id := get_user_tenant_id();

  WITH open_invoices AS (
    SELECT
      apt.vendor_id,
      v.name          AS vendor_name,
      apt.outstanding_amount,
      apt.due_date,
      CASE
        WHEN apt.due_date IS NULL OR apt.due_date >= p_as_of_date
          THEN 'current'
        WHEN (p_as_of_date - apt.due_date) BETWEEN 1  AND 30  THEN 'days_1_30'
        WHEN (p_as_of_date - apt.due_date) BETWEEN 31 AND 60  THEN 'days_31_60'
        WHEN (p_as_of_date - apt.due_date) BETWEEN 61 AND 90  THEN 'days_61_90'
        WHEN (p_as_of_date - apt.due_date) BETWEEN 91 AND 120 THEN 'days_91_120'
        ELSE 'over_120'
      END AS bucket
    FROM ap_transactions apt
    JOIN vendors v ON v.id = apt.vendor_id
    WHERE apt.tenant_id = v_tenant_id
      AND apt.transaction_type = 'INVOICE'
      AND apt.status IN ('OPEN', 'PARTIALLY_PAID')
      AND apt.transaction_date <= p_as_of_date
  ),
  aging_by_vendor AS (
    SELECT
      vendor_id,
      vendor_name,
      SUM(CASE WHEN bucket = 'current'     THEN outstanding_amount ELSE 0 END) AS bucket_current,
      SUM(CASE WHEN bucket = 'days_1_30'   THEN outstanding_amount ELSE 0 END) AS days_1_30,
      SUM(CASE WHEN bucket = 'days_31_60'  THEN outstanding_amount ELSE 0 END) AS days_31_60,
      SUM(CASE WHEN bucket = 'days_61_90'  THEN outstanding_amount ELSE 0 END) AS days_61_90,
      SUM(CASE WHEN bucket = 'days_91_120' THEN outstanding_amount ELSE 0 END) AS days_91_120,
      SUM(CASE WHEN bucket = 'over_120'    THEN outstanding_amount ELSE 0 END) AS over_120,
      SUM(outstanding_amount)                                                   AS total
    FROM open_invoices
    GROUP BY vendor_id, vendor_name
    HAVING SUM(outstanding_amount) > 0.005
    ORDER BY SUM(outstanding_amount) DESC
  )
  SELECT json_build_object(
    'rows', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'vendor_id',   abv.vendor_id,
          'vendor_name', abv.vendor_name,
          'current',     abv.bucket_current,
          'days_1_30',   abv.days_1_30,
          'days_31_60',  abv.days_31_60,
          'days_61_90',  abv.days_61_90,
          'days_91_120', abv.days_91_120,
          'over_120',    abv.over_120,
          'total',       abv.total
        ) ORDER BY abv.total DESC
      ) FROM aging_by_vendor abv),
      '[]'::JSON
    ),
    'totals', json_build_object(
      'current',     COALESCE((SELECT SUM(bucket_current) FROM aging_by_vendor), 0),
      'days_1_30',   COALESCE((SELECT SUM(days_1_30)     FROM aging_by_vendor), 0),
      'days_31_60',  COALESCE((SELECT SUM(days_31_60)    FROM aging_by_vendor), 0),
      'days_61_90',  COALESCE((SELECT SUM(days_61_90)    FROM aging_by_vendor), 0),
      'days_91_120', COALESCE((SELECT SUM(days_91_120)   FROM aging_by_vendor), 0),
      'over_120',    COALESCE((SELECT SUM(over_120)      FROM aging_by_vendor), 0),
      'grand_total', COALESCE((SELECT SUM(total)         FROM aging_by_vendor), 0)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION ap_aging_report(DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ap_reconciliation_check RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ap_reconciliation_check(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id         UUID;
  v_subledger_balance NUMERIC(15,2);
  v_gl_balance        NUMERIC(15,2);
  v_variance          NUMERIC(15,2);
BEGIN
  v_tenant_id := get_user_tenant_id();

  -- Outstanding invoices from ap_transactions
  SELECT COALESCE(SUM(outstanding_amount), 0) INTO v_subledger_balance
  FROM ap_transactions
  WHERE tenant_id = v_tenant_id
    AND transaction_type = 'INVOICE'
    AND status IN ('OPEN', 'PARTIALLY_PAID')
    AND transaction_date <= p_as_of_date;

  -- Net credit on GL lines for AP control accounts from posted journal entries
  -- AP is credit-normal (liability), so balance = credit - debit
  SELECT COALESCE(SUM(jl.credit - jl.debit), 0) INTO v_gl_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.tenant_id = v_tenant_id
    AND (
      a.account_subtype ILIKE '%payable%'
      OR a.control_account_type = 'VENDOR'
      OR a.account_code = '2100'
    )
    AND a.account_type = 'Liability'
    AND je.status = 'posted'
    AND je.entry_date <= p_as_of_date;

  v_variance := ROUND(v_subledger_balance - v_gl_balance, 2);

  RETURN json_build_object(
    'subledger_balance', v_subledger_balance,
    'gl_balance',        v_gl_balance,
    'variance',          v_variance,
    'status',            CASE WHEN ABS(v_variance) < 0.01 THEN 'RECONCILED' ELSE 'VARIANCE_DETECTED' END,
    'as_of_date',        p_as_of_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ap_reconciliation_check(DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Updated post_supplier_bill — now also writes to ap_transactions
--     Three-way matching logic is unchanged; only the sub-ledger write is added.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_supplier_bill(p_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_user uuid;
  v_bill supplier_bills%ROWTYPE;
  v_grni uuid; v_ap uuid; v_ppv uuid;
  v_je uuid;
  v_ap_line_id uuid;
  v_line RECORD; v_grnline grn_lines%ROWTYPE;
  v_grn_value numeric(18,2); v_bill_value numeric(18,2); v_variance numeric(18,2);
  v_total numeric(18,2):=0; v_lines_count int:=0;
  v_dr_total numeric(18,2):=0;
  v_settings RECORD;
BEGIN
  SELECT id, tenant_id INTO v_user, v_tenant FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_bill FROM public.supplier_bills WHERE id=p_bill_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.status<>'draft' THEN RAISE EXCEPTION 'Only draft bills can be posted'; END IF;
  IF public.is_period_closed(v_tenant, v_bill.bill_date) THEN
    RAISE EXCEPTION 'Accounting period for % is closed.', v_bill.bill_date;
  END IF;

  SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  SELECT id INTO v_ppv  FROM public.accounts WHERE tenant_id=v_tenant AND account_code='5100' LIMIT 1;
  SELECT * INTO v_settings FROM public.account_settings WHERE tenant_id=v_tenant LIMIT 1;
  v_ap := v_settings.ap_account_id;
  IF v_ap IS NULL THEN
    SELECT id INTO v_ap FROM public.accounts
    WHERE tenant_id=v_tenant AND account_type='Liability'
      AND lower(account_subtype) LIKE '%payable%' AND is_active LIMIT 1;
  END IF;
  IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts Payable not configured. Set it in Account Mapping.'; END IF;
  IF v_grni IS NULL THEN
    PERFORM public.seed_inventory_coa_accounts(v_tenant);
    SELECT id INTO v_grni FROM public.accounts WHERE tenant_id=v_tenant AND account_code='2150' LIMIT 1;
  END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, reference, status, posted_at,
    created_by, source_type, source_id, is_system_generated, entry_type)
  VALUES (v_tenant, v_bill.bill_date, 'Supplier Bill '||v_bill.bill_number, v_bill.bill_number,
    'posted', now(), v_user, 'supplier_bill', v_bill.id, true, 'supplier_bill')
  RETURNING id INTO v_je;

  FOR v_line IN SELECT * FROM public.supplier_bill_lines WHERE bill_id=p_bill_id ORDER BY created_at LOOP
    v_lines_count := v_lines_count + 1;
    v_bill_value := round(v_line.qty * v_line.unit_cost, 2);
    v_total := v_total + v_bill_value;

    IF v_line.grn_line_id IS NOT NULL THEN
      SELECT * INTO v_grnline FROM public.grn_lines WHERE id=v_line.grn_line_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'GRN line not found for line %', v_lines_count; END IF;
      IF v_grnline.tenant_id<>v_tenant THEN RAISE EXCEPTION 'GRN line tenant mismatch'; END IF;
      IF (v_grnline.qty_billed + v_line.qty) > v_grnline.qty_received + 0.0001 THEN
        RAISE EXCEPTION 'Three-way match failed line %: bill qty (%) + already billed (%) exceeds GRN received (%)',
          v_lines_count, v_line.qty, v_grnline.qty_billed, v_grnline.qty_received;
      END IF;

      v_grn_value := round(v_line.qty * v_grnline.unit_cost, 2);
      v_variance  := round(v_bill_value - v_grn_value, 2);

      -- DR GRNI Clearing (reverses GRN posting) / CR AP (net bill value via AP line below)
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_grni, v_grn_value, 0);
      v_dr_total := v_dr_total + v_grn_value;

      -- Purchase Price Variance if bill cost differs from GRN cost
      IF v_variance <> 0 THEN
        IF v_ppv IS NULL THEN RAISE EXCEPTION 'PPV account (5100) not configured'; END IF;
        IF v_variance > 0 THEN
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_ppv, v_variance, 0);
          v_dr_total := v_dr_total + v_variance;
        ELSE
          INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_ppv, 0, -v_variance);
          v_dr_total := v_dr_total + v_variance;
        END IF;
      END IF;

      UPDATE public.grn_lines SET qty_billed = qty_billed + v_line.qty WHERE id = v_grnline.id;
    ELSE
      IF v_line.account_id IS NULL THEN RAISE EXCEPTION 'Line % requires GRN link or account_id', v_lines_count; END IF;
      -- Direct expense posting (non-inventory bill)
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit) VALUES (v_je, v_line.account_id, v_bill_value, 0);
      v_dr_total := v_dr_total + v_bill_value;
    END IF;
  END LOOP;

  IF v_lines_count=0 THEN RAISE EXCEPTION 'Bill must have at least one line'; END IF;

  -- Input Tax Recoverable (DR when applicable)
  IF v_bill.tax_amount > 0 AND v_settings.tax_payable_account_id IS NOT NULL THEN
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
    VALUES (v_je, v_settings.tax_payable_account_id, v_bill.tax_amount, 0);
    v_dr_total := v_dr_total + v_bill.tax_amount;
  END IF;

  -- CR Trade Payables (AP Control)
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit)
  VALUES (v_je, v_ap, 0, v_bill.total_amount)
  RETURNING id INTO v_ap_line_id;

  IF abs(v_dr_total - v_bill.total_amount) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry out of balance. Debits=% AP credit=%. Check tax/PPV configuration.', v_dr_total, v_bill.total_amount;
  END IF;

  UPDATE public.supplier_bills SET status='posted', posted_at=now(), journal_entry_id=v_je WHERE id=p_bill_id;

  -- ── ap_transactions: Phase 4 enriched sub-ledger ───────────────────────────
  -- Trigger fn_update_supplier_ap_balance fires here and updates supplier_accounts
  INSERT INTO public.ap_transactions (
    tenant_id, vendor_id, transaction_type,
    document_id, document_ref,
    transaction_date, due_date,
    amount, outstanding_amount, status,
    journal_entry_id, journal_line_id, ap_account_id
  ) VALUES (
    v_tenant, v_bill.vendor_id, 'INVOICE',
    p_bill_id, v_bill.bill_number,
    v_bill.bill_date, v_bill.due_date,
    v_bill.total_amount, v_bill.total_amount, 'OPEN',
    v_je, v_ap_line_id, v_ap
  );

  RETURN jsonb_build_object('ok',true,'bill_id',p_bill_id,'journal_entry_id',v_je,'total',v_bill.total_amount);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Backfill existing data
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ap_transactions DISABLE TRIGGER trg_update_supplier_ap_balance;

-- Backfill supplier_accounts (net balance from ap_subledger)
INSERT INTO supplier_accounts (tenant_id, vendor_id, payment_terms_days, current_balance)
SELECT
  v.tenant_id,
  v.id,
  30,
  COALESCE(nb.balance, 0)
FROM vendors v
LEFT JOIN (
  SELECT vendor_id, SUM(COALESCE(credit, 0) - COALESCE(debit, 0)) AS balance
  FROM ap_subledger
  GROUP BY vendor_id
) nb ON nb.vendor_id = v.id
ON CONFLICT (tenant_id, vendor_id) DO UPDATE
  SET current_balance   = EXCLUDED.current_balance,
      updated_at        = NOW();

-- Backfill ap_transactions: bill/invoice entries (credit entries in ap_subledger)
INSERT INTO ap_transactions (
  tenant_id, vendor_id, transaction_type,
  document_id, document_ref, transaction_date, due_date,
  amount, outstanding_amount, status,
  journal_entry_id, journal_line_id
)
SELECT
  s.tenant_id,
  s.vendor_id,
  'INVOICE'::ap_transaction_type,
  s.document_id,
  s.bill_no,
  COALESCE(
    CASE WHEN s.due_date IS NOT NULL THEN (s.due_date::DATE - INTERVAL '30 days')::DATE END,
    s.created_at::DATE
  ),
  s.due_date::DATE,
  GREATEST(0, COALESCE(s.credit, 0)),
  GREATEST(0, COALESCE(s.credit, 0)),
  'OPEN'::ap_transaction_status,
  s.journal_id,
  s.journal_line_id
FROM ap_subledger s
WHERE s.document_type IN ('bill', 'opening_balance')
  AND COALESCE(s.credit, 0) > 0;

-- Backfill ap_transactions: payment entries (debit entries in ap_subledger)
INSERT INTO ap_transactions (
  tenant_id, vendor_id, transaction_type,
  document_id, document_ref, transaction_date,
  amount, outstanding_amount, status,
  journal_entry_id, journal_line_id
)
SELECT
  s.tenant_id,
  s.vendor_id,
  CASE s.document_type
    WHEN 'vendor_credit' THEN 'DEBIT_NOTE'::ap_transaction_type
    ELSE 'PAYMENT'::ap_transaction_type
  END,
  s.document_id,
  NULL,
  s.created_at::DATE,
  GREATEST(0, COALESCE(s.debit, 0)),
  0,
  'PAID'::ap_transaction_status,
  s.journal_id,
  s.journal_line_id
FROM ap_subledger s
WHERE s.document_type IN ('bill_payment', 'vendor_credit')
  AND COALESCE(s.debit, 0) > 0;

-- Also backfill from posted supplier_bills that aren't in ap_subledger
INSERT INTO ap_transactions (
  tenant_id, vendor_id, transaction_type,
  document_id, document_ref, transaction_date, due_date,
  amount, outstanding_amount, status,
  journal_entry_id
)
SELECT
  sb.tenant_id,
  sb.vendor_id,
  'INVOICE'::ap_transaction_type,
  sb.id,
  sb.bill_number,
  sb.bill_date,
  sb.due_date,
  sb.total_amount,
  GREATEST(0, sb.total_amount - COALESCE(sb.amount_paid, 0)),
  CASE
    WHEN COALESCE(sb.amount_paid, 0) >= sb.total_amount THEN 'PAID'::ap_transaction_status
    WHEN COALESCE(sb.amount_paid, 0) > 0 THEN 'PARTIALLY_PAID'::ap_transaction_status
    ELSE 'OPEN'::ap_transaction_status
  END,
  sb.journal_entry_id
FROM supplier_bills sb
WHERE sb.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM ap_transactions apt
    WHERE apt.document_id = sb.id
      AND apt.transaction_type = 'INVOICE'
  );

-- Reduce invoice outstanding using total payments per vendor (oldest first)
DO $$
DECLARE
  vend            RECORD;
  inv             RECORD;
  remaining_debit NUMERIC(15,2);
BEGIN
  FOR vend IN
    SELECT DISTINCT tenant_id, vendor_id
    FROM ap_transactions
    WHERE transaction_type IN ('PAYMENT', 'DEBIT_NOTE', 'PREPAYMENT')
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO remaining_debit
    FROM ap_transactions
    WHERE tenant_id   = vend.tenant_id
      AND vendor_id   = vend.vendor_id
      AND transaction_type IN ('PAYMENT', 'DEBIT_NOTE', 'PREPAYMENT');

    FOR inv IN
      SELECT id, outstanding_amount
      FROM ap_transactions
      WHERE tenant_id  = vend.tenant_id
        AND vendor_id  = vend.vendor_id
        AND transaction_type = 'INVOICE'
        AND status IN ('OPEN', 'PARTIALLY_PAID')
      ORDER BY due_date ASC NULLS LAST, created_at ASC
    LOOP
      EXIT WHEN remaining_debit <= 0;

      IF remaining_debit >= inv.outstanding_amount THEN
        remaining_debit := remaining_debit - inv.outstanding_amount;
        UPDATE ap_transactions
        SET outstanding_amount = 0,
            status             = 'PAID'::ap_transaction_status,
            updated_at         = NOW()
        WHERE id = inv.id;
      ELSE
        UPDATE ap_transactions
        SET outstanding_amount = outstanding_amount - remaining_debit,
            status             = 'PARTIALLY_PAID'::ap_transaction_status,
            updated_at         = NOW()
        WHERE id = inv.id;
        remaining_debit := 0;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Re-enable trigger for live transactions
ALTER TABLE ap_transactions ENABLE TRIGGER trg_update_supplier_ap_balance;

-- Also register the new RPCs in the Functions type stubs (handled in TypeScript types file)
