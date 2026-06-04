import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Subscribe to realtime changes on inventory_items, stock_movements and products
 * for the current tenant. When any change happens (e.g. an invoice is posted and
 * reduces stock), invalidate the relevant React Query caches so all inventory /
 * product views update instantly.
 */
export function useInventoryRealtime() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  useEffect(() => {
    if (!tenantId) return;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["inventory_valuation"] });
    };

    const channel = supabase
      .channel(`inventory-realtime-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_items", filter: `tenant_id=eq.${tenantId}` },
        invalidate
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_movements", filter: `tenant_id=eq.${tenantId}` },
        invalidate
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products", filter: `tenant_id=eq.${tenantId}` },
        invalidate
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, qc]);
}
