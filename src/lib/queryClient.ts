import { QueryClient } from "@tanstack/react-query";

/**
 * Tenant-aware React Query client.
 *
 * Defaults chosen for multi-tenant correctness:
 *  - refetchOnWindowFocus: false  → no surprise refetches
 *  - refetchOnMount: true         → revalidate once data goes stale
 *  - staleTime: 5 minutes         → cached data within the window is served
 *                                    without a network call; mutations still
 *                                    call invalidateQueries() to force an
 *                                    immediate refetch regardless of this
 *  - gcTime: 10 minutes           → unused queries stay warm across nav
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
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    },
  },
});
