import type { FetchQueryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Centralized registry of queries that MUST be hydrated before a tenant
 * switch resolves. Prefetched in parallel by `switchTenant` so pages render
 * fully populated — never with skeletons or stale data.
 *
 * Add a new entry whenever a screen relies on data that should be ready
 * the moment the user lands on it after switching companies.
 *
 * Conventions:
 *  - Query key MUST be `["tenant", tenantId, ...]` to match useTenantQuery.
 *  - Query fn MUST scope by tenant_id (RLS will also enforce this).
 *  - Keep these queries small + fast — heavy/page-specific data stays lazy.
 */
export type CriticalQueryFactory = (tenantId: string) => FetchQueryOptions<unknown>;

export const CRITICAL_QUERIES: Record<string, CriticalQueryFactory> = {
  accounts: (tenantId) => ({
    queryKey: ["tenant", tenantId, "accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  }),

  customers: (tenantId) => ({
    queryKey: ["tenant", tenantId, "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  }),

  vendors: (tenantId) => ({
    queryKey: ["tenant", tenantId, "vendors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  }),

  invoices: (tenantId) => ({
    queryKey: ["tenant", tenantId, "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(name)")
        .eq("tenant_id", tenantId)
        .order("issue_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  }),

  fiscalPeriods: (tenantId) => ({
    queryKey: ["tenant", tenantId, "fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  }),
};

/** Prefetch every critical query in parallel. Resolves only when all settle. */
export async function prefetchCriticalQueries(
  tenantId: string,
  prefetch: (opts: FetchQueryOptions<unknown>) => Promise<void>
) {
  await Promise.allSettled(
    Object.values(CRITICAL_QUERIES).map((factory) => prefetch(factory(tenantId)))
  );
}
