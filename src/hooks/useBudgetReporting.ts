import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type EnforcementMode = "none" | "warn" | "block" | "approval";
export type ApplyTo = "expense_only" | "revenue_only" | "both";
export type MissingBehavior = "allow" | "warn" | "block";

export interface BudgetControls {
  tenant_id: string;
  enforcement_mode: EnforcementMode;
  tolerance_percentage: number;
  apply_to_accounts: ApplyTo;
  dimension_strict_mode: boolean;
  missing_budget_behavior: MissingBehavior;
}

export interface BudgetVsActualRow {
  budget_id: string;
  budget_name: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  period: string;
  period_type: string;
  department_id: string | null;
  allocated: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

export function useBudgetControls() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["budget_controls", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budget_controls" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as BudgetControls) ?? null;
    },
  });
}

export function useUpsertBudgetControls() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<BudgetControls>) => {
      const payload = { ...input, tenant_id: appUser!.tenant_id };
      const { error } = await supabase
        .from("budget_controls" as any)
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget_controls"] });
      toast.success("Budget controls updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBudgetVsActual(filters: {
  fiscalYear?: number;
  departmentId?: string;
  accountType?: string;
}) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["budget_vs_actual", appUser?.tenant_id, filters],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("budget_vs_actual" as any, {
        p_tenant_id: appUser!.tenant_id,
        p_fiscal_year: filters.fiscalYear ?? null,
        p_department_id: filters.departmentId ?? null,
        p_account_type: filters.accountType ?? null,
      });
      if (error) throw error;
      return (data as unknown as BudgetVsActualRow[]) ?? [];
    },
  });
}

export async function validateVoucherBudget(params: {
  tenantId: string;
  accountId: string;
  amount: number;
  date: string;
  departmentId?: string;
}) {
  const { data, error } = await supabase.rpc("validate_voucher_budget" as any, {
    p_tenant_id: params.tenantId,
    p_account_id: params.accountId,
    p_amount: params.amount,
    p_date: params.date,
    p_department_id: params.departmentId ?? null,
  });
  if (error) throw error;
  return data as { status: "ok" | "warn" | "block" | "approval_required"; reason: string; allocated?: number; consumed?: number; new_total?: number; utilization_pct?: number; period?: string };
}
