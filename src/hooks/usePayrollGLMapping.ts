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
      qc.invalidateQueries({ queryKey: ["resolved_liability_account"] });
      qc.invalidateQueries({ queryKey: ["payroll_epf_etf_mappings"] });
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
      qc.invalidateQueries({ queryKey: ["resolved_liability_account"] });
      qc.invalidateQueries({ queryKey: ["payroll_epf_etf_mappings"] });
      toast.success("Mapping removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface PayrollDeptGL {
  id: string;
  department: string;
  component_code: string;
  account_id: string;
  posting_side: "debit" | "credit";
}

export function usePayrollDeptGLMappings() {
  return useQuery({
    queryKey: ["payroll_department_gl"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payroll_department_gl")
        .select("*")
        .order("department");
      if (error) throw error;
      return (data || []) as PayrollDeptGL[];
    },
  });
}

export function useUpsertPayrollDeptGL() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      department: string;
      component_code: string;
      account_id: string;
      posting_side: "debit" | "credit";
    }) => {
      const payload = {
        tenant_id: appUser?.tenant_id,
        department: input.department,
        component_code: input.component_code,
        account_id: input.account_id,
        posting_side: input.posting_side,
      };
      const { data, error } = await (supabase as any)
        .from("payroll_department_gl")
        .upsert(payload, { onConflict: "tenant_id,department,component_code" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_department_gl"] });
      toast.success("Department override saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePayrollDeptGL() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("payroll_department_gl").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_department_gl"] });
      toast.success("Department override removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
