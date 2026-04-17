// Hooks for forecast hardening layer: validation, accuracy, runs.
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ForecastRun {
  id: string;
  tenant_id: string;
  run_timestamp: string;
  model_version: string;
  notes: string | null;
  forecast_job_id: string | null;
}

export interface ForecastValidation {
  check_name: string;
  status: "pass" | "fail" | "warning";
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ValidationSummary {
  total: number;
  pass: number;
  fail: number;
  warning: number;
}

export interface ForecastAccuracy {
  id: string;
  category_name: string;
  stream: string;
  mape: number;
  rmse: number;
  evaluated_period: string;
  data_points: number;
  created_at: string;
}

export function useForecastRuns(tenantId?: string) {
  return useQuery({
    queryKey: ["forecast_runs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecast_runs")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("run_timestamp", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ForecastRun[];
    },
  });
}

export function useRunValidation(tenantId?: string) {
  return useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant required");
      const { data, error } = await supabase.functions.invoke("forecast-validation", {
        body: { tenant_id: tenantId },
      });
      if (error) throw error;
      return data as {
        forecast_run_id: string | null;
        checks: ForecastValidation[];
        summary: ValidationSummary;
      };
    },
  });
}

export function useRunBacktest(tenantId?: string) {
  return useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant required");
      const { data, error } = await supabase.functions.invoke("forecast-backtest", {
        body: { tenant_id: tenantId, persist: true },
      });
      if (error) throw error;
      return data as {
        forecast_run_id: string | null;
        categories_evaluated: number;
        overall_mape: number | null;
        overall_rmse: number | null;
        results: ForecastAccuracy[];
      };
    },
  });
}

export function useForecastAccuracy(runId?: string | null) {
  return useQuery({
    queryKey: ["forecast_accuracy", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecast_accuracy")
        .select("*")
        .eq("forecast_run_id", runId!)
        .order("mape", { ascending: true });
      if (error) throw error;
      return data as ForecastAccuracy[];
    },
  });
}
