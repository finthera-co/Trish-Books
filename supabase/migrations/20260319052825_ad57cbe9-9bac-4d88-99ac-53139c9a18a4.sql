
-- 1. Central transactions table
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  account_id uuid REFERENCES public.accounts(id),
  category text,
  description text,
  source_type text, -- 'journal_entry', 'invoice', 'expense', 'payment_voucher', 'petty_cash'
  source_id uuid,   -- reference to originating record
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage transactions"
  ON public.transactions FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_transactions_tenant_date ON public.transactions(tenant_id, date);
CREATE INDEX idx_transactions_type ON public.transactions(tenant_id, type);
CREATE INDEX idx_transactions_account ON public.transactions(account_id);

-- 2. Daily balance snapshot table
CREATE TABLE public.daily_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  closing_balance numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, date)
);

ALTER TABLE public.daily_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant daily balances"
  ON public.daily_balances FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage daily balances"
  ON public.daily_balances FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_daily_balances_tenant_date ON public.daily_balances(tenant_id, date);

-- 3. Monthly financials view
CREATE VIEW public.monthly_financials AS
SELECT
  tenant_id,
  DATE_TRUNC('month', date)::date as month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as net
FROM public.transactions
GROUP BY tenant_id, DATE_TRUNC('month', date);

-- 4. Function to recalculate daily balance for a tenant/date
CREATE OR REPLACE FUNCTION public.recalculate_daily_balance(p_tenant_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_balance numeric;
  v_day_income numeric;
  v_day_expense numeric;
  v_closing numeric;
BEGIN
  SELECT COALESCE(closing_balance, 0) INTO v_prev_balance
  FROM daily_balances
  WHERE tenant_id = p_tenant_id AND date < p_date
  ORDER BY date DESC LIMIT 1;

  IF v_prev_balance IS NULL THEN v_prev_balance := 0; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)
  INTO v_day_income, v_day_expense
  FROM transactions
  WHERE tenant_id = p_tenant_id AND date = p_date;

  v_closing := v_prev_balance + v_day_income - v_day_expense;

  INSERT INTO daily_balances (tenant_id, date, closing_balance)
  VALUES (p_tenant_id, p_date, v_closing)
  ON CONFLICT (tenant_id, date)
  DO UPDATE SET closing_balance = EXCLUDED.closing_balance;
END;
$$;

-- 5. Trigger to auto-update daily balance on transaction insert/update/delete
CREATE OR REPLACE FUNCTION public.trigger_update_daily_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_daily_balance(OLD.tenant_id, OLD.date);
    RETURN OLD;
  ELSE
    PERFORM recalculate_daily_balance(NEW.tenant_id, NEW.date);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_transactions_daily_balance
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trigger_update_daily_balance();
