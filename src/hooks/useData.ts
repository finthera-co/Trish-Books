import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sortAccounts } from "@/lib/accountSort";

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
        .order("account_code"); // DB-side fallback
      if (error) throw error;
      return sortAccounts(data ?? []); // enforce central selector order
    },
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (account: { account_name: string; account_code: string; account_type: string; account_subtype?: string; parent_account_id?: string; category_id?: string; created_from?: string }) => {
      const { deriveAccountFlags, inheritParentFlags, buildAccountsMap, getInvalidationKeys } = await import("@/lib/accountMappingEngine");
      const flags = deriveAccountFlags(account.account_subtype);

      // If parent specified, check inheritance
      let inherited: Record<string, any> = {};
      if (account.parent_account_id) {
        const { data: allAccounts } = await supabase
          .from("accounts")
          .select("id, account_type, account_subtype, parent_account_id, is_control_account, subledger_type, requires_subledger")
          .eq("tenant_id", appUser?.tenant_id);
        if (allAccounts) {
          const acctMap = buildAccountsMap(allAccounts);
          const parent = acctMap.get(account.parent_account_id);
          if (parent) {
            inherited = inheritParentFlags(parent, acctMap);
          }
        }
      }

      const { data, error } = await supabase.from("accounts").insert({
        ...account,
        is_control_account: flags.is_control_account,
        requires_subledger: flags.requires_subledger || !!inherited.requires_subledger,
        subledger_type: flags.subledger_type !== "none" ? flags.subledger_type : (inherited.subledger_type || "none"),
        tenant_id: appUser?.tenant_id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Account Created", "accounts", data.id, { account_name: account.account_name, account_code: account.account_code });

      // Invalidate subledger-specific caches
      const stype = flags.subledger_type !== "none" ? flags.subledger_type : (inherited.subledger_type || "none");
      if (stype !== "none") {
        getInvalidationKeys(stype as any).forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["trial_balance"] });
      toast.success("Account created");
    },
    onError: (e: any) => {
      const code = e?.code;
      const msg = String(e?.message || "");
      if (code === "23505" || msg.includes("accounts_tenant_code_unique") || msg.toLowerCase().includes("duplicate key")) {
        toast.error("That account code already exists. Please use a different code.");
        return;
      }
      toast.error(e?.message || "Failed to create account");
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; account_name?: string; account_code?: string; account_type?: string; account_subtype?: string | null; parent_account_id?: string | null; category_id?: string | null; is_active?: boolean }) => {
      // Auto-derive subledger fields if subtype is being updated
      if ('account_subtype' in updates) {
        const { deriveAccountFlags } = await import("@/lib/accountMappingEngine");
        const flags = deriveAccountFlags(updates.account_subtype);
        Object.assign(updates, {
          is_control_account: flags.is_control_account,
          requires_subledger: flags.requires_subledger,
          subledger_type: flags.subledger_type,
        });
      }
      const { error } = await supabase.from("accounts").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Account Updated", "accounts", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["trial_balance"] });
      queryClient.invalidateQueries({ queryKey: ["balance_sheet"] });
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
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
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
        .select("*, customers(name, phone, email), payment_received_allocations(amount, payments_received(status)), ar_credit_notes(amount, status)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data?.map((inv) => {
        // Paid = receipt allocations whose parent receipt is not voided. A single
        // receipt may cover several invoices; allocations carry the per-invoice split.
        const amountPaid = (((inv as any).payment_received_allocations as any[]) || [])
          .filter((a: any) => a.payments_received?.status !== "voided")
          .reduce((sum: number, a: any) => sum + Number(a.amount), 0);
        // Discounts/credits applied to this invoice reduce what's still owed
        const creditTotal = ((inv.ar_credit_notes as any[]) || [])
          .filter((c: any) => c.status !== "voided")
          .reduce((sum: number, c: any) => sum + Number(c.amount), 0);
        return {
          ...inv,
          amount_paid: amountPaid,
          credit_total: creditTotal,
          balance_due: Number(inv.total_amount) - amountPaid - creditTotal,
        };
      });
    },
  });
}

// Per-invoice payment history via allocations (one receipt can span invoices;
// `amount` here is the slice applied to THIS invoice).
export function usePaymentsReceived(invoiceId?: string) {
  return useQuery({
    queryKey: ["payments_received", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_received_allocations" as any)
        .select("amount, payments_received(*)")
        .eq("invoice_id", invoiceId!);
      if (error) throw error;
      return (data || [])
        .filter((row: any) => row.payments_received)
        .map((row: any) => ({
          ...row.payments_received,
          amount: Number(row.amount),
          receipt_total: Number(row.payments_received.amount),
        }))
        .sort((a: any, b: any) => String(b.payment_date).localeCompare(String(a.payment_date)));
    },
    enabled: !!invoiceId,
  });
}

// NOTE: the old useRecordPayment (raw payments_received insert with no GL) was
// removed — receipts are posted server-side via useReceiveCustomerPayment
// (post-payment-received edge function), which books the journal, allocations
// and AR sub-ledgers together.

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

// Approve or reject an invoice pending approval. The approve_invoice RPC enforces
// the approver's role AND segregation of duties (approver ≠ creator) server-side.
export function useApproveInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "approved" | "rejected"; note?: string }) => {
      const { data, error } = await supabase.rpc("approve_invoice" as any, {
        p_invoice_id: id,
        p_decision: decision,
        p_note: note ?? null,
      });
      if (error) throw error;
      return { data: data as any, decision };
    },
    onSuccess: ({ data, decision }) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice_approval_history"] });
      if (decision === "rejected") {
        toast.success("Invoice rejected");
      } else if (data?.final === false) {
        toast.success(`Approval recorded — ${data.collected} of ${data.required} approvals`);
      } else {
        toast.success("Invoice approved");
      }
    },
    onError: (e: Error) => toast.error(e.message.replace(/^.*?:\s*/, "")),
  });
}

// Delete a DRAFT invoice (and its line items). Guards against removing a
// posted invoice — those carry GL/subledger rows and must be voided instead.
export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, invoice_number }: { id: string; invoice_number?: string }) => {
      const { data: inv, error: fetchErr } = await supabase
        .from("invoices")
        .select("status, journal_entry_id, invoice_number")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;
      if (inv.status !== "draft" || inv.journal_entry_id) {
        throw new Error("Only unposted draft invoices can be deleted. Void a posted invoice instead.");
      }
      const { error: itemErr } = await supabase.from("invoice_items").delete().eq("invoice_id", id);
      if (itemErr) throw itemErr;
      // Conditional delete: refuse to remove the header if it slipped out of draft.
      const { error: delErr } = await supabase.from("invoices").delete().eq("id", id).eq("status", "draft");
      if (delErr) throw delErr;
      // IRD serial accounting: mark the reserved number cancelled (not a gap).
      const serial = invoice_number || (inv as any).invoice_number;
      if (serial) {
        await supabase.rpc("cancel_invoice_serial" as any, { p_serial: serial, p_reason: "Draft invoice deleted" });
      }
      writeAuditLog("Invoice Deleted", "invoices", id, { invoice_number: serial });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Draft invoice deleted");
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
    mutationFn: async (expense: { amount: number; description?: string; category_id?: string; expense_date: string; payment_account_id?: string }) => {
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

// Approve an expense: posts a balanced journal entry (Dr category GL / Cr
// paid-through account) via the approve_expense RPC, mirroring the Payment
// Voucher / Petty Cash posting flow. Use useUpdateExpense for rejection only.
export function useApproveExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("approve_expense", { p_expense_id: id });
      if (error) throw error;
      writeAuditLog("Expense Approved", "expenses", id, { journal_entry_id: data });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_journals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_expenses"] });
      toast.success("Expense approved and posted to the ledger");
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

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; account_id?: string | null }) => {
      const { data, error } = await supabase.from("expense_categories").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense_categories"] });
      toast.success("Category updated");
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
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (item: { budget_id: string; account_id: string; allocated_amount: number }) => {
      const { data, error } = await supabase
        .from("budget_items")
        .insert([{ ...item, tenant_id: appUser!.tenant_id }])
        .select()
        .single();
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
    mutationFn: async (employee: {
      first_name: string; last_name: string;
      email?: string; personal_phone?: string;
      nic_number?: string; tin_number?: string;
      date_of_birth?: string; gender?: string; civil_status?: string;
      address_line1?: string; address_line2?: string; city?: string; district?: string; postal_code?: string;
      designation?: string; department?: string; hire_date?: string;
      employment_type?: string; pay_rate_type?: string; status?: string;
      manager_id?: string; biometric_id?: string;
      epf_number?: string; is_epf_applicable?: boolean; is_etf_applicable?: boolean; is_paye_applicable?: boolean;
      bank_name?: string; bank_branch?: string; bank_account_no?: string; bank_account_name?: string;
    }) => {
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

/**
 * Creates an employee together with a self-service login account (role 'Employee')
 * in one atomic server call. Used when the admin supplies an email + temp password.
 */
export function useProvisionEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("provision-employee", { body: payload });
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error(res.data?.error || "Failed to provision employee");
      writeAuditLog("Employee Provisioned", "employees", res.data.employee?.id, { email: payload.email });
      return res.data.employee;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee added with login access");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: {
      id: string;
      first_name?: string; last_name?: string;
      email?: string; personal_phone?: string;
      nic_number?: string; tin_number?: string;
      date_of_birth?: string; gender?: string; civil_status?: string;
      address_line1?: string; address_line2?: string; city?: string; district?: string; postal_code?: string;
      designation?: string; department?: string; hire_date?: string;
      employment_type?: string; pay_rate_type?: string; status?: string;
      manager_id?: string; biometric_id?: string;
      epf_number?: string; is_epf_applicable?: boolean; is_etf_applicable?: boolean; is_paye_applicable?: boolean;
      bank_name?: string; bank_branch?: string; bank_account_no?: string; bank_account_name?: string;
    }) => {
      const { error } = await supabase.from("employees").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Employee Updated", "employees", id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      // Block deletion when payroll history exists — those records reference this employee.
      const { count, error: countError } = await supabase
        .from("payroll_records")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", id);
      if (countError) throw countError;
      if (count && count > 0) {
        throw new Error("Cannot delete an employee with payroll history. Set their status to Inactive instead.");
      }

      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
      writeAuditLog("Employee Deleted", "employees", id, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee deleted");
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
        .select("*, taxes(tax_name, tax_rate), inventory_item:inventory_items(quantity_on_hand, selling_price, unit_cost, last_purchase_price)")
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
    mutationFn: async (product: { name: string; description?: string; price: number; tax_id?: string; default_tax_group_id?: string | null; default_tax_code_id?: string | null; income_account_id?: string; expense_account_id?: string; asset_account_id?: string; type?: string; inventory_item_id?: string; is_tracked?: never }) => {
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

// Employee compensation (dated history)
export function useEmployeeCompensation(employeeId?: string) {
  return useQuery({
    queryKey: ["employee_compensation", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_compensation")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddCompensation() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (payload: {
      employee_id: string; effective_from: string;
      basic_salary: number; pay_rate?: number; pay_frequency?: string; notes?: string;
    }) => {
      const { data, error } = await supabase.from("employee_compensation").insert({
        ...payload,
        is_current: true,
        tenant_id: appUser?.tenant_id,
        created_by: appUser?.id,
      }).select().single();
      if (error) throw error;
      writeAuditLog("Compensation Updated", "employee_compensation", data.id,
        { employee_id: payload.employee_id, basic_salary: payload.basic_salary });
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["employee_compensation", vars.employee_id] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Compensation updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
