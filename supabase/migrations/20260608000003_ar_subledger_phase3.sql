-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3: AR Sub-Ledger Enhancement
-- Adds: customer_accounts, ar_transactions, ar_aging_report RPC,
--       ar_reconciliation_check RPC
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE ar_transaction_type AS ENUM (
    'INVOICE', 'CREDIT_NOTE', 'PAYMENT', 'WRITE_OFF', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ar_transaction_status AS ENUM (
    'OPEN', 'PARTIALLY_PAID', 'PAID', 'WRITTEN_OFF'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. customer_accounts — one row per (tenant, customer)
CREATE TABLE IF NOT EXISTS customer_accounts (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  customer_id       UUID          NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  ar_account_id     UUID          REFERENCES accounts(id),
  credit_limit      NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_terms_days INTEGER       NOT NULL DEFAULT 30,
  current_balance   NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_accounts_unique UNIQUE (tenant_id, customer_id)
);

-- 3. ar_transactions — enriched sub-ledger (complement to ar_subledger)
CREATE TABLE IF NOT EXISTS ar_transactions (
  id                     UUID                  DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              UUID                  NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  customer_id            UUID                  NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  transaction_type       ar_transaction_type   NOT NULL,
  document_id            UUID,
  document_ref           TEXT,
  transaction_date       DATE                  NOT NULL,
  due_date               DATE,
  amount                 NUMERIC(15,2)         NOT NULL DEFAULT 0 CHECK (amount >= 0),
  outstanding_amount     NUMERIC(15,2)         NOT NULL DEFAULT 0,
  status                 ar_transaction_status NOT NULL DEFAULT 'OPEN',
  journal_entry_id       UUID REFERENCES journal_entries(id),
  journal_line_id        UUID REFERENCES journal_lines(id),
  ar_account_id          UUID REFERENCES accounts(id),
  related_transaction_id UUID REFERENCES ar_transactions(id),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_art_tenant_customer ON ar_transactions(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_art_status          ON ar_transactions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_art_due_date        ON ar_transactions(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_art_document        ON ar_transactions(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_ca_tenant           ON customer_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_customer         ON customer_accounts(customer_id);

-- 5. RLS
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_transactions    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_iso_customer_accounts ON customer_accounts
    USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tenant_iso_ar_transactions ON ar_transactions
    USING (tenant_id = get_user_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Trigger: apply payment / credit_note / write_off to linked invoice
CREATE OR REPLACE FUNCTION fn_apply_ar_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_type IN ('PAYMENT', 'CREDIT_NOTE', 'WRITE_OFF')
     AND NEW.related_transaction_id IS NOT NULL THEN
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_ar_payment ON ar_transactions;
CREATE TRIGGER trg_apply_ar_payment
  AFTER INSERT ON ar_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_apply_ar_payment();

-- 7. Trigger: maintain customer_accounts.current_balance
CREATE OR REPLACE FUNCTION fn_update_customer_ar_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta NUMERIC(15,2) := 0;
BEGIN
  CASE NEW.transaction_type
    WHEN 'INVOICE'     THEN v_delta :=  NEW.amount;
    WHEN 'PAYMENT'     THEN v_delta := -NEW.amount;
    WHEN 'CREDIT_NOTE' THEN v_delta := -NEW.amount;
    WHEN 'WRITE_OFF'   THEN v_delta := -NEW.amount;
    WHEN 'ADJUSTMENT'  THEN v_delta :=  NEW.amount;
  END CASE;

  INSERT INTO customer_accounts (tenant_id, customer_id, current_balance)
  VALUES (NEW.tenant_id, NEW.customer_id, v_delta)
  ON CONFLICT (tenant_id, customer_id)
  DO UPDATE SET current_balance = customer_accounts.current_balance + v_delta,
                updated_at      = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_customer_ar_balance ON ar_transactions;
CREATE TRIGGER trg_update_customer_ar_balance
  AFTER INSERT ON ar_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_update_customer_ar_balance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ar_aging_report RPC
-- Returns aging buckets: current / 1-30 / 31-60 / 61-90 / 91-120 / 120+
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ar_aging_report(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
  v_result    JSON;
BEGIN
  v_tenant_id := get_user_tenant_id();

  WITH open_invoices AS (
    SELECT
      art.customer_id,
      c.name          AS customer_name,
      art.outstanding_amount,
      art.due_date,
      CASE
        WHEN art.due_date IS NULL OR art.due_date >= p_as_of_date
          THEN 'current'
        WHEN (p_as_of_date - art.due_date) BETWEEN 1  AND 30  THEN 'days_1_30'
        WHEN (p_as_of_date - art.due_date) BETWEEN 31 AND 60  THEN 'days_31_60'
        WHEN (p_as_of_date - art.due_date) BETWEEN 61 AND 90  THEN 'days_61_90'
        WHEN (p_as_of_date - art.due_date) BETWEEN 91 AND 120 THEN 'days_91_120'
        ELSE 'over_120'
      END AS bucket
    FROM ar_transactions art
    JOIN customers c ON c.id = art.customer_id
    WHERE art.tenant_id = v_tenant_id
      AND art.transaction_type = 'INVOICE'
      AND art.status IN ('OPEN', 'PARTIALLY_PAID')
      AND art.transaction_date <= p_as_of_date
  ),
  aging_by_customer AS (
    SELECT
      customer_id,
      customer_name,
      SUM(CASE WHEN bucket = 'current'     THEN outstanding_amount ELSE 0 END) AS bucket_current,
      SUM(CASE WHEN bucket = 'days_1_30'   THEN outstanding_amount ELSE 0 END) AS days_1_30,
      SUM(CASE WHEN bucket = 'days_31_60'  THEN outstanding_amount ELSE 0 END) AS days_31_60,
      SUM(CASE WHEN bucket = 'days_61_90'  THEN outstanding_amount ELSE 0 END) AS days_61_90,
      SUM(CASE WHEN bucket = 'days_91_120' THEN outstanding_amount ELSE 0 END) AS days_91_120,
      SUM(CASE WHEN bucket = 'over_120'    THEN outstanding_amount ELSE 0 END) AS over_120,
      SUM(outstanding_amount)                                                   AS total
    FROM open_invoices
    GROUP BY customer_id, customer_name
    HAVING SUM(outstanding_amount) > 0.005
    ORDER BY SUM(outstanding_amount) DESC
  )
  SELECT json_build_object(
    'rows', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'customer_id',   abc.customer_id,
          'customer_name', abc.customer_name,
          'current',       abc.bucket_current,
          'days_1_30',     abc.days_1_30,
          'days_31_60',    abc.days_31_60,
          'days_61_90',    abc.days_61_90,
          'days_91_120',   abc.days_91_120,
          'over_120',      abc.over_120,
          'total',         abc.total
        ) ORDER BY abc.total DESC
      ) FROM aging_by_customer abc),
      '[]'::JSON
    ),
    'totals', json_build_object(
      'current',     COALESCE((SELECT SUM(bucket_current) FROM aging_by_customer), 0),
      'days_1_30',   COALESCE((SELECT SUM(days_1_30)     FROM aging_by_customer), 0),
      'days_31_60',  COALESCE((SELECT SUM(days_31_60)    FROM aging_by_customer), 0),
      'days_61_90',  COALESCE((SELECT SUM(days_61_90)    FROM aging_by_customer), 0),
      'days_91_120', COALESCE((SELECT SUM(days_91_120)   FROM aging_by_customer), 0),
      'over_120',    COALESCE((SELECT SUM(over_120)      FROM aging_by_customer), 0),
      'grand_total', COALESCE((SELECT SUM(total)         FROM aging_by_customer), 0)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION ar_aging_report(DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ar_reconciliation_check RPC
-- Compares ar_transactions outstanding vs GL control account balance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ar_reconciliation_check(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id         UUID;
  v_subledger_balance NUMERIC(15,2);
  v_gl_balance        NUMERIC(15,2);
  v_variance          NUMERIC(15,2);
BEGIN
  v_tenant_id := get_user_tenant_id();

  -- Sum of outstanding_amount on OPEN/PARTIALLY_PAID invoices in ar_transactions
  SELECT COALESCE(SUM(outstanding_amount), 0) INTO v_subledger_balance
  FROM ar_transactions
  WHERE tenant_id = v_tenant_id
    AND transaction_type = 'INVOICE'
    AND status IN ('OPEN', 'PARTIALLY_PAID')
    AND transaction_date <= p_as_of_date;

  -- Net debit on GL lines for AR control accounts from posted journal entries
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_gl_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.tenant_id = v_tenant_id
    AND (
      a.account_subtype ILIKE '%accounts receivable%'
      OR a.control_account_type = 'CUSTOMER'
    )
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

GRANT EXECUTE ON FUNCTION ar_reconciliation_check(DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Backfill existing data
-- Disable balance trigger during backfill to avoid double-counting
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ar_transactions DISABLE TRIGGER trg_update_customer_ar_balance;

-- Backfill customer_accounts (net balance computed from ar_subledger)
INSERT INTO customer_accounts (tenant_id, customer_id, credit_limit, credit_terms_days, current_balance)
SELECT
  c.tenant_id,
  c.id,
  COALESCE(c.credit_limit, 0),
  CASE
    WHEN c.payment_terms ILIKE '%60%'        THEN 60
    WHEN c.payment_terms ILIKE '%90%'        THEN 90
    WHEN c.payment_terms ILIKE '%15%'        THEN 15
    WHEN c.payment_terms ILIKE '%immediate%' THEN 0
    ELSE 30
  END,
  COALESCE(nb.balance, 0)
FROM customers c
LEFT JOIN (
  SELECT customer_id, SUM(COALESCE(debit, 0) - COALESCE(credit, 0)) AS balance
  FROM ar_subledger
  GROUP BY customer_id
) nb ON nb.customer_id = c.id
ON CONFLICT (tenant_id, customer_id) DO UPDATE
  SET credit_limit      = EXCLUDED.credit_limit,
      credit_terms_days = EXCLUDED.credit_terms_days,
      current_balance   = EXCLUDED.current_balance,
      updated_at        = NOW();

-- Backfill ar_transactions: invoice / opening_balance entries
INSERT INTO ar_transactions (
  tenant_id, customer_id, transaction_type,
  document_id, document_ref, transaction_date, due_date,
  amount, outstanding_amount, status,
  journal_entry_id, journal_line_id
)
SELECT
  s.tenant_id,
  s.customer_id,
  'INVOICE'::ar_transaction_type,
  s.document_id,
  s.invoice_no,
  COALESCE(
    CASE WHEN s.due_date IS NOT NULL THEN (s.due_date::DATE - INTERVAL '30 days')::DATE END,
    s.created_at::DATE
  ),
  s.due_date::DATE,
  GREATEST(0, COALESCE(s.debit, 0)),
  GREATEST(0, COALESCE(s.debit, 0)),  -- will be reduced below
  'OPEN'::ar_transaction_status,
  s.journal_id,
  s.journal_line_id
FROM ar_subledger s
WHERE s.document_type IN ('invoice', 'opening_balance')
  AND COALESCE(s.debit, 0) > 0;

-- Backfill ar_transactions: payment / credit_note entries
INSERT INTO ar_transactions (
  tenant_id, customer_id, transaction_type,
  document_id, document_ref, transaction_date, due_date,
  amount, outstanding_amount, status,
  journal_entry_id, journal_line_id
)
SELECT
  s.tenant_id,
  s.customer_id,
  CASE s.document_type
    WHEN 'credit_note' THEN 'CREDIT_NOTE'::ar_transaction_type
    ELSE 'PAYMENT'::ar_transaction_type
  END,
  s.document_id,
  NULL,
  s.created_at::DATE,
  NULL,
  GREATEST(0, COALESCE(s.credit, 0)),
  0,
  'PAID'::ar_transaction_status,
  s.journal_id,
  s.journal_line_id
FROM ar_subledger s
WHERE s.document_type IN ('payment_received', 'credit_note')
  AND COALESCE(s.credit, 0) > 0;

-- Reduce invoice outstanding_amounts using total payments per customer (oldest first)
DO $$
DECLARE
  cust            RECORD;
  inv             RECORD;
  remaining_credit NUMERIC(15,2);
BEGIN
  FOR cust IN
    SELECT DISTINCT tenant_id, customer_id
    FROM ar_transactions
    WHERE transaction_type IN ('PAYMENT', 'CREDIT_NOTE')
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO remaining_credit
    FROM ar_transactions
    WHERE tenant_id    = cust.tenant_id
      AND customer_id  = cust.customer_id
      AND transaction_type IN ('PAYMENT', 'CREDIT_NOTE');

    FOR inv IN
      SELECT id, outstanding_amount
      FROM ar_transactions
      WHERE tenant_id   = cust.tenant_id
        AND customer_id = cust.customer_id
        AND transaction_type = 'INVOICE'
        AND status IN ('OPEN', 'PARTIALLY_PAID')
      ORDER BY due_date ASC NULLS LAST, created_at ASC
    LOOP
      EXIT WHEN remaining_credit <= 0;

      IF remaining_credit >= inv.outstanding_amount THEN
        remaining_credit := remaining_credit - inv.outstanding_amount;
        UPDATE ar_transactions
        SET outstanding_amount = 0,
            status             = 'PAID'::ar_transaction_status,
            updated_at         = NOW()
        WHERE id = inv.id;
      ELSE
        UPDATE ar_transactions
        SET outstanding_amount = outstanding_amount - remaining_credit,
            status             = 'PARTIALLY_PAID'::ar_transaction_status,
            updated_at         = NOW()
        WHERE id = inv.id;
        remaining_credit := 0;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Re-enable trigger for live transactions
ALTER TABLE ar_transactions ENABLE TRIGGER trg_update_customer_ar_balance;
