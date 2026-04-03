import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Helper: Write audit log
async function writeAuditLog(action: string, tableName: string, recordId?: string, details?: Record<string, any>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const tenantId = await supabase.rpc("get_user_tenant_id");
    const userId = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    await supabase.from("audit_logs").insert({
      action,
      table_name: tableName,
      record_id: recordId,
      user_id: userId.data?.id,
      tenant_id: tenantId.data,
      details: details || null,
    });
  } catch {
    // Silently fail - don't break the main operation
  }
}

// Tenants
export function useTenants() {
  return useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*, subscription_plans(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tenant: { company_name: string; country?: string; industry?: string; subscription_plan_id?: string }) => {
      const { data, error } = await supabase.from("tenants").insert(tenant).select().single();
      if (error) throw error;
      writeAuditLog("Tenant Created", "tenants", data.id, { company_name: tenant.company_name });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Tenant created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; company_name?: string; country?: string; subscription_plan_id?: string }) => {
      const { error } = await supabase.from("tenants").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Tenant Updated", "tenants", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Tenant updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Users
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("*, roles(role_name), tenants(company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (user: { email: string; password: string; first_name: string; last_name: string; role_id: string; tenant_id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("create-user", {
        body: user,
      });

      if (res.error) throw new Error(res.error.message);
      if (!res.data.success) throw new Error(res.data.error || "Failed to create user");

      writeAuditLog("User Created", "users", res.data.user?.id, { email: user.email });
      return res.data.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User created successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Accounts
export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*, account_categories(name)")
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
}

// Active accounts only (for selectors/forms)
export function useActiveAccounts() {
  return useQuery({
    queryKey: ["accounts_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type, account_subtype, is_active")
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (account: { account_name: string; account_code: string; account_type: string; account_subtype?: string; parent_account_id?: string; category_id?: string; created_from?: string }) => {
      const { deriveSubledgerFields, isControlAccount } = await import("@/lib/accountTypes");
      const subledgerFields = deriveSubledgerFields(account.account_subtype);
      const { data, error } = await supabase.from("accounts").insert({
        ...account,
        ...subledgerFields,
        is_control_account: isControlAccount(account.account_subtype),
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Account Created", "accounts", data.id, { account_name: account.account_name, account_code: account.account_code });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Account created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; account_name?: string; account_code?: string; account_type?: string; account_subtype?: string | null; parent_account_id?: string | null; category_id?: string | null; is_active?: boolean }) => {
      // Auto-derive subledger fields if subtype is being updated
      if ('account_subtype' in updates) {
        const { deriveSubledgerFields, isControlAccount } = await import("@/lib/accountTypes");
        const subledgerFields = deriveSubledgerFields(updates.account_subtype);
        Object.assign(updates, subledgerFields, { is_control_account: isControlAccount(updates.account_subtype) });
      }
      const { error } = await supabase.from("accounts").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Account Updated", "accounts", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Journal Entries
export function useJournalEntries() {
  return useQuery({
    queryKey: ["journal_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(*, accounts(account_name, account_code))")
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateJournalEntry() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (entry: { description: string; entry_date: string; reference?: string; lines: { account_id: string; debit: number; credit: number }[] }) => {
      const { data, error } = await supabase.from("journal_entries").insert({
        tenant_id: appUser?.tenant_id,
        description: entry.description,
        entry_date: entry.entry_date,
        reference: entry.reference,
        created_by: appUser?.id,
        status: "posted",
      }).select().single();
      if (error) throw error;

      const lines = entry.lines.map(line => ({
        journal_entry_id: data.id,
        account_id: line.account_id,
        debit: line.debit,
        credit: line.credit,
      }));
      const { error: linesError } = await supabase.from("journal_lines").insert(lines);
      if (linesError) throw linesError;

      writeAuditLog("Journal Entry Posted", "journal_entries", data.id, { description: entry.description, reference: entry.reference });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Journal entry created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Invoices
export function useInvoices() {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(name), payments_received(amount)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data?.map((inv) => {
        const amountPaid = ((inv.payments_received as any[]) || []).reduce(
          (sum: number, p: any) => sum + Number(p.amount), 0
        );
        return { ...inv, amount_paid: amountPaid, balance_due: Number(inv.total_amount) - amountPaid };
      });
    },
  });
}

export function usePaymentsReceived(invoiceId?: string) {
  return useQuery({
    queryKey: ["payments_received", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments_received")
        .select("*")
        .eq("invoice_id", invoiceId!)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId,
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payment: { invoice_id: string; amount: number; payment_method?: string; reference?: string; payment_date?: string }) => {
      const { data, error } = await supabase.from("payments_received").insert({
        ...payment,
        payment_date: payment.payment_date || new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      writeAuditLog("Payment Received", "payments_received", data.id, {
        invoice_id: payment.invoice_id, amount: payment.amount, method: payment.payment_method,
      });
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments_received", vars.invoice_id] });
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (invoice: { customer_id: string; invoice_number: string; issue_date: string; due_date: string; total_amount: number }) => {
      const { data, error } = await supabase.from("invoices").insert({
        ...invoice,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Invoice Created", "invoices", data.id, { invoice_number: invoice.invoice_number, total_amount: invoice.total_amount });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string }) => {
      const { error } = await supabase.from("invoices").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Invoice Updated", "invoices", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Customers
export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (customer: { name: string; email?: string; phone?: string; address?: string }) => {
      const { data, error } = await supabase.from("customers").insert({
        ...customer,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Customer Created", "customers", data.id, { name: customer.name });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Expenses
export function useExpenses() {
  return useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*, expense_categories(name), employees(first_name, last_name)")
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (expense: { amount: number; description?: string; category_id?: string; expense_date: string }) => {
      const { data, error } = await supabase.from("expenses").insert({
        ...expense,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Expense Submitted", "expenses", data.id, { amount: expense.amount, description: expense.description });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Expense submitted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string }) => {
      const { error } = await supabase.from("expenses").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog(`Expense ${updates.status === 'approved' ? 'Approved' : 'Rejected'}`, "expenses", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Expense updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Expense Categories
export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (category: { name: string; account_id?: string }) => {
      const { data, error } = await supabase.from("expense_categories").insert({
        ...category,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense_categories"] });
      toast.success("Category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Petty Cash hooks moved to src/hooks/usePettyCash.ts

// Budgets
export function useBudgets() {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("*, budget_items(*, accounts(account_name), budget_variances(actual_amount, variance))")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (budget: { department: string; period_start: string; period_end: string; total_budget: number }) => {
      const { data, error } = await supabase.from("budgets").insert({
        ...budget,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Budget Created", "budgets", data.id, { department: budget.department, total_budget: budget.total_budget });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateBudgetItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: { budget_id: string; account_id: string; allocated_amount: number }) => {
      const { data, error } = await supabase.from("budget_items").insert(item).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget item added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Audit Logs
export function useAuditLogs() {
  return useQuery({
    queryKey: ["audit_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*, users(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

// Subscription Plans
export function useSubscriptionPlans() {
  return useQuery({
    queryKey: ["subscription_plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("*");
      if (error) throw error;
      return data;
    },
  });
}

// Roles
export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("*");
      if (error) throw error;
      return data;
    },
  });
}

// Employees
export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("first_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (employee: { first_name: string; last_name: string; email?: string; department?: string; salary?: number; hire_date?: string }) => {
      const { data, error } = await supabase.from("employees").insert({
        ...employee,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Employee Created", "employees", data.id, { name: `${employee.first_name} ${employee.last_name}` });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; first_name?: string; last_name?: string; email?: string; department?: string; salary?: number }) => {
      const { error } = await supabase.from("employees").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Products
export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, taxes(tax_name, tax_rate)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (product: { name: string; description?: string; price: number; tax_id?: string; income_account_id?: string }) => {
      const { data, error } = await supabase.from("products").insert({
        ...product,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Taxes
export function useTaxes() {
  return useQuery({
    queryKey: ["taxes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("taxes").select("*").order("tax_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTax() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (tax: { tax_name: string; tax_rate: number }) => {
      const { data, error } = await supabase.from("taxes").insert({
        ...tax,
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taxes"] });
      toast.success("Tax rate created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Payroll Records
export function usePayrollRecords() {
  return useQuery({
    queryKey: ["payroll_records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_records")
        .select("*, employees(first_name, last_name, department)")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePayrollRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: { employee_id: string; period_start: string; period_end: string; gross_salary: number; deductions: number; net_salary: number; payment_date?: string }) => {
      const { data, error } = await supabase.from("payroll_records").insert(record).select().single();
      if (error) throw error;
      writeAuditLog("Payroll Record Created", "payroll_records", data.id, { employee_id: record.employee_id, net_salary: record.net_salary });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll_records"] });
      toast.success("Payroll record created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
