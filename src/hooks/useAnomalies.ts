import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Anomaly {
  id: string;
  transaction_id: string | null;
  tenant_id: string;
  score: number;
  reason: string;
  status: "pending" | "reviewed";
  created_at: string;
  transactions?: {
    amount: number;
    type: string;
    date: string;
    description: string | null;
    category: string | null;
  };
}

export function useAnomalies(status?: string) {
  return useQuery({
    queryKey: ["anomalies", status],
    queryFn: async () => {
      let query = supabase
        .from("anomalies")
        .select("*, transactions(amount, type, date, description, category)")
        .order("created_at", { ascending: false });

      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown) as Anomaly[];
    },
  });
}

export function useUpdateAnomalyStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("anomalies")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      toast.success("Anomaly status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
