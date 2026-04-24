import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { prefetchCriticalQueries } from "@/lib/criticalQueries";

/**
 * Global app store for tenant (company) scoping with blocking prefetch.
 *
 * Switch flow (strict order — DO NOT reorder):
 *  1. isSwitching=true, isDataReady=false  → AppLayout shows full-screen loader
 *  2. Cancel all in-flight queries
 *  3. Clear React Query cache
 *  4. **Prefetch all CRITICAL_QUERIES for the new tenant** (await)
 *  5. Only now flip tenantId → child queries read from warm cache, no flicker
 *  6. isDataReady=true, isSwitching=false  → render proceeds with hydrated data
 */
interface AppState {
  tenantId: string | null;
  isSwitching: boolean;
  isDataReady: boolean;

  setTenantId: (id: string | null, queryClient?: QueryClient) => Promise<void>;
  switchTenant: (newTenantId: string, queryClient: QueryClient) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  tenantId: null,
  isSwitching: false,
  isDataReady: false,

  /**
   * Used on initial login / auth sync. Also runs the prefetch gate so the
   * first page render after login is fully hydrated.
   */
  setTenantId: async (id, queryClient) => {
    if (id === get().tenantId) return;

    if (!id) {
      set({ tenantId: null, isDataReady: false });
      return;
    }

    if (!queryClient) {
      // No client yet — set tenant; data will lazy-load (legacy path).
      set({ tenantId: id, isDataReady: true });
      return;
    }

    set({ isSwitching: true, isDataReady: false });
    try {
      await prefetchCriticalQueries(id, (opts) => queryClient.prefetchQuery(opts));
      set({ tenantId: id, isDataReady: true });
    } finally {
      set({ isSwitching: false });
    }
  },

  switchTenant: async (newTenantId, queryClient) => {
    if (newTenantId === get().tenantId) return;

    set({ isSwitching: true, isDataReady: false });
    try {
      // 1. Cancel anything in flight for the previous tenant
      await queryClient.cancelQueries();
      // 2. Wipe cross-tenant cache
      queryClient.clear();
      // 3. Warm the cache for the NEW tenant BEFORE flipping the id
      await prefetchCriticalQueries(newTenantId, (opts) =>
        queryClient.prefetchQuery(opts)
      );
      // 4. Now safe to flip — useTenantQuery reads from primed cache
      set({ tenantId: newTenantId, isDataReady: true });

      // Best-effort persist active tenant to auth metadata
      try {
        await supabase.auth.updateUser({ data: { active_tenant_id: newTenantId } });
      } catch {
        /* no-op */
      }
    } finally {
      set({ isSwitching: false });
    }
  },
}));

/** Selector helpers — components subscribe to the slice they need. */
export const useTenantId = () => useAppStore((s) => s.tenantId);
export const useIsSwitching = () => useAppStore((s) => s.isSwitching);
export const useIsDataReady = () => useAppStore((s) => s.isDataReady);
