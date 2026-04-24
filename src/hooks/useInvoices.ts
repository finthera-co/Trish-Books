import { supabase } from "@/integrations/supabase/client";
import { useTenantQuery } from "@/hooks/useTenantQuery";

/**
 * Example tenant-scoped hook that benefits from the blocking-prefetch gate.
 *
 * Because `invoices` is registered in CRITICAL_QUERIES, the cache is already
 * warm by the time this component mounts after a tenant switch — no skeleton,
 * no flicker, just instant data.
 */
export function useInvoices() {
  return useTenantQuery({
    key: ["invoices"],
    fn: async (tenantId, signal) => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(name)")
        .eq("tenant_id", tenantId)
        .order("issue_date", { ascending: false })
        .limit(100)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
    options: {
      staleTime: 60_000,
      refetchOnMount: false,
    },
  });
}
