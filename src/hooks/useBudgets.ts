import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Departments ───
export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const { data, error } = await supabase
        .from("departments")
        .insert({ ...input, tenant_id: appUser!.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Enhanced Budgets ───
export function useEnhancedBudgets(filters?: { status?: string; departmentId?: string }) {
  return useQuery({
    queryKey: ["enhanced_budgets", filters],
    queryFn: async () => {
      let query = supabase
        .from("budgets")
        .select("*, budget_items(*, accounts(account_name, account_code, account_type), departments(name))")
        .order("created_at", { ascending: false });

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateEnhancedBudget() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (budget: {
      name: string;
      department: string;
      period_start: string;
      period_end: string;
      total_budget: number;
      status?: string;
      period_type?: string;
    }) => {
      const { data, error } = await supabase
        .from("budgets")
        .insert({
          ...budget,
          status: budget.status || "draft",
          period_type: budget.period_type || "monthly",
          tenant_id: appUser!.tenant_id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enhanced_budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateBudgetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("budgets")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enhanced_budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateNewVersion() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (budgetId: string) => {
      // Get current budget
      const { data: current, error: fetchError } = await supabase
        .from("budgets")
        .select("*, budget_items(*)")
        .eq("id", budgetId)
        .single();
      if (fetchError) throw fetchError;

      // Create new version
      const { data: newBudget, error: createError } = await supabase
        .from("budgets")
        .insert({
          name: current.name,
          department: current.department,
          period_start: current.period_start,
          period_end: current.period_end,
          total_budget: current.total_budget,
          status: "draft",
          period_type: (current as any).period_type || "monthly",
          version: ((current as any).version || 1) + 1,
          tenant_id: appUser!.tenant_id,
        })
        .select()
        .single();
      if (createError) throw createError;

      // Copy budget items
      const items = (current.budget_items as any[]) || [];
      if (items.length > 0) {
        const newItems = items.map((item: any) => ({
          budget_id: newBudget.id,
          account_id: item.account_id,
          allocated_amount: item.allocated_amount,
          warning_threshold: item.warning_threshold || 0.8,
          department_id: item.department_id,
        }));
        const { error: itemsError } = await supabase
          .from("budget_items")
          .insert(newItems);
        if (itemsError) throw itemsError;
      }

      // Close old version
      await supabase
        .from("budgets")
        .update({ status: "closed" })
        .eq("id", budgetId);

      return newBudget;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enhanced_budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("New budget version created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: {
      budget_id: string;
      account_id: string;
      allocated_amount: number;
      warning_threshold?: number;
      department_id?: string;
    }) => {
      const { data, error } = await supabase
        .from("budget_items")
        .insert({
          ...item,
          warning_threshold: item.warning_threshold ?? 0.8,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enhanced_budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget line added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Budget Usage Calculation ───
export interface BudgetUsage {
  allocated_amount: number;
  actual_amount: number;
  remaining_amount: number;
  utilization_percentage: number;
  warning_threshold: number;
  budget_line_id: string;
}

export function useBudgetUsage(accountId: string | undefined, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["budget_usage", accountId, startDate, endDate],
    enabled: !!accountId && !!startDate && !!endDate,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("calculate_budget_usage", {
        p_account_id: accountId!,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return (data as BudgetUsage[] | null)?.[0] || null;
    },
  });
}

// ─── Budget Usage for all lines of a budget ───
export function useBudgetLineUsages(budgetId: string | undefined) {
  return useQuery({
    queryKey: ["budget_line_usages", budgetId],
    enabled: !!budgetId,
    queryFn: async () => {
      // Get budget with items
      const { data: budget, error: bErr } = await supabase
        .from("budgets")
        .select("*, budget_items(*, accounts(account_name, account_code, account_type, normal_balance), departments(name))")
        .eq("id", budgetId!)
        .single();
      if (bErr) throw bErr;

      const items = (budget.budget_items as any[]) || [];
      const startDate = budget.period_start;
      const endDate = budget.period_end;

      // For each item, calculate usage from journal entries
      const results = await Promise.all(
        items.map(async (item: any) => {
          const { data } = await supabase.rpc("calculate_budget_usage", {
            p_account_id: item.account_id,
            p_start_date: startDate,
            p_end_date: endDate,
          });
          const usage = (data as BudgetUsage[] | null)?.[0];
          return {
            ...item,
            actual_amount: usage?.actual_amount || 0,
            remaining_amount: usage?.remaining_amount || item.allocated_amount,
            utilization_percentage: usage?.utilization_percentage || 0,
          };
        })
      );

      return { budget, lines: results };
    },
  });
}

// ─── Budget Check (for transaction validation) ───
export async function checkBudgetForTransaction(
  accountId: string,
  amount: number,
  transactionDate: string
): Promise<{
  hasBudget: boolean;
  exceeded: boolean;
  warning: boolean;
  message: string;
  usage?: BudgetUsage;
}> {
  const date = new Date(transactionDate);
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split("T")[0];
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split("T")[0];

  // Try monthly first, then use broader date range
  const { data, error } = await supabase.rpc("calculate_budget_usage", {
    p_account_id: accountId,
    p_start_date: startOfMonth,
    p_end_date: endOfMonth,
  });

  if (error || !data || (data as any[]).length === 0) {
    return { hasBudget: false, exceeded: false, warning: false, message: "No active budget for this account" };
  }

  const usage = (data as BudgetUsage[])[0];
  const newTotal = usage.actual_amount + amount;
  const newUtilization = usage.allocated_amount > 0 ? newTotal / usage.allocated_amount : 0;

  if (newTotal > usage.allocated_amount) {
    return {
      hasBudget: true,
      exceeded: true,
      warning: true,
      message: `Budget exceeded! Allocated: ${usage.allocated_amount.toLocaleString()}, After this: ${newTotal.toLocaleString()} (${(newUtilization * 100).toFixed(0)}%)`,
      usage,
    };
  }

  if (newUtilization >= usage.warning_threshold) {
    return {
      hasBudget: true,
      exceeded: false,
      warning: true,
      message: `Budget warning: ${(newUtilization * 100).toFixed(0)}% utilized after this transaction`,
      usage,
    };
  }

  return {
    hasBudget: true,
    exceeded: false,
    warning: false,
    message: `Budget OK: ${(newUtilization * 100).toFixed(0)}% utilized after this transaction`,
    usage,
  };
}

// ─── Budget Transactions Log ───
export function useBudgetTransactions(budgetLineId?: string) {
  return useQuery({
    queryKey: ["budget_transactions", budgetLineId],
    enabled: !!budgetLineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budget_transactions")
        .select("*")
        .eq("budget_line_id", budgetLineId!)
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useRecordBudgetTransaction() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (tx: {
      budget_line_id: string;
      reference_type: string;
      reference_id: string;
      amount: number;
      transaction_date: string;
    }) => {
      const { data, error } = await supabase
        .from("budget_transactions")
        .insert({ ...tx, tenant_id: appUser!.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget_transactions"] });
      qc.invalidateQueries({ queryKey: ["budget_line_usages"] });
      qc.invalidateQueries({ queryKey: ["budget_usage"] });
    },
  });
}
