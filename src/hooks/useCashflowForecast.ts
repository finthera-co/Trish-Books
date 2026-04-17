import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ForecastPoint {
  id: string;
  tenant_id: string;
  date: string;
  predicted_balance: number;
  lower_bound: number;
  upper_bound: number;
  created_at: string;
}

export interface CategoryForecastPoint {
  id: string;
  tenant_id: string;
  period: string;
  category_id: string | null;
  category_name: string;
  stream: "revenue" | "expense" | "cash" | "other";
  forecast_value: number;
  lower_bound: number;
  upper_bound: number;
  model_type: string;
  granularity: string;
  created_at: string;
}

export function useCashflowForecast() {
  return useQuery({
    queryKey: ["cashflow_forecast"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cashflow_forecast" as never)
        .select("*")
        .order("date", { ascending: true });
      if (error) throw error;
      return (data as unknown) as ForecastPoint[];
    },
  });
}

export function useFinancialForecasts(stream?: "revenue" | "expense" | "cash") {
  return useQuery({
    queryKey: ["financial_forecasts", stream ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("financial_forecasts")
        .select("*")
        .order("period", { ascending: true });
      if (stream) q = q.eq("stream", stream);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown) as CategoryForecastPoint[];
    },
  });
}

export interface ForecastJob {
  id: string;
  run_time: string;
  status: "running" | "success" | "failed";
  duration_ms: number | null;
  tenants_processed: number;
  forecast_rows_inserted: number;
  error_message: string | null;
}

export function useForecastJobs() {
  return useQuery({
    queryKey: ["forecast_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecast_jobs")
        .select("id, run_time, status, duration_ms, tenants_processed, forecast_rows_inserted, error_message")
        .order("run_time", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data as unknown) as ForecastJob[];
    },
  });
}
