import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PayrollComponentAccount {
  id: string;
  tenant_id: string;
  component_code: string;
  posting_side: "debit" | "credit";
  account_id: string;
  is_active: boolean;
  notes: string | null;
}

// Standard suggested side per component (QuickBooks convention).
// Earnings/employer-cost components are debits (expense). Statutory + net pay are credits (liabilities).
export const SUGGESTED_SIDE: Record<string, "debit" | "credit"> = {
  BASIC: "debit",
  OVERTIME: "debit",
  BONUS: "debit",
  ALLOWANCES: "debit",
  EPF_EMPLOYER: "debit",
  ETF_EMPLOYER: "debit",
  EPF_EMPLOYEE: "credit",
  OTHER_DEDUCTIONS: "credit",
  NET_PAY: "credit",
};

export function usePayrollGLMappings() {
  return useQuery({
    queryKey: ["payroll_component_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_component_accounts")
        .select("*")
        .order("component_code");
      if (error) throw error;
      return (data || []) as PayrollComponentAccount[];
    },
  });
}

export function useUpsertPayrollGLMapping() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      component_code: string;
      posting_side: "debit" | "credit";
      account_id: string;
      is_active?: boolean;
    }) => {
      const payload = {
        tenant_id: appUser?.tenant_id,
        component_code: input.component_code,
        posting_side: input.posting_side,
        account_id: input.account_id,
        is_active: input.is_active ?? true,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from("payroll_component_accounts")
          .update(payload)
          .eq("id", input.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      // Upsert on (tenant, component, side)
      const { data, error } = await supabase
        .from("payroll_component_accounts")
        .upsert(payload, { onConflict: "tenant_id,component_code,posting_side" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_component_accounts"] });
      toast.success("Mapping saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePayrollGLMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payroll_component_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_component_accounts"] });
      toast.success("Mapping removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
