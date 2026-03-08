
-- =============================================
-- UTILITY FUNCTION: update_updated_at_column
-- =============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =============================================
-- 1. SAAS PLATFORM TABLES
-- =============================================

-- Subscription Plans
CREATE TABLE public.subscription_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_users INTEGER NOT NULL DEFAULT 3,
  features_json JSONB DEFAULT '{}',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view plans" ON public.subscription_plans FOR SELECT USING (true);

-- Tenants
CREATE TABLE public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  industry TEXT,
  country TEXT,
  subscription_plan_id UUID REFERENCES public.subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Subscriptions
CREATE TABLE public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  payment_provider_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Payments
CREATE TABLE public.payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 2. USER & ACCESS CONTROL
-- =============================================

-- Roles
CREATE TABLE public.roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE,
  description TEXT
);
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view roles" ON public.roles FOR SELECT USING (true);

-- Permissions
CREATE TABLE public.permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  permission_name TEXT NOT NULL UNIQUE,
  description TEXT
);
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view permissions" ON public.permissions FOR SELECT USING (true);

-- Role Permissions
CREATE TABLE public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view role_permissions" ON public.role_permissions FOR SELECT USING (true);

-- Users (app users, not auth.users)
CREATE TABLE public.users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role_id UUID REFERENCES public.roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Security definer function to get tenant_id for current user
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Security definer function to check user role
CREATE OR REPLACE FUNCTION public.get_user_role_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.role_name FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid() LIMIT 1;
$$;

-- Security definer to check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.auth_user_id = auth.uid() AND r.role_name = 'Super Admin'
  );
$$;

-- Tenant RLS policies (uses security definer functions to avoid recursion)
CREATE POLICY "Super admins can view all tenants" ON public.tenants FOR SELECT USING (public.is_super_admin());
CREATE POLICY "Users can view own tenant" ON public.tenants FOR SELECT USING (id = public.get_user_tenant_id());
CREATE POLICY "Super admins can manage tenants" ON public.tenants FOR ALL USING (public.is_super_admin());

-- Users RLS
CREATE POLICY "Users can view users in own tenant" ON public.users FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Super admins can manage users" ON public.users FOR ALL USING (public.is_super_admin());
CREATE POLICY "Company admins can manage tenant users" ON public.users FOR ALL USING (
  tenant_id = public.get_user_tenant_id() AND public.get_user_role_name() = 'Company Admin'
);

-- Subscriptions RLS
CREATE POLICY "Users can view own tenant subscriptions" ON public.subscriptions FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Super admins can manage subscriptions" ON public.subscriptions FOR ALL USING (public.is_super_admin());

-- Payments RLS
CREATE POLICY "Users can view own tenant payments" ON public.payments FOR SELECT USING (
  subscription_id IN (SELECT id FROM public.subscriptions WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);

-- Audit Logs
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant audit logs" ON public.audit_logs FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- =============================================
-- 3. CHART OF ACCOUNTS
-- =============================================

-- Account Types
CREATE TABLE public.account_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type_name TEXT NOT NULL UNIQUE
);
ALTER TABLE public.account_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view account types" ON public.account_types FOR SELECT USING (true);

-- Accounts
CREATE TABLE public.accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_type TEXT NOT NULL,
  parent_account_id UUID REFERENCES public.accounts(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, account_code)
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant accounts" ON public.accounts FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage accounts" ON public.accounts FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Cost Centers
CREATE TABLE public.cost_centers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant cost centers" ON public.cost_centers FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage cost centers" ON public.cost_centers FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- =============================================
-- 4. DOUBLE ENTRY ACCOUNTING ENGINE
-- =============================================

-- Journal Entries
CREATE TABLE public.journal_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant journal entries" ON public.journal_entries FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage journal entries" ON public.journal_entries FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Journal Lines
CREATE TABLE public.journal_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_center_id UUID REFERENCES public.cost_centers(id)
);
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant journal lines" ON public.journal_lines FOR SELECT USING (
  journal_entry_id IN (SELECT id FROM public.journal_entries WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage journal lines" ON public.journal_lines FOR ALL USING (
  journal_entry_id IN (SELECT id FROM public.journal_entries WHERE tenant_id = public.get_user_tenant_id())
);

-- Ledger Balances
CREATE TABLE public.ledger_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(account_id, period)
);
ALTER TABLE public.ledger_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant ledger balances" ON public.ledger_balances FOR SELECT USING (
  account_id IN (SELECT id FROM public.accounts WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);

-- =============================================
-- 5. CUSTOMER MANAGEMENT
-- =============================================

CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant customers" ON public.customers FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage customers" ON public.customers FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE TABLE public.customer_addresses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  address_line1 TEXT,
  city TEXT,
  country TEXT,
  postal_code TEXT
);
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant customer addresses" ON public.customer_addresses FOR SELECT USING (
  customer_id IN (SELECT id FROM public.customers WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage customer addresses" ON public.customer_addresses FOR ALL USING (
  customer_id IN (SELECT id FROM public.customers WHERE tenant_id = public.get_user_tenant_id())
);

-- =============================================
-- 6. INVOICING SYSTEM
-- =============================================

CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, invoice_number)
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant invoices" ON public.invoices FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage invoices" ON public.invoices FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Taxes
CREATE TABLE public.taxes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_name TEXT NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant taxes" ON public.taxes FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage taxes" ON public.taxes FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Products
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  income_account_id UUID REFERENCES public.accounts(id),
  tax_id UUID REFERENCES public.taxes(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant products" ON public.products FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage products" ON public.products FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Product Categories
CREATE TABLE public.product_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL
);
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant product categories" ON public.product_categories FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage product categories" ON public.product_categories FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Invoice Items
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  description TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_id UUID REFERENCES public.taxes(id),
  total NUMERIC(14,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant invoice items" ON public.invoice_items FOR SELECT USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage invoice items" ON public.invoice_items FOR ALL USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = public.get_user_tenant_id())
);

-- Payments Received
CREATE TABLE public.payments_received (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  payment_method TEXT,
  reference TEXT
);
ALTER TABLE public.payments_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant payments received" ON public.payments_received FOR SELECT USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage payments received" ON public.payments_received FOR ALL USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = public.get_user_tenant_id())
);

-- Tax Records
CREATE TABLE public.tax_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tax_id UUID NOT NULL REFERENCES public.taxes(id),
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.tax_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant tax records" ON public.tax_records FOR SELECT USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);

-- =============================================
-- 7. EXPENSE MANAGEMENT
-- =============================================

-- Expense Categories
CREATE TABLE public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES public.accounts(id)
);
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant expense categories" ON public.expense_categories FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage expense categories" ON public.expense_categories FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Employees
CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  salary NUMERIC(12,2),
  hire_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant employees" ON public.employees FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage employees" ON public.employees FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Expenses
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.expense_categories(id),
  employee_id UUID REFERENCES public.employees(id),
  amount NUMERIC(12,2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant expenses" ON public.expenses FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage expenses" ON public.expenses FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- =============================================
-- 8. PETTY CASH
-- =============================================

CREATE TABLE public.petty_cash_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.petty_cash_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant petty cash accounts" ON public.petty_cash_accounts FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage petty cash accounts" ON public.petty_cash_accounts FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE TABLE public.petty_cash_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  petty_cash_account_id UUID NOT NULL REFERENCES public.petty_cash_accounts(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  transaction_type TEXT NOT NULL,
  description TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.petty_cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant petty cash transactions" ON public.petty_cash_transactions FOR SELECT USING (
  petty_cash_account_id IN (SELECT id FROM public.petty_cash_accounts WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage petty cash transactions" ON public.petty_cash_transactions FOR ALL USING (
  petty_cash_account_id IN (SELECT id FROM public.petty_cash_accounts WHERE tenant_id = public.get_user_tenant_id())
);

-- =============================================
-- 9. BUDGETING
-- =============================================

CREATE TABLE public.budgets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant budgets" ON public.budgets FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY "Authorized users can manage budgets" ON public.budgets FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE TABLE public.budget_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  allocated_amount NUMERIC(14,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant budget items" ON public.budget_items FOR SELECT USING (
  budget_id IN (SELECT id FROM public.budgets WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage budget items" ON public.budget_items FOR ALL USING (
  budget_id IN (SELECT id FROM public.budgets WHERE tenant_id = public.get_user_tenant_id())
);

CREATE TABLE public.budget_variances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  actual_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance NUMERIC(14,2) NOT NULL DEFAULT 0,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.budget_variances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant budget variances" ON public.budget_variances FOR SELECT USING (
  budget_item_id IN (
    SELECT bi.id FROM public.budget_items bi
    JOIN public.budgets b ON b.id = bi.budget_id
    WHERE b.tenant_id = public.get_user_tenant_id()
  ) OR public.is_super_admin()
);

-- =============================================
-- 10. PAYROLL
-- =============================================

CREATE TABLE public.payroll_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant payroll records" ON public.payroll_records FOR SELECT USING (
  employee_id IN (SELECT id FROM public.employees WHERE tenant_id = public.get_user_tenant_id()) OR public.is_super_admin()
);
CREATE POLICY "Authorized users can manage payroll records" ON public.payroll_records FOR ALL USING (
  employee_id IN (SELECT id FROM public.employees WHERE tenant_id = public.get_user_tenant_id())
);

-- =============================================
-- 11. REPORTING
-- =============================================

CREATE TABLE public.financial_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  file_url TEXT
);
ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant financial reports" ON public.financial_reports FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE TABLE public.report_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_name TEXT NOT NULL,
  data_json JSONB,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.report_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tenant report cache" ON public.report_cache FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- =============================================
-- 12. STORAGE BUCKET FOR RECEIPTS
-- =============================================

INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false);

CREATE POLICY "Users can upload receipts" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'receipts' AND auth.uid() IS NOT NULL);
CREATE POLICY "Users can view own receipts" ON storage.objects FOR SELECT USING (bucket_id = 'receipts' AND auth.uid() IS NOT NULL);

-- =============================================
-- 13. SEED DEFAULT DATA
-- =============================================

-- Default roles
INSERT INTO public.roles (role_name, description) VALUES
  ('Super Admin', 'Full system access across all tenants'),
  ('Company Admin', 'Full access within their tenant'),
  ('Accountant', 'Financial module access'),
  ('Staff', 'Basic access, submit expenses');

-- Default account types
INSERT INTO public.account_types (type_name) VALUES
  ('Asset'), ('Liability'), ('Equity'), ('Revenue'), ('Expense');

-- Default subscription plans
INSERT INTO public.subscription_plans (name, price, max_users, features_json, billing_cycle) VALUES
  ('Starter', 15.00, 3, '{"modules": ["accounts", "journals", "reports"]}', 'monthly'),
  ('Business', 35.00, 10, '{"modules": ["accounts", "journals", "reports", "invoicing", "expenses", "budgeting", "audit"]}', 'monthly');

-- Default permissions
INSERT INTO public.permissions (permission_name, description) VALUES
  ('manage_tenants', 'Create and manage tenants'),
  ('manage_users', 'Create and manage users'),
  ('manage_accounts', 'Manage chart of accounts'),
  ('manage_journals', 'Create and manage journal entries'),
  ('manage_invoices', 'Create and manage invoices'),
  ('manage_expenses', 'Submit and manage expenses'),
  ('manage_budgets', 'Create and manage budgets'),
  ('view_reports', 'View financial reports'),
  ('manage_petty_cash', 'Manage petty cash'),
  ('view_audit_logs', 'View audit logs');

-- =============================================
-- 14. TRIGGERS
-- =============================================

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 15. INDEXES
-- =============================================

CREATE INDEX idx_users_tenant_id ON public.users(tenant_id);
CREATE INDEX idx_users_auth_user_id ON public.users(auth_user_id);
CREATE INDEX idx_accounts_tenant_id ON public.accounts(tenant_id);
CREATE INDEX idx_journal_entries_tenant_id ON public.journal_entries(tenant_id);
CREATE INDEX idx_journal_entries_entry_date ON public.journal_entries(entry_date);
CREATE INDEX idx_journal_lines_entry_id ON public.journal_lines(journal_entry_id);
CREATE INDEX idx_invoices_tenant_id ON public.invoices(tenant_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_expenses_tenant_id ON public.expenses(tenant_id);
CREATE INDEX idx_expenses_status ON public.expenses(status);
CREATE INDEX idx_audit_logs_tenant_id ON public.audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at);
CREATE INDEX idx_budgets_tenant_id ON public.budgets(tenant_id);
CREATE INDEX idx_customers_tenant_id ON public.customers(tenant_id);
