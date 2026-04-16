import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type MovementType = "purchase" | "sale" | "adjustment" | "return" | "transfer" | "opening";

export interface StockMovement {
  id: string;
  tenant_id: string;
  item_id: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  movement_date: string;
  created_at: string;
}

export function useStockMovements(itemId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["stock_movements", appUser?.tenant_id, itemId],
    queryFn: async () => {
      let query = supabase
        .from("stock_movements")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("movement_date", { ascending: false });

      if (itemId) query = query.eq("item_id", itemId);

      const { data, error } = await query;
      if (error) throw error;
      return data as StockMovement[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

/**
 * Computes current stock on hand for an item from stock_movements.
 * Positive qty = stock in (purchase, return, adjustment+, opening)
 * The sign of `quantity` in the table determines direction.
 */
export function useComputedStockOnHand(itemId?: string) {
  const { data: movements } = useStockMovements(itemId);

  if (!movements) return undefined;

  return movements.reduce((total, m) => total + Number(m.quantity), 0);
}

export function useCreateStockMovement() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (movement: {
      item_id: string;
      movement_type: MovementType;
      quantity: number;
      unit_cost: number;
      reference_type?: string;
      reference_id?: string;
      notes?: string;
      movement_date?: string;
    }) => {
      const { data, error } = await supabase
        .from("stock_movements")
        .insert({
          ...movement,
          tenant_id: appUser!.tenant_id,
          movement_date: movement.movement_date || new Date().toISOString().split("T")[0],
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["computed_inventory_value"] });
      toast.success("Stock movement recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
