-- Financial statement engine: declarative statement/line/mapping tables plus a
-- default-SOCI seed. Additive and idempotent. No expression strings, no eval —
-- a computed line is a signed sum of other lines (fs_line_terms), full stop.

-- ── 1.1 Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fs_statements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  title       text NOT NULL,
  period_caption   text NOT NULL DEFAULT 'For the Year Ended 31st March',
  currency_caption text NOT NULL DEFAULT 'Rs.         Cts.',
  footer_notes text[] NOT NULL DEFAULT ARRAY[
    'Figures In Brackets Indicate Deductions.',
    'The Accounting Policies and Notes Form an Integral Part of These Financial Statements.'
  ],
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.fs_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  statement_id   uuid NOT NULL REFERENCES public.fs_statements(id) ON DELETE CASCADE,
  parent_line_id uuid REFERENCES public.fs_lines(id) ON DELETE CASCADE,
  line_code      text NOT NULL,
  label          text NOT NULL,
  note_ref       text,
  line_type      text NOT NULL
                 CHECK (line_type IN ('detail','computed','per_share','spacer','text')),
  sign           text NOT NULL DEFAULT 'invert'
                 CHECK (sign IN ('natural','invert')),
  emphasis       text NOT NULL DEFAULT 'normal'
                 CHECK (emphasis IN ('normal','bold','bold_rule','total_rule')),
  show_margin    boolean NOT NULL DEFAULT false,
  is_margin_base boolean NOT NULL DEFAULT false,
  param_key      text,
  sort_order     integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_id, line_code)
);

CREATE TABLE IF NOT EXISTS public.fs_line_terms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  line_id      uuid NOT NULL REFERENCES public.fs_lines(id) ON DELETE CASCADE,
  term_line_id uuid NOT NULL REFERENCES public.fs_lines(id) ON DELETE CASCADE,
  factor       numeric NOT NULL DEFAULT 1 CHECK (factor IN (-1, 1)),
  sort_order   integer NOT NULL DEFAULT 0,
  UNIQUE (line_id, term_line_id),
  CHECK (line_id <> term_line_id)
);

CREATE TABLE IF NOT EXISTS public.fs_line_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  line_id    uuid NOT NULL REFERENCES public.fs_lines(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, account_id)
);

CREATE TABLE IF NOT EXISTS public.fs_parameters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fiscal_period_id uuid REFERENCES public.fiscal_periods(id) ON DELETE CASCADE,
  key              text NOT NULL,
  value            numeric NOT NULL,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fiscal_period_id, key)
);

-- ── 1.2 One account maps to at most one line per statement ─────────────────
CREATE OR REPLACE FUNCTION public.fn_fs_line_account_unique_per_statement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_statement_id uuid; v_conflict text;
BEGIN
  SELECT statement_id INTO v_statement_id FROM public.fs_lines WHERE id = NEW.line_id;

  SELECT l.label INTO v_conflict
  FROM public.fs_line_accounts la
  JOIN public.fs_lines l ON l.id = la.line_id
  WHERE la.account_id = NEW.account_id
    AND l.statement_id = v_statement_id
    AND la.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Account is already mapped to "%" on this statement', v_conflict
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fs_line_account_unique ON public.fs_line_accounts;
CREATE TRIGGER trg_fs_line_account_unique
  BEFORE INSERT OR UPDATE ON public.fs_line_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_fs_line_account_unique_per_statement();

-- ── 1.3 RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.fs_statements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_line_terms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_line_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_parameters    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fs_statements select"    ON public.fs_statements;
DROP POLICY IF EXISTS "fs_statements all"       ON public.fs_statements;
DROP POLICY IF EXISTS "fs_lines select"         ON public.fs_lines;
DROP POLICY IF EXISTS "fs_lines all"            ON public.fs_lines;
DROP POLICY IF EXISTS "fs_line_terms select"    ON public.fs_line_terms;
DROP POLICY IF EXISTS "fs_line_terms all"       ON public.fs_line_terms;
DROP POLICY IF EXISTS "fs_line_accounts select" ON public.fs_line_accounts;
DROP POLICY IF EXISTS "fs_line_accounts all"    ON public.fs_line_accounts;
DROP POLICY IF EXISTS "fs_parameters select"    ON public.fs_parameters;
DROP POLICY IF EXISTS "fs_parameters all"       ON public.fs_parameters;

CREATE POLICY "fs_statements select" ON public.fs_statements FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "fs_statements all" ON public.fs_statements FOR ALL
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "fs_lines select" ON public.fs_lines FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "fs_lines all" ON public.fs_lines FOR ALL
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "fs_line_terms select" ON public.fs_line_terms FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "fs_line_terms all" ON public.fs_line_terms FOR ALL
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "fs_line_accounts select" ON public.fs_line_accounts FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "fs_line_accounts all" ON public.fs_line_accounts FOR ALL
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "fs_parameters select" ON public.fs_parameters FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "fs_parameters all" ON public.fs_parameters FOR ALL
  USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());

-- ── 1.4 Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fs_lines_stmt_sort   ON public.fs_lines (statement_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_fs_line_accounts_acc ON public.fs_line_accounts (account_id);
CREATE INDEX IF NOT EXISTS idx_fs_line_accounts_ln  ON public.fs_line_accounts (line_id);
CREATE INDEX IF NOT EXISTS idx_fs_line_terms_line   ON public.fs_line_terms (line_id);

-- ── 1.5 Seed function for the default SOCI ──────────────────────────────────
-- Idempotent: safe to call repeatedly. p_force=true replaces an existing SOCI's
-- lines/terms (but never touches fs_line_accounts — mappings survive a reseed).
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
