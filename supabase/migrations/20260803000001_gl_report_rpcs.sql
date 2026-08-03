-- General Ledger report RPCs: account tree, transactions, integrity checks.
-- All SECURITY INVOKER (RLS still applies) with an explicit tenant_id predicate as
-- defence in depth, fully schema-qualified, with a statement_timeout so a pathological
-- range degrades into an error rather than a stalled connection.

-- ── 2.2 rpc_gl_account_tree ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_gl_account_tree(
  p_date_from        date,
  p_date_to          date,
  p_account_type     text    DEFAULT NULL,
  p_include_inactive boolean DEFAULT true
)
RETURNS TABLE (
  node_key          text,
  account_id        uuid,
  parent_account_id uuid,
  account_code      text,
  account_name      text,
  account_type      text,
  label             text,
  depth             integer,
  sort_path         text,
  is_other_node     boolean,
  has_children      boolean,
  own_opening       numeric,
  own_debit         numeric,
  own_credit        numeric,
  own_txn_count     bigint,
  subtree_opening   numeric,
  subtree_debit     numeric,
  subtree_credit    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '30s'
AS $fn$
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit (% days requested)', p_date_to - p_date_from
      USING ERRCODE = '22003';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  type_rank(t, r) AS (
    VALUES ('Asset',1),('Liability',2),('Equity',3),('Income',4),
           ('Cost of Goods Sold',5),('Expense',6),('Other Income',7),('Other Expense',8)
  ),
  acct AS (
    SELECT a.id, a.parent_account_id, a.account_code, a.account_name,
           a.account_type, a.is_active
    FROM public.accounts a
    WHERE a.tenant_id = public.get_user_tenant_id()
      AND (p_include_inactive OR a.is_active)
      AND (p_account_type IS NULL OR a.account_type = p_account_type)
  ),
  seg AS (
    SELECT ac.*,
           lpad(COALESCE(NULLIF(regexp_replace(ac.account_code, '\D', '', 'g'), ''), '0'), 12, '0')
             || '|' || COALESCE(ac.account_code, '') || '|' || ac.id::text AS sort_seg
    FROM acct ac
  ),
  tree AS (
    SELECT s.*, 1 AS depth,
           lpad(COALESCE(tr.r, 99)::text, 2, '0') || '/' || s.sort_seg AS sort_path
    FROM seg s
    LEFT JOIN type_rank tr ON tr.t = s.account_type
    WHERE s.parent_account_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM seg p WHERE p.id = s.parent_account_id)
    UNION ALL
    SELECT c.*, t.depth + 1, t.sort_path || '/' || c.sort_seg
    FROM seg c
    JOIN tree t ON c.parent_account_id = t.id
    WHERE t.depth < 20
  ) CYCLE id SET is_cycle USING cycle_path,
  own AS (
    SELECT jl.account_id,
           SUM(CASE WHEN je.entry_date <  p_date_from
                    THEN COALESCE(jl.debit,0) - COALESCE(jl.credit,0) ELSE 0 END)          AS opening,
           SUM(CASE WHEN je.entry_date BETWEEN p_date_from AND p_date_to
                    THEN COALESCE(jl.debit,0)  ELSE 0 END)                                  AS dr,
           SUM(CASE WHEN je.entry_date BETWEEN p_date_from AND p_date_to
                    THEN COALESCE(jl.credit,0) ELSE 0 END)                                  AS cr,
           COUNT(*) FILTER (WHERE je.entry_date BETWEEN p_date_from AND p_date_to)          AS n
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id  = public.get_user_tenant_id()
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date <= p_date_to
    GROUP BY jl.account_id
  ),
  node AS (
    SELECT t.id, t.parent_account_id, t.account_code, t.account_name, t.account_type,
           t.depth, t.sort_path,
           EXISTS (SELECT 1 FROM tree c WHERE c.parent_account_id = t.id) AS has_children,
           COALESCE(o.opening,0) AS own_opening,
           COALESCE(o.dr,0)      AS own_debit,
           COALESCE(o.cr,0)      AS own_credit,
           COALESCE(o.n,0)       AS own_txn_count
    FROM tree t
    LEFT JOIN own o ON o.account_id = t.id
    WHERE NOT t.is_cycle
  ),
  roll AS (
    -- Subtree aggregation by strict sort_path prefix. Each segment ends in the node's
    -- uuid, so no sibling code can prefix another. O(n^2) over accounts only (~600 here,
    -- ~360k comparisons) — not over transactions. Revisit above ~5,000 accounts.
    SELECT n.id,
           SUM(d.own_opening) AS st_opening,
           SUM(d.own_debit)   AS st_debit,
           SUM(d.own_credit)  AS st_credit
    FROM node n
    JOIN node d ON starts_with(d.sort_path, n.sort_path)
    GROUP BY n.id
  )
  SELECT n.id::text, n.id, n.parent_account_id, n.account_code, n.account_name,
         n.account_type, n.account_name, n.depth, n.sort_path,
         false, n.has_children,
         n.own_opening, n.own_debit, n.own_credit, n.own_txn_count,
         r.st_opening, r.st_debit, r.st_credit
  FROM node n JOIN roll r ON r.id = n.id

  UNION ALL

  SELECT n.id::text || ':other', n.id, n.id, n.account_code, n.account_name,
         n.account_type, n.account_name || ' - Other', n.depth + 1,
         n.sort_path || '/~other', true, false,
         n.own_opening, n.own_debit, n.own_credit, n.own_txn_count,
         n.own_opening, n.own_debit, n.own_credit
  FROM node n
  WHERE n.has_children

  ORDER BY sort_path;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_gl_account_tree(date, date, text, boolean) TO authenticated;

-- ── 2.3 rpc_gl_transactions ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_gl_transactions(
  p_date_from   date,
  p_date_to     date,
  p_account_ids uuid[] DEFAULT NULL,
  p_limit       integer DEFAULT 5000,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  account_id      uuid,
  entry_id        uuid,
  line_id         uuid,
  line_seq        bigint,
  entry_date      date,
  txn_type        text,
  num             text,
  is_adjusting    boolean,
  entity_name     text,
  memo            text,
  split_text      text,
  debit           numeric,
  credit          numeric,
  running_balance numeric,
  total_rows      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit (% days requested)', p_date_to - p_date_from
      USING ERRCODE = '22003';
  END IF;
  IF p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 50000' USING ERRCODE = '22003';
  END IF;

  RETURN QUERY
  WITH scope AS (
    SELECT je.id, je.entry_date, je.reference, je.description, je.source_type,
           je.source_id, je.entry_type, je.is_adjusting, je.created_at
    FROM public.journal_entries je
    WHERE je.tenant_id  = public.get_user_tenant_id()
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date BETWEEN p_date_from AND p_date_to
  ),
  lines AS (
    SELECT jl.id, jl.seq, jl.journal_entry_id, jl.account_id, jl.memo,
           COALESCE(jl.debit,0) AS debit, COALESCE(jl.credit,0) AS credit,
           jl.customer_id, jl.vendor_id
    FROM public.journal_lines jl
    JOIN scope s ON s.id = jl.journal_entry_id
    WHERE p_account_ids IS NULL OR jl.account_id = ANY (p_account_ids)
  ),
  -- Split source: every distinct account on the entry, including lines belonging to
  -- accounts NOT in p_account_ids. Reading only the batch would silently mislabel
  -- -SPLIT- rows as two-sided.
  entry_accts AS (
    SELECT jl.journal_entry_id,
           array_agg(DISTINCT jl.account_id) AS accts,
           count(DISTINCT jl.memo) FILTER (WHERE jl.memo IS NOT NULL AND jl.memo <> '') AS memo_variants
    FROM public.journal_lines jl
    JOIN scope s ON s.id = jl.journal_entry_id
    GROUP BY jl.journal_entry_id
  ),
  -- Bank-import direction: the posting RPC debits the bank leg when money comes in
  -- (statement credit) and credits it when money goes out (statement debit). Both
  -- lines of the entry render the same Type, matching QuickBooks Deposit/Check display.
  bank_dir AS (
    SELECT s.id AS entry_id,
           CASE WHEN bl.debit > 0 THEN 'Deposit' WHEN bl.credit > 0 THEN 'Check' END AS txn_label
    FROM scope s
    JOIN public.bank_statement_lines bsl ON bsl.id = s.source_id
    JOIN public.bank_statement_batches bb ON bb.id = bsl.batch_id
    JOIN public.journal_lines bl ON bl.journal_entry_id = s.id AND bl.account_id = bb.bank_account_id
    WHERE s.source_type = 'bank_import'
  ),
  opening AS (
    SELECT jl.account_id,
           SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)) AS bal
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id  = public.get_user_tenant_id()
      AND je.status     = 'posted'
      AND je.voided_at  IS NULL
      AND je.entry_date < p_date_from
      AND (p_account_ids IS NULL OR jl.account_id = ANY (p_account_ids))
    GROUP BY jl.account_id
  ),
  enriched AS (
    SELECT
      l.account_id, s.id AS entry_id, l.id AS line_id, l.seq AS line_seq, s.entry_date,
      CASE
        WHEN s.source_type = 'invoice'          THEN 'Invoice'
        WHEN s.source_type = 'invoice_reversal' THEN 'Invoice Reversal'
        WHEN s.source_type = 'invoice_payment'  THEN 'Payment'
        WHEN s.source_type = 'supplier_bill'    THEN 'Bill'
        WHEN s.source_type = 'bill_payment'     THEN 'Bill Pmt -Check'
        WHEN s.source_type = 'payment_voucher'  THEN 'Check'
        WHEN s.source_type = 'petty_cash'       THEN 'Petty Cash'
        WHEN s.source_type = 'grn'              THEN 'Item Receipt'
        WHEN s.source_type = 'depreciation'     THEN 'Depreciation'
        WHEN s.source_type = 'payroll'          THEN 'Paycheck'
        WHEN s.source_type = 'period_close'     THEN 'Closing Entry'
        WHEN s.source_type = 'bank_import'      THEN COALESCE(bd.txn_label, 'Bank Transaction')
        WHEN s.entry_type  = 'reversal'         THEN 'Reversal'
        ELSE 'General Journal'
      END AS txn_type,
      COALESCE(s.reference, '')                                   AS num,
      s.is_adjusting,
      COALESCE(c.name, v.name, '')                                AS entity_name,
      CASE
        WHEN l.memo IS NOT NULL AND l.memo <> '' THEN l.memo
        WHEN ea.memo_variants >= 2               THEN '-MULTIPLE-'
        ELSE COALESCE(s.description, '')
      END                                                          AS memo,
      CASE
        WHEN cardinality(array_remove(ea.accts, l.account_id)) = 0 THEN ''
        WHEN cardinality(array_remove(ea.accts, l.account_id)) = 1 THEN COALESCE(sa.account_name, '')
        ELSE '-SPLIT-'
      END                                                          AS split_text,
      l.debit, l.credit,
      COALESCE(op.bal, 0) + SUM(l.debit - l.credit) OVER (
        PARTITION BY l.account_id
        ORDER BY s.entry_date, s.created_at, s.id, l.seq
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                            AS running_balance,
      s.created_at
    FROM lines l
    JOIN scope       s  ON s.id  = l.journal_entry_id
    JOIN entry_accts ea ON ea.journal_entry_id = l.journal_entry_id
    LEFT JOIN bank_dir  bd ON bd.entry_id = s.id
    LEFT JOIN opening   op ON op.account_id = l.account_id
    LEFT JOIN public.accounts sa
           ON cardinality(array_remove(ea.accts, l.account_id)) = 1
          AND sa.id = (array_remove(ea.accts, l.account_id))[1]
    LEFT JOIN public.customers c ON c.id = l.customer_id
    LEFT JOIN public.vendors   v ON v.id = l.vendor_id
  )
  SELECT e.account_id, e.entry_id, e.line_id, e.line_seq, e.entry_date, e.txn_type,
         e.num, e.is_adjusting, e.entity_name, e.memo, e.split_text,
         e.debit, e.credit, e.running_balance,
         count(*) OVER () AS total_rows
  FROM enriched e
  ORDER BY e.account_id, e.entry_date, e.created_at, e.entry_id, e.line_seq
  LIMIT p_limit OFFSET p_offset;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_gl_transactions(date, date, uuid[], integer, integer) TO authenticated;

-- ── 2.4 rpc_gl_integrity ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_gl_integrity(
  p_date_from date,
  p_date_to   date
)
RETURNS TABLE (
  severity   text,
  code       text,
  entity_id  uuid,
  detail     text,
  amount     numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public SET statement_timeout = '30s'
AS $fn$
BEGIN
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Invalid range: date_to (%) precedes date_from (%)', p_date_to, p_date_from
      USING ERRCODE = '22007';
  END IF;
  IF p_date_to - p_date_from > 3660 THEN
    RAISE EXCEPTION 'Range exceeds the 10-year reporting limit (% days requested)', p_date_to - p_date_from
      USING ERRCODE = '22003';
  END IF;

  RETURN QUERY
  SELECT 'error', 'UNBALANCED_ENTRY', je.id,
         'Entry ' || COALESCE(je.reference, je.id::text) || ' does not balance',
         round(SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0)), 2)
  FROM public.journal_entries je
  JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
  WHERE je.tenant_id = public.get_user_tenant_id()
    AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_date_from AND p_date_to
  GROUP BY je.id, je.reference
  HAVING abs(SUM(COALESCE(jl.debit,0) - COALESCE(jl.credit,0))) > 0.005

  UNION ALL
  SELECT 'error', 'SINGLE_LINE_ENTRY', je.id,
         'Entry ' || COALESCE(je.reference, je.id::text) || ' has fewer than two lines', NULL
  FROM public.journal_entries je
  JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
  WHERE je.tenant_id = public.get_user_tenant_id()
    AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_date_from AND p_date_to
  GROUP BY je.id, je.reference HAVING count(*) < 2

  UNION ALL
  SELECT 'error', 'CROSS_TENANT_LINE', jl.id,
         'Journal line references an account belonging to a different tenant', NULL
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE je.tenant_id = public.get_user_tenant_id() AND a.tenant_id <> je.tenant_id

  UNION ALL
  SELECT 'warning', 'DEGENERATE_LINE', jl.id,
         'Line has both debit and credit, or neither', NULL
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.tenant_id = public.get_user_tenant_id()
    AND je.status = 'posted' AND je.voided_at IS NULL
    AND je.entry_date BETWEEN p_date_from AND p_date_to
    AND ((COALESCE(jl.debit,0) <> 0 AND COALESCE(jl.credit,0) <> 0)
      OR (COALESCE(jl.debit,0)  = 0 AND COALESCE(jl.credit,0)  = 0))

  UNION ALL
  SELECT 'warning', 'POSTING_TO_PARENT', a.id,
         'Account ' || a.account_code || ' ' || a.account_name || ' is marked non-postable but has postings in range', NULL
  FROM public.accounts a
  WHERE a.tenant_id = public.get_user_tenant_id() AND a.is_postable = false
    AND EXISTS (
      SELECT 1 FROM public.journal_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = a.id AND je.status = 'posted' AND je.voided_at IS NULL
        AND je.entry_date BETWEEN p_date_from AND p_date_to)

  UNION ALL
  SELECT 'warning', 'ORPHAN_ACCOUNT', a.id,
         'Account ' || a.account_code || ' has a parent that does not exist in this tenant', NULL
  FROM public.accounts a
  WHERE a.tenant_id = public.get_user_tenant_id() AND a.parent_account_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.accounts p
                    WHERE p.id = a.parent_account_id AND p.tenant_id = a.tenant_id);
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_gl_integrity(date, date) TO authenticated;
