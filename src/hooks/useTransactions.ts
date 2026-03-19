import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface Transaction {
  id: string;
  tenant_id: string;
  date: string;
  amount: number;
  type: "income" | "expense";
  account_id: string | null;
  category: string | null;
  description: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
}

export function useTransactions(filters?: { from?: string; to?: string; type?: string }) {
  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*, accounts(account_name, account_code)")
        .order("date", { ascending: false });

      if (filters?.from) query = query.gte("date", filters.from);
      if (filters?.to) query = query.lte("date", filters.to);
      if (filters?.type) query = query.eq("type", filters.type);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (tx: {
      date: string;
      amount: number;
      type: "income" | "expense";
      account_id?: string;
      category?: string;
      description?: string;
      source_type?: string;
      source_id?: string;
    }) => {
      const { data, error } = await supabase
        .from("transactions")
        .insert({ ...tx, tenant_id: appUser?.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["daily_balances"] });
      queryClient.invalidateQueries({ queryKey: ["monthly_financials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDailyBalances(from?: string, to?: string) {
  return useQuery({
    queryKey: ["daily_balances", from, to],
    queryFn: async () => {
      let query = supabase
        .from("daily_balances")
        .select("*")
        .order("date", { ascending: true });

      if (from) query = query.gte("date", from);
      if (to) query = query.lte("date", to);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useMonthlyFinancials() {
  return useQuery({
    queryKey: ["monthly_financials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_financials" as any)
        .select("*")
        .order("month", { ascending: false });
      if (error) throw error;
      return data as Array<{
        tenant_id: string;
        month: string;
        total_income: number;
        total_expense: number;
        net: number;
      }>;
    },
  });
}
