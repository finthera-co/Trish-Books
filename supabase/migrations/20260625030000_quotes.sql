-- ─────────────────────────────────────────────────────────────────────────────
-- Quotes / estimates (pre-sales documents)
--
-- A quote has NO general-ledger impact — it's a priced offer. When the customer
-- accepts, one click converts it into a draft invoice (copying header + lines and
-- minting an IRD serial); the quote is then marked 'converted' and linked.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quotes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  quote_number         TEXT NOT NULL,
  issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date          DATE,
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','sent','accepted','declined','expired','converted')),
  subtotal             NUMERIC NOT NULL DEFAULT 0,
  tax_amount           NUMERIC NOT NULL DEFAULT 0,
  discount_amount      NUMERIC NOT NULL DEFAULT 0,
  total_amount         NUMERIC NOT NULL DEFAULT 0,
  branch_code          TEXT,
  payment_terms        TEXT NOT NULL DEFAULT 'net_30',
  notes                TEXT,
  terms                TEXT,
  converted_invoice_id UUID REFERENCES public.invoices(id),
  created_by           UUID REFERENCES public.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, quote_number)
);

CREATE TABLE IF NOT EXISTS public.quote_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  description      TEXT,
  quantity         NUMERIC NOT NULL DEFAULT 1,
  unit_price       NUMERIC NOT NULL DEFAULT 0,
  total            NUMERIC NOT NULL DEFAULT 0,
  product_id       UUID REFERENCES public.products(id),
  account_id       UUID REFERENCES public.accounts(id),
  discount_amount  NUMERIC NOT NULL DEFAULT 0,
  is_tax_inclusive BOOLEAN NOT NULL DEFAULT false,
  tax_code_id      UUID REFERENCES public.tax_codes(id),
  tax_group_id     UUID REFERENCES public.tax_groups(id),
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON public.quotes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_items_parent ON public.quote_items (quote_id);

-- ── Atomic per-tenant/year quote serial (QUO-YYYY-NNNN) ──────────────
CREATE TABLE IF NOT EXISTS public.quote_counters (
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);
ALTER TABLE public.quote_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_quote_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'TENANT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.quote_counters (tenant_id, year, last_number)
  VALUES (p_tenant_id, v_year, 1)
  ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_number = public.quote_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'QUO-' || v_year::TEXT || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_quote_number(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.next_quote_number(UUID) TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotes_rw ON public.quotes;
CREATE POLICY quotes_rw ON public.quotes
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS quote_items_rw ON public.quote_items;
CREATE POLICY quote_items_rw ON public.quote_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q JOIN public.users u ON u.tenant_id = q.tenant_id
                 WHERE q.id = quote_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q JOIN public.users u ON u.tenant_id = q.tenant_id
                 WHERE q.id = quote_id AND u.auth_user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_items TO authenticated;
