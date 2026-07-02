-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-currency AR (IAS 21) — realized FX on settlement + period-end revaluation
--
-- Base/functional currency is LKR. A foreign-currency invoice stores its document
-- amounts in the foreign currency plus an exchange_rate (foreign → base) at the
-- invoice date; post-invoice books the GL in BASE by multiplying by that rate.
-- On payment, the difference between the AR booked at the invoice rate and cash
-- received at the settlement rate is a realized FX gain/loss. At period end, open
-- foreign AR is revalued to the closing rate (unrealized) and reversed next period.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Exchange-rate table (one rate per currency per date) ─────────────
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  currency     TEXT NOT NULL,                 -- ISO 4217, e.g. 'USD'
  rate_date    DATE NOT NULL,
  rate_to_base NUMERIC NOT NULL CHECK (rate_to_base > 0),  -- base units per 1 foreign unit
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, currency, rate_date)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON public.exchange_rates (tenant_id, currency, rate_date DESC);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exchange_rates_rw ON public.exchange_rates;
CREATE POLICY exchange_rates_rw ON public.exchange_rates
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exchange_rates TO authenticated;

-- Latest rate on/before a date; base currency (LKR) and unknowns resolve to 1.
CREATE OR REPLACE FUNCTION public.fx_rate(p_tenant_id UUID, p_currency TEXT, p_date DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rate NUMERIC;
BEGIN
  IF p_currency IS NULL OR p_currency = 'LKR' THEN RETURN 1; END IF;
  SELECT rate_to_base INTO v_rate
  FROM public.exchange_rates
  WHERE tenant_id = p_tenant_id AND currency = p_currency AND rate_date <= p_date
  ORDER BY rate_date DESC LIMIT 1;
  RETURN COALESCE(v_rate, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fx_rate(UUID, TEXT, DATE) TO authenticated, service_role;

-- ── Per-invoice exchange rate (foreign → base at invoice date) ───────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.invoices.exchange_rate IS
  'Foreign→base (LKR) rate at the invoice date. Document amounts are in invoices.currency; GL is booked in base = amount × exchange_rate.';

-- ── Period-end revaluation log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_fx_revaluations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_end               DATE NOT NULL,
  invoice_id               UUID REFERENCES public.invoices(id),
  currency                 TEXT NOT NULL,
  open_amount_fc           NUMERIC NOT NULL,     -- outstanding in foreign currency
  rate_invoice             NUMERIC NOT NULL,
  rate_period_end          NUMERIC NOT NULL,
  base_at_invoice          NUMERIC NOT NULL,
  base_at_period_end       NUMERIC NOT NULL,
  fx_delta                 NUMERIC NOT NULL,     -- +gain / −loss (base)
  journal_entry_id         UUID REFERENCES public.journal_entries(id),
  reversal_journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by               UUID REFERENCES public.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ar_fx_reval_tenant ON public.ar_fx_revaluations (tenant_id, period_end DESC);

ALTER TABLE public.ar_fx_revaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ar_fx_reval_select ON public.ar_fx_revaluations;
CREATE POLICY ar_fx_reval_select ON public.ar_fx_revaluations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT ON public.ar_fx_revaluations TO authenticated;

-- ── Period-end revaluation routine ───────────────────────────────────
-- Revalues every open foreign-currency invoice to the closing rate, posts ONE
-- net FX adjustment journal at period_end, and an auto-reversal at period_end+1
-- (unrealized FX must not persist into the next period). Idempotent per period:
-- re-running for the same period_end first removes that period's prior run.
CREATE OR REPLACE FUNCTION public.revalue_ar_fx(p_period_end DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_tenant_id UUID;
  v_role      TEXT;
  v_ar_acct   UUID;
  v_gain_acct UUID;
  v_loss_acct UUID;
  v_net       NUMERIC := 0;
  v_count     INTEGER := 0;
  v_je        UUID;
  v_rev_je    UUID;
  r           RECORD;
  v_base_out  NUMERIC;
  v_fc_out    NUMERIC;
  v_pe_rate   NUMERIC;
  v_base_pe   NUMERIC;
  v_delta     NUMERIC;
BEGIN
  SELECT u.id, u.tenant_id, rl.role_name INTO v_user_id, v_tenant_id, v_role
  FROM public.users u LEFT JOIN public.roles rl ON rl.id = u.role_id
  WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role NOT IN ('Super Admin','Primary Admin','Company Admin','Accountant') THEN
    RAISE EXCEPTION 'ROLE_CANNOT_REVALUE: %', COALESCE(v_role,'unknown') USING ERRCODE = 'P0001';
  END IF;

  SELECT ar_account_id, fx_gain_account_id, fx_loss_account_id
    INTO v_ar_acct, v_gain_acct, v_loss_acct
  FROM public.account_settings WHERE tenant_id = v_tenant_id;
  IF v_ar_acct IS NULL OR v_gain_acct IS NULL OR v_loss_acct IS NULL THEN
    RAISE EXCEPTION 'FX accounts not configured (Settings → Account Mapping: AR, FX Gain, FX Loss)' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: clear any prior run for this period (incl. its journals).
  FOR r IN SELECT journal_entry_id, reversal_journal_entry_id FROM public.ar_fx_revaluations
           WHERE tenant_id = v_tenant_id AND period_end = p_period_end LOOP
    DELETE FROM public.journal_lines WHERE journal_entry_id IN (r.journal_entry_id, r.reversal_journal_entry_id);
    DELETE FROM public.journal_entries WHERE id IN (r.journal_entry_id, r.reversal_journal_entry_id);
  END LOOP;
  DELETE FROM public.ar_fx_revaluations WHERE tenant_id = v_tenant_id AND period_end = p_period_end;

  -- Adjustment + reversal journal headers (lines added once we know the net).
  INSERT INTO public.journal_entries (tenant_id, entry_date, description, status, posted_at, created_by, is_system_generated, entry_type, source_type)
  VALUES (v_tenant_id, p_period_end, 'AR FX revaluation ' || p_period_end, 'posted', now(), v_user_id, true, 'fx_revaluation', 'fx_revaluation')
  RETURNING id INTO v_je;
  INSERT INTO public.journal_entries (tenant_id, entry_date, description, status, posted_at, created_by, is_system_generated, entry_type, source_type, reversal_of)
  VALUES (v_tenant_id, p_period_end + 1, 'Reversal: AR FX revaluation ' || p_period_end, 'posted', now(), v_user_id, true, 'fx_revaluation_reversal', 'fx_revaluation_reversal', v_je)
  RETURNING id INTO v_rev_je;

  -- One reval row per open foreign invoice.
  FOR r IN
    SELECT i.id, i.currency, i.exchange_rate,
           COALESCE((SELECT SUM(t.outstanding_amount) FROM public.ar_transactions t
                     WHERE t.document_id = i.id AND t.status IN ('OPEN','PARTIALLY_PAID')), 0) AS base_out
    FROM public.invoices i
    WHERE i.tenant_id = v_tenant_id
      AND i.currency IS NOT NULL AND i.currency <> 'LKR'
      AND i.status NOT IN ('draft','voided')
      AND i.issue_date <= p_period_end
  LOOP
    v_base_out := COALESCE(r.base_out, 0);
    IF v_base_out <= 0 OR r.exchange_rate IS NULL OR r.exchange_rate <= 0 THEN CONTINUE; END IF;
    v_fc_out  := v_base_out / r.exchange_rate;                 -- foreign outstanding (AR cleared at invoice rate)
    v_pe_rate := public.fx_rate(v_tenant_id, r.currency, p_period_end);
    v_base_pe := round(v_fc_out * v_pe_rate, 2);
    v_delta   := round(v_base_pe - v_base_out, 2);
    IF v_delta = 0 THEN CONTINUE; END IF;

    v_net := v_net + v_delta;
    v_count := v_count + 1;
    INSERT INTO public.ar_fx_revaluations (
      tenant_id, period_end, invoice_id, currency, open_amount_fc, rate_invoice, rate_period_end,
      base_at_invoice, base_at_period_end, fx_delta, journal_entry_id, reversal_journal_entry_id, created_by)
    VALUES (v_tenant_id, p_period_end, r.id, r.currency, round(v_fc_out,2), r.exchange_rate, v_pe_rate,
            v_base_out, v_base_pe, v_delta, v_je, v_rev_je, v_user_id);
  END LOOP;

  v_net := round(v_net, 2);
  IF v_count = 0 OR v_net = 0 THEN
    -- Nothing to post; drop the empty journals + rows.
    DELETE FROM public.journal_entries WHERE id IN (v_je, v_rev_je);
    DELETE FROM public.ar_fx_revaluations WHERE tenant_id = v_tenant_id AND period_end = p_period_end;
    RETURN jsonb_build_object('ok', true, 'invoices', v_count, 'net_fx', 0, 'message', 'No FX adjustment needed');
  END IF;

  -- Net > 0 → AR worth more in base: Dr AR / Cr FX gain. Net < 0 → Dr FX loss / Cr AR.
  IF v_net > 0 THEN
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_je, v_ar_acct, v_net, 0), (v_je, v_gain_acct, 0, v_net);
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_rev_je, v_ar_acct, 0, v_net), (v_rev_je, v_gain_acct, v_net, 0);
  ELSE
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_je, v_loss_acct, -v_net, 0), (v_je, v_ar_acct, 0, -v_net);
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit) VALUES
      (v_rev_je, v_loss_acct, 0, -v_net), (v_rev_je, v_ar_acct, -v_net, 0);
  END IF;

  RETURN jsonb_build_object('ok', true, 'invoices', v_count, 'net_fx', v_net,
                            'journal_id', v_je, 'reversal_journal_id', v_rev_je);
END;
$$;

REVOKE ALL ON FUNCTION public.revalue_ar_fx(DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.revalue_ar_fx(DATE) TO authenticated;

