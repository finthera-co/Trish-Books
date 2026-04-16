import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Computes total inventory value dynamically from inventory_items table.
 * Value = SUM(quantity_on_hand × unit_cost) for all items.
 * This value is NEVER stored in the COA — it's always derived on demand.
 */
export function useComputedInventoryValue() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["computed_inventory_value", appUser?.tenant_id],
    queryFn: async () => {
      const tid = appUser!.tenant_id;

      // Fetch all inventory items with qty and cost
      const { data: items, error } = await supabase
        .from("inventory_items")
        .select("id, item_name, quantity_on_hand, unit_cost")
        .eq("tenant_id", tid);

      if (error) throw error;

      // Compute per-item valuation and total
      const itemValuations = (items || []).map((item) => ({
        id: item.id,
        name: item.item_name,
        quantity: Number(item.quantity_on_hand) || 0,
        unitCost: Number(item.unit_cost) || 0,
        value: (Number(item.quantity_on_hand) || 0) * (Number(item.unit_cost) || 0),
      }));

      const totalValue = itemValuations.reduce((sum, item) => sum + item.value, 0);

      return {
        totalValue,
        itemCount: itemValuations.length,
        items: itemValuations,
        costingMethod: "weighted_average" as const, // Default method
      };
    },
    enabled: !!appUser?.tenant_id,
    // Short stale time — recompute frequently for accuracy
    staleTime: 30_000,
  });
}

/**
 * Builds a map of account_id → computed balance for inventory control accounts.
 * This map is used by the COA to override stored balances with dynamic values.
 */
export function useInventoryAccountBalanceMap(accounts: any[] | undefined) {
  const { data: inventoryData } = useComputedInventoryValue();

  if (!accounts || !inventoryData) return new Map<string, number>();

  const map = new Map<string, number>();

  for (const account of accounts) {
    const subtype = account.account_subtype?.toLowerCase() || "";
    if (
      account.is_control_account &&
      subtype.includes("inventory")
    ) {
      map.set(account.id, inventoryData.totalValue);
    }
  }

  return map;
}
