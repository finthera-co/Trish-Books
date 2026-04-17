import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ScenarioModel {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  horizon_months: number;
  revenue_uplift_pct: number;
  expense_reduction_pct: number;
  capital_injection: number;
  one_time_investment: number;
  baseline_revenue: number;
  baseline_expense: number;
  baseline_cash: number;
  projected_revenue: number;
  projected_expense: number;
  projected_cash: number;
  projected_profit: number;
  roi_pct: number;
  payback_months: number | null;
  result_series: Array<Record<string, number | string>> | null;
  created_at: string;
  updated_at: string;
}

export interface SimulateInput {
  tenant_id: string;
  scenario_id?: string;
  name?: string;
  description?: string;
  horizon_months: number;
  revenue_uplift_pct: number;
  expense_reduction_pct: number;
  capital_injection: number;
  one_time_investment: number;
  persist?: boolean;
}

export interface SimulateResult {
  horizon_months: number;
  baseline_revenue: number;
  baseline_expense: number;
  baseline_cash: number;
  projected_revenue: number;
  projected_expense: number;
  projected_cash: number;
  projected_profit: number;
  profit_delta: number;
  roi_pct: number;
  payback_months: number | null;
  series: Array<Record<string, number | string>>;
  scenario_id?: string;
}

export function useScenarios() {
  return useQuery({
    queryKey: ["scenario_models"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scenario_models")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown) as ScenarioModel[];
    },
  });
}

export function useSimulateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SimulateInput) => {
      const { data, error } = await supabase.functions.invoke("simulate-scenario", { body: input });
      if (error) throw error;
      return data as SimulateResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenario_models"] }),
  });
}

export function useDeleteScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("scenario_models").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenario_models"] }),
  });
}

export interface ForecastInsight {
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export function useForecastInsights(tenantId?: string) {
  return useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant ID required");
      const { data, error } = await supabase.functions.invoke("forecast-insights", {
        body: { tenant_id: tenantId },
      });
      if (error) throw error;
      return data as { insights: ForecastInsight[]; generated_at?: string };
    },
  });
}
