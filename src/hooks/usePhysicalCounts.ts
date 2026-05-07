import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type CountStatus = "draft" | "in_progress" | "counted" | "posted" | "cancelled";

export interface StockCount {
  id: string;
  count_number: string;
  count_date: string;
  warehouse_id: string | null;
  warehouse?: { id: string; name: string; code: string } | null;
  status: CountStatus;
  reason: string | null;
  notes: string | null;
  total_variance_qty: number;
  total_variance_value: number;
  adjustment_id: string | null;
  journal_entry_id: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface StockCountLine {
  id: string;
  count_id: string;
  item_id: string;
  warehouse_id: string | null;
  system_qty: number;
  counted_qty: number | null;
  variance_qty: number;
  unit_cost: number;
  variance_value: number;
  notes: string | null;
  item?: { id: string; item_code: string | null; item_name: string };
}

export function useStockCounts() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["stock_counts", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_counts" as any)
        .select("*, warehouse:warehouses(id,name,code)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as StockCount[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useStockCountLines(countId: string | undefined) {
  return useQuery({
    queryKey: ["stock_count_lines", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_lines" as any)
        .select("*, item:inventory_items(id,item_code,item_name)")
        .eq("count_id", countId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as StockCountLine[];
    },
    enabled: !!countId,
  });
}

export function useCreateStockCount() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { count_date: string; warehouse_id?: string | null; reason?: string; notes?: string }) => {
      const { data, error } = await supabase
        .from("stock_counts" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          count_date: p.count_date,
          warehouse_id: p.warehouse_id || null,
          reason: p.reason || null,
          notes: p.notes || null,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      return (data as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_counts"] });
      toast.success("Count sheet created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function rpcMutation(rpc: string, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const { data, error } = await supabase.rpc(rpc as any, args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_counts"] });
      qc.invalidateQueries({ queryKey: ["stock_count_lines"] });
      qc.invalidateQueries({ queryKey: ["stock_adjustments"] });
      qc.invalidateQueries({ queryKey: ["inventory_master"] });
      qc.invalidateQueries({ queryKey: ["inventory_valuation"] });
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useStartCount() { return rpcMutation("start_stock_count", "Snapshot generated"); }
export function usePostCount()  { return rpcMutation("post_stock_count",  "Count posted to GL"); }
export function useCancelCount(){ return rpcMutation("cancel_stock_count","Count cancelled"); }

export function useUpdateCountedQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, counted_qty }: { id: string; counted_qty: number | null }) => {
      const { error } = await supabase
        .from("stock_count_lines" as any)
        .update({ counted_qty } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_count_lines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
