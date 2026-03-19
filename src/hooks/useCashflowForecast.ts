import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ForecastPoint {
  id: string;
  tenant_id: string;
  date: string;
  predicted_balance: number;
  created_at: string;
}

export function useCashflowForecast() {
  return useQuery({
    queryKey: ["cashflow_forecast"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cashflow_forecast")
        .select("*")
        .order("date", { ascending: true });
      if (error) throw error;
      return (data as unknown) as ForecastPoint[];
    },
  });
}
