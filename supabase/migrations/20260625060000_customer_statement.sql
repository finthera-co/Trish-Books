-- ─────────────────────────────────────────────────────────────────────────────
-- Customer statement of account (SOA)
--
-- Returns opening balance, dated movements (invoices/payments/credit notes/
-- write-offs) with a running balance, closing balance, and an aging summary —
-- all in base currency (LKR), dated by each document's own date (not posting
-- time). Foreign invoices/payments are converted at the invoice's exchange_rate
-- so the statement ties to the AR control account.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_customer_id UUID,
  p_from        DATE,
  p_to          DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_opening   NUMERIC := 0;
  v_rows      JSONB;
  v_closing   NUMERIC;
  v_aging     JSONB;
BEGIN
  -- Caller must belong to the customer's tenant.
  SELECT tenant_id INTO v_tenant_id FROM public.customers WHERE id = p_customer_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF v_tenant_id <> (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this customer';
  END IF;

  -- All AR movements for the customer, in base currency, dated by document date.
  WITH movements AS (
    -- Invoices (posted / open) — debit
    SELECT i.issue_date AS txn_date, 'Invoice'::text AS kind, i.invoice_number AS reference,
           round(i.total_amount * COALESCE(i.exchange_rate, 1), 2) AS debit, 0::numeric AS credit
    FROM public.invoices i
    WHERE i.customer_id = p_customer_id AND i.status NOT IN ('draft','voided')
    UNION ALL
    -- Payments received — credit (AR cleared at the invoice's booked rate)
    SELECT pr.payment_date::date, 'Payment', COALESCE(NULLIF(pr.reference,''), 'Receipt'),
           0, round(pr.amount * COALESCE(i.exchange_rate, 1), 2)
    FROM public.payments_received pr
    JOIN public.invoices i ON i.id = pr.invoice_id
    WHERE i.customer_id = p_customer_id
    UNION ALL
    -- Credit notes — credit
    SELECT cn.credit_date, 'Credit Note', cn.credit_note_number, 0, cn.amount
    FROM public.ar_credit_notes cn
    WHERE cn.customer_id = p_customer_id AND cn.status <> 'voided'
    UNION ALL
    -- Write-offs — credit
    SELECT t.transaction_date, 'Write-off', COALESCE(t.document_ref, 'Write-off'), 0, t.outstanding_amount
    FROM public.ar_transactions t
    WHERE t.customer_id = p_customer_id AND t.transaction_type = 'WRITE_OFF'
  )
  SELECT COALESCE(SUM(debit - credit), 0) INTO v_opening
  FROM movements WHERE txn_date < p_from;

  WITH movements AS (
    SELECT i.issue_date AS txn_date, 'Invoice'::text AS kind, i.invoice_number AS reference,
           round(i.total_amount * COALESCE(i.exchange_rate, 1), 2) AS debit, 0::numeric AS credit
    FROM public.invoices i
    WHERE i.customer_id = p_customer_id AND i.status NOT IN ('draft','voided')
    UNION ALL
    SELECT pr.payment_date::date, 'Payment', COALESCE(NULLIF(pr.reference,''), 'Receipt'),
           0, round(pr.amount * COALESCE(i.exchange_rate, 1), 2)
    FROM public.payments_received pr
    JOIN public.invoices i ON i.id = pr.invoice_id
    WHERE i.customer_id = p_customer_id
    UNION ALL
    SELECT cn.credit_date, 'Credit Note', cn.credit_note_number, 0, cn.amount
    FROM public.ar_credit_notes cn
    WHERE cn.customer_id = p_customer_id AND cn.status <> 'voided'
    UNION ALL
    SELECT t.transaction_date, 'Write-off', COALESCE(t.document_ref, 'Write-off'), 0, t.outstanding_amount
    FROM public.ar_transactions t
    WHERE t.customer_id = p_customer_id AND t.transaction_type = 'WRITE_OFF'
  ),
  in_period AS (
    SELECT txn_date, kind, reference, debit, credit,
           v_opening + SUM(debit - credit) OVER (ORDER BY txn_date, kind ROWS UNBOUNDED PRECEDING) AS running
    FROM movements
    WHERE txn_date >= p_from AND txn_date <= p_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', txn_date, 'kind', kind, 'reference', reference,
           'debit', debit, 'credit', credit, 'balance', running
         ) ORDER BY txn_date, kind), '[]'::jsonb),
         COALESCE(MAX(running), v_opening)
    INTO v_rows, v_closing
  FROM in_period;

  -- Aging of still-open invoices as of p_to (base currency).
  WITH open_inv AS (
    SELECT round(t.outstanding_amount, 2) AS amt,
           (p_to - COALESCE(t.due_date, t.transaction_date)) AS days_overdue
    FROM public.ar_transactions t
    WHERE t.customer_id = p_customer_id
      AND t.transaction_type = 'INVOICE'
      AND t.status IN ('OPEN','PARTIALLY_PAID')
      AND t.outstanding_amount > 0
      AND t.transaction_date <= p_to
  )
  SELECT jsonb_build_object(
    'current', COALESCE(SUM(amt) FILTER (WHERE days_overdue <= 0), 0),
    'd1_30',   COALESCE(SUM(amt) FILTER (WHERE days_overdue BETWEEN 1 AND 30), 0),
    'd31_60',  COALESCE(SUM(amt) FILTER (WHERE days_overdue BETWEEN 31 AND 60), 0),
    'd61_90',  COALESCE(SUM(amt) FILTER (WHERE days_overdue BETWEEN 61 AND 90), 0),
    'd90_plus',COALESCE(SUM(amt) FILTER (WHERE days_overdue > 90), 0)
  ) INTO v_aging FROM open_inv;

  RETURN jsonb_build_object(
    'opening_balance', round(v_opening, 2),
    'closing_balance', round(v_closing, 2),
    'rows', v_rows,
    'aging', v_aging
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_statement(UUID, DATE, DATE) TO authenticated;
