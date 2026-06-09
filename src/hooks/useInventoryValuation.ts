import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ValuationRow {
  item_id: string;
  item_code: string | null;
  item_name: string;
  valuation_method: "wac" | "fifo";
  qty_on_hand: number;
  unit_cost: number;
  fifo_value: number;
  wac_value: number;
  reported_value: number;
}

/** Per-item inventory valuation reconcilable to GL 1200. */
export function useInventoryValuation() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inventory_valuation", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_valuation_report" as any, {
        p_tenant_id: appUser!.tenant_id,
      });
      if (error) throw error;
      return (data || []) as ValuationRow[];
    },
    enabled: !!appUser?.tenant_id,
    staleTime: 30_000,
  });
}

export interface StockLot {
  id: string;
  tenant_id: string;
  item_id: string;
  lot_number: string;
  receipt_date: string;
  qty_received: number;
  qty_remaining: number;
  unit_cost: number;
  source_type: string;
  source_id: string | null;
  notes: string | null;
  is_exhausted: boolean;
  created_at: string;
}

/** Open FIFO lots for an item (for drilldown). */
export function useStockLots(itemId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["stock_lots", appUser?.tenant_id, itemId],
    queryFn: async () => {
      let q = supabase
        .from("stock_lots" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("receipt_date", { ascending: true });
      if (itemId) q = q.eq("item_id", itemId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as StockLot[];
    },
    enabled: !!appUser?.tenant_id,
  });
}
