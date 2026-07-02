import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type RecurringType = "earning_epf" | "earning_non_epf" | "deduction";

export interface RecurringComponent {
  id: string;
  employee_id: string;
  label: string;
  component_type: RecurringType;
  amount: number;
  is_active: boolean;
  employees?: { first_name: string; last_name: string; employee_number: string | null };
}

export interface RecurringTotals {
  allowances: number;          // earning_epf
  non_epf_allowances: number;  // earning_non_epf
  other_deductions: number;    // deduction
}

export function useRecurringComponents() {
  return useQuery({
    queryKey: ["recurring_components"],
    queryFn: async (): Promise<RecurringComponent[]> => {
      const { data, error } = await supabase
        .from("employee_recurring_components")
        .select("*, employees(first_name, last_name, employee_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RecurringComponent[];
    },
  });
}

/** Active recurring components summed per employee — used to pre-fill a payroll run. */
export function useRecurringTotalsByEmployee() {
  return useQuery({
    queryKey: ["recurring_components", "totals"],
    queryFn: async (): Promise<Record<string, RecurringTotals>> => {
      const { data, error } = await supabase
        .from("employee_recurring_components")
        .select("employee_id, component_type, amount")
        .eq("is_active", true);
      if (error) throw error;
      const map: Record<string, RecurringTotals> = {};
      ((data as any[]) || []).forEach((r) => {
        const t = (map[r.employee_id] ??= { allowances: 0, non_epf_allowances: 0, other_deductions: 0 });
        const amt = Number(r.amount) || 0;
        if (r.component_type === "earning_epf") t.allowances += amt;
        else if (r.component_type === "earning_non_epf") t.non_epf_allowances += amt;
        else if (r.component_type === "deduction") t.other_deductions += amt;
      });
      return map;
    },
  });
}

export function useCreateRecurringComponent() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { employee_id: string; label: string; component_type: RecurringType; amount: number }) => {
      const { error } = await supabase.from("employee_recurring_components").insert({
        tenant_id: appUser?.tenant_id, ...input,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring_components"] }); toast.success("Recurring item added"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleRecurringComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("employee_recurring_components").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_components"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteRecurringComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_recurring_components").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring_components"] }); toast.success("Removed"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
