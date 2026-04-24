import { QueryClient } from "@tanstack/react-query";

/**
 * Tenant-aware React Query client.
 *
 * Defaults chosen for multi-tenant correctness:
 *  - refetchOnWindowFocus: false  → no surprise refetches
 *  - refetchOnMount: true         → always pull fresh on remount
 *  - staleTime: 0                 → no stale reuse across tenant switches
 *  - retry: 1                     → fail fast on RLS / network issues
 *
 * Convention: every query key MUST start with the tenantId, e.g.
 *   useQuery({ queryKey: ["invoices", tenantId, filters], ... })
 * so `queryClient.clear()` on tenant switch wipes everything cleanly.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      staleTime: 0,
      retry: 1,
    },
  },
});
