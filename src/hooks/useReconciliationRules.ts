import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useReconciliationRules() {
  return useQuery({
    queryKey: ["reconciliation_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reconciliation_rules")
        .select("*, accounts(account_name, account_code)")
        .order("priority", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (rule: {
      name: string;
      condition_field: string;
      condition_operator: string;
      condition_value: string;
      condition_amount_min?: number;
      condition_amount_max?: number;
      action_type: string;
      action_account_id?: string;
      action_create_expense?: boolean;
      priority?: number;
    }) => {
      const { data, error } = await supabase
        .from("reconciliation_rules")
        .insert({ ...rule, tenant_id: appUser?.tenant_id! })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation_rules"] });
      toast.success("Rule created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; is_active?: boolean; [key: string]: any }) => {
      const { error } = await supabase
        .from("reconciliation_rules")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation_rules"] });
      toast.success("Rule updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("reconciliation_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation_rules"] });
      toast.success("Rule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
