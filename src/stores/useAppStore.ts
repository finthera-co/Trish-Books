import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Global app store for tenant (company) scoping + anti-flicker switching.
 *
 * NOTE: This app currently supports one tenant per user. The store is wired
 * to AuthContext.appUser.tenant_id and is ready to power a real multi-tenant
 * switcher the moment user_tenants membership is added.
 */
interface AppState {
  tenantId: string | null;
  isSwitching: boolean;

  setTenantId: (id: string | null) => void;
  switchTenant: (newTenantId: string, queryClient: QueryClient) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  tenantId: null,
  isSwitching: false,

  setTenantId: (id) => {
    if (id !== get().tenantId) set({ tenantId: id });
  },

  /**
   * Switch active tenant with strict ordering to eliminate flicker:
   *  1. Flip isSwitching → blocks UI
   *  2. Cancel all in-flight queries
   *  3. Clear React Query cache
   *  4. Update tenantId (queries keyed by it auto-refetch fresh)
   *  5. Persist to auth metadata (best-effort)
   *  6. Flip isSwitching off
   */
  switchTenant: async (newTenantId, queryClient) => {
    if (newTenantId === get().tenantId) return;

    set({ isSwitching: true });
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      set({ tenantId: newTenantId });

      // Best-effort: persist active tenant to auth metadata.
      // Safe to ignore failures — tenantId in store is source of truth for the session.
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

/** Selector helper — components subscribe only to the current tenantId. */
export const useTenantId = () => useAppStore((s) => s.tenantId);
export const useIsSwitching = () => useAppStore((s) => s.isSwitching);
