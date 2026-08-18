-- Two more memorandum parking lines on the SOCI: "Liabilities" and "Equity".
--
-- 20260816000001 gave the mapping screen somewhere to put balance-sheet-natured
-- accounts, but only for the debit side (ASSETS, DUE_FROM_RELATED). A liability
-- or equity account therefore sat in the mapping screen's "Other ledgers" list
-- with nothing sensible to assign it to. These two lines close that gap.
--
-- Like the existing pair they are ordinary detail lines that no fs_line_terms
-- row references, so they never touch profit, and they live below the
-- memorandum heading, outside the statutory face of the statement.
--
-- Two deliberate differences from the ASSETS line:
--   value_basis = 'cumulative'  (same) — a liability is a closing balance
--     carried from inception, not a period movement.
--   sign        = 'invert'      (ASSETS is 'natural') — a liability and an
--     equity account carry credit balances, so debit-minus-credit would render
--     every one of them in brackets. Inverting makes a LKR 3m loan read
--     3,000,000 on the face, which is how a memorandum block is read.

-- ── 1. Backfill onto every existing SOCI ────────────────────────────────────
-- fs_lines_statement_sort_unique (20260816000006) makes a hardcoded sort_order
-- unsafe: 150/160 may already belong to a line a tenant added themselves. Take
-- the slots after the current last line instead, per statement.
INSERT INTO public.fs_lines
  (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order)
SELECT s.tenant_id, s.id, v.line_code, v.label, 'detail', 'invert', 'normal', 'cumulative',
       nx.next_ord + v.ord_offset
FROM public.fs_statements s
CROSS JOIN LATERAL (
  SELECT COALESCE(MAX(l.sort_order), 140) + 10 AS next_ord
  FROM public.fs_lines l WHERE l.statement_id = s.id
) nx
CROSS JOIN (VALUES
  ('LIABILITIES', 'Liabilities', 0),
  ('EQUITY',      'Equity',      10)
) AS v(line_code, label, ord_offset)
WHERE s.code = 'SOCI'
ON CONFLICT (statement_id, line_code) DO NOTHING;

-- ── 2. Same two lines for every SOCI seeded from here on ────────────────────
-- Byte-for-byte the body from 20260816000002 plus the two rows at 150/160.
CREATE OR REPLACE FUNCTION public.rpc_fs_seed_soci(p_force boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_stmt uuid;
  v_revenue uuid; v_cos uuid; v_gp uuid; v_other_inc uuid; v_selling uuid; v_admin uuid;
  v_operating uuid; v_finance uuid; v_pbt uuid; v_tax uuid; v_profit uuid; v_eps uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_stmt FROM public.fs_statements WHERE tenant_id = v_tenant AND code = 'SOCI';
  IF v_stmt IS NOT NULL AND NOT p_force THEN
    RETURN v_stmt;
  END IF;

  IF v_stmt IS NULL THEN
    INSERT INTO public.fs_statements (tenant_id, code, name, title, sort_order)
    VALUES (v_tenant, 'SOCI', 'Statement of Comprehensive Income', 'Statement Of Comprehensive Income', 10)
    RETURNING id INTO v_stmt;
  ELSE
    -- Reseed: drop existing lines. fs_line_accounts cascades on line delete, which
    -- would silently discard the accountant's mappings — refuse rather than do that.
    IF EXISTS (SELECT 1 FROM public.fs_line_accounts la JOIN public.fs_lines l ON l.id = la.line_id WHERE l.statement_id = v_stmt) THEN
      RAISE EXCEPTION 'SOCI has existing account mappings; reseeding would delete them. Remove mappings first if you really want to reset the line structure.'
        USING ERRCODE = '55006';
    END IF;
    DELETE FROM public.fs_lines WHERE statement_id = v_stmt;
  END IF;

  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, show_margin, is_margin_base, sort_order)
    VALUES (v_tenant, v_stmt, 'REVENUE', 'Revenue', '01', 'detail', 'normal', false, true, 10)
    RETURNING id INTO v_revenue;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'COS', 'Cost of Sales', '02', 'detail', 'normal', 20)
    RETURNING id INTO v_cos;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, show_margin, sort_order)
    VALUES (v_tenant, v_stmt, 'GROSS_PROFIT', 'GROSS PROFIT', 'computed', 'bold_rule', true, 30)
    RETURNING id INTO v_gp;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'OTHER_OP_INCOME', 'Other Operating Income', '03', 'detail', 'normal', 40)
    RETURNING id INTO v_other_inc;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'SELLING_DIST', 'Selling & Distribution Expenses', '04', 'detail', 'normal', 50)
    RETURNING id INTO v_selling;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'ADMIN_EXP', 'Administrative Expenses', '05', 'detail', 'normal', 60)
    RETURNING id INTO v_admin;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'OPERATING_PROFIT', 'PROFIT/(LOSS)FROM OPERATING ACTIVITIES', 'computed', 'bold_rule', 70)
    RETURNING id INTO v_operating;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'FINANCE_EXP', 'Financial Expenses', '06', 'detail', 'normal', 80)
    RETURNING id INTO v_finance;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, show_margin, sort_order)
    VALUES (v_tenant, v_stmt, 'PBT', 'PROFIT/(LOSS) BEFORE TAXATION', 'computed', 'bold_rule', true, 90)
    RETURNING id INTO v_pbt;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, sort_order)
    VALUES (v_tenant, v_stmt, 'TAX_EXP', 'Income Tax Expenses', '07', 'detail', 'normal', 100)
    RETURNING id INTO v_tax;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, emphasis, show_margin, sort_order)
    VALUES (v_tenant, v_stmt, 'PROFIT_FOR_YEAR', 'PROFIT/(LOSS) FOR THE YEAR', 'computed', 'total_rule', true, 110)
    RETURNING id INTO v_profit;
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, note_ref, line_type, emphasis, param_key, sort_order)
    VALUES (v_tenant, v_stmt, 'EPS', 'Basic Earnings / (Loss) Per Ordinary Share', '08', 'per_share', 'normal', 'weighted_average_shares', 120)
    RETURNING id INTO v_eps;

  -- Memorandum section, fenced off below EPS. No fs_line_terms row ever
  -- references these lines, so they never touch profit; value_basis
  -- 'cumulative' values them as closing balances, not period movement.
  -- Credit-natured lines (liabilities, equity) invert so they read positive.
  INSERT INTO public.fs_lines (tenant_id, statement_id, line_code, label, line_type, sign, emphasis, value_basis, sort_order) VALUES
    (v_tenant, v_stmt, 'BS_MEMO_GAP',      '',                                        'spacer', 'natural', 'normal', 'period',     125),
    (v_tenant, v_stmt, 'BS_MEMO_HEADING',  'MEMORANDUM — NOT PART OF PROFIT OR LOSS', 'text',   'natural', 'bold',   'period',     128),
    (v_tenant, v_stmt, 'ASSETS',           'Assets',                                  'detail', 'natural', 'normal', 'cumulative', 130),
    (v_tenant, v_stmt, 'DUE_FROM_RELATED', 'Amount Due From Related Parties',         'detail', 'natural', 'normal', 'cumulative', 140),
    (v_tenant, v_stmt, 'LIABILITIES',      'Liabilities',                             'detail', 'invert',  'normal', 'cumulative', 150),
    (v_tenant, v_stmt, 'EQUITY',           'Equity',                                  'detail', 'invert',  'normal', 'cumulative', 160);

  INSERT INTO public.fs_line_terms (tenant_id, line_id, term_line_id, factor, sort_order) VALUES
    (v_tenant, v_gp, v_revenue, 1, 1),
    (v_tenant, v_gp, v_cos, 1, 2),
    (v_tenant, v_operating, v_gp, 1, 1),
    (v_tenant, v_operating, v_other_inc, 1, 2),
    (v_tenant, v_operating, v_selling, 1, 3),
    (v_tenant, v_operating, v_admin, 1, 4),
    (v_tenant, v_pbt, v_operating, 1, 1),
    (v_tenant, v_pbt, v_finance, 1, 2),
    (v_tenant, v_profit, v_pbt, 1, 1),
    (v_tenant, v_profit, v_tax, 1, 2),
    (v_tenant, v_eps, v_profit, 1, 1);

  RETURN v_stmt;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_seed_soci(boolean) TO authenticated;
