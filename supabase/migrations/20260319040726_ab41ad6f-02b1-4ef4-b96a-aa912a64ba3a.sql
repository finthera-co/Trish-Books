
-- 1. Create departments table
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant departments"
  ON public.departments FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage departments"
  ON public.departments FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- 2. Add new columns to budgets table
ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'monthly';

-- 3. Add warning_threshold and department_id to budget_items
ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS warning_threshold numeric NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

-- 4. Create budget_transactions table for tracking usage
CREATE TABLE IF NOT EXISTS public.budget_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_line_id uuid NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  reference_type text NOT NULL, -- 'journal', 'petty_cash', 'payment_voucher'
  reference_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant budget transactions"
  ON public.budget_transactions FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Authorized users can manage budget transactions"
  ON public.budget_transactions FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- 5. Create budget usage calculation function
CREATE OR REPLACE FUNCTION public.calculate_budget_usage(
  p_account_id uuid,
  p_start_date date,
  p_end_date date,
  p_department_id uuid DEFAULT NULL
)
RETURNS TABLE(
  allocated_amount numeric,
  actual_amount numeric,
  remaining_amount numeric,
  utilization_percentage numeric,
  warning_threshold numeric,
  budget_line_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    bi.allocated_amount,
    COALESCE((
      SELECT SUM(
        CASE 
          WHEN a.normal_balance = 'debit' THEN jl.debit - jl.credit
          ELSE jl.credit - jl.debit
        END
      )
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.account_id = p_account_id
        AND je.status = 'posted'
        AND je.entry_date BETWEEN p_start_date AND p_end_date
        AND je.tenant_id = b.tenant_id
    ), 0) AS actual_amount,
    bi.allocated_amount - COALESCE((
      SELECT SUM(
        CASE 
          WHEN a.normal_balance = 'debit' THEN jl.debit - jl.credit
          ELSE jl.credit - jl.debit
        END
      )
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.account_id = p_account_id
        AND je.status = 'posted'
        AND je.entry_date BETWEEN p_start_date AND p_end_date
        AND je.tenant_id = b.tenant_id
    ), 0) AS remaining_amount,
    CASE 
      WHEN bi.allocated_amount > 0 THEN 
        ROUND(COALESCE((
          SELECT SUM(
            CASE 
              WHEN a.normal_balance = 'debit' THEN jl.debit - jl.credit
              ELSE jl.credit - jl.debit
            END
          )
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.journal_entry_id
          JOIN accounts a ON a.id = jl.account_id
          WHERE jl.account_id = p_account_id
            AND je.status = 'posted'
            AND je.entry_date BETWEEN p_start_date AND p_end_date
            AND je.tenant_id = b.tenant_id
        ), 0) / bi.allocated_amount * 100, 2)
      ELSE 0
    END AS utilization_percentage,
    bi.warning_threshold,
    bi.id AS budget_line_id
  FROM budget_items bi
  JOIN budgets b ON b.id = bi.budget_id
  WHERE bi.account_id = p_account_id
    AND b.status = 'active'
    AND b.period_start <= p_end_date
    AND b.period_end >= p_start_date
    AND (p_department_id IS NULL OR bi.department_id = p_department_id)
  LIMIT 1;
$$;

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_budget_items_account_id ON public.budget_items(account_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_budget_line_id ON public.budget_transactions(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_date ON public.budget_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_budgets_status ON public.budgets(status);
CREATE INDEX IF NOT EXISTS idx_budgets_period ON public.budgets(period_start, period_end);
