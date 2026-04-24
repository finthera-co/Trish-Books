import { useEffect, useRef } from "react";
import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { useTenantId, useIsSwitching } from "@/stores/useAppStore";

/**
 * Tenant-scoped wrapper around useQuery.
 *
 * - Auto-prepends tenantId to the query key
 * - Disables the query while no tenant is active or a switch is in progress
 * - Stale-response protection: ignores results that resolved for a previous tenant
 *
 * Example:
 *   const { data } = useTenantQuery({
 *     key: ["invoices", { status: "open" }],
 *     fn: async (tenantId, signal) =>
 *       supabase.from("invoices").select("*").eq("tenant_id", tenantId).abortSignal(signal),
 *   });
 */
export function useTenantQuery<TData>(opts: {
  key: QueryKey;
  fn: (tenantId: string, signal: AbortSignal) => Promise<TData>;
  enabled?: boolean;
  options?: Omit<UseQueryOptions<TData>, "queryKey" | "queryFn" | "enabled">;
}) {
  const tenantId = useTenantId();
  const isSwitching = useIsSwitching();

  // Track latest tenant the caller is interested in to drop stale resolutions.
  const activeTenantRef = useRef<string | null>(tenantId);
  useEffect(() => {
    activeTenantRef.current = tenantId;
  }, [tenantId]);

  return useQuery<TData>({
    queryKey: ["tenant", tenantId, ...opts.key],
    queryFn: async ({ signal }) => {
      const requestedTenant = tenantId!;
      const result = await opts.fn(requestedTenant, signal);
      // Stale-response guard: drop if user has since switched tenants.
      if (activeTenantRef.current !== requestedTenant) {
        throw new Error("stale-tenant-response");
      }
      return result;
    },
    enabled: !!tenantId && !isSwitching && (opts.enabled ?? true),
    ...opts.options,
  });
}
