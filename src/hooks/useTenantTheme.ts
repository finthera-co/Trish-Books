import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/stores/useAppStore";

/**
 * Tenant-isolated light/dark preference.
 *
 * next-themes keeps a single global `theme` key in localStorage, so on a shared
 * browser company A's dark mode would leak into company B. We keep next-themes
 * as the renderer (it owns the `class` on <html>) but treat its key as scratch:
 * the durable preference lives under one key per tenant.
 *
 *  - `TenantThemeSync` (mounted once in App) applies the active tenant's stored
 *    preference whenever the tenant changes — login, tenant switch, logout.
 *  - `useTenantTheme` is the only write path; ThemeToggle uses it so the value
 *    always lands in the active tenant's slot.
 */

const DEFAULT_THEME = "light";

const keyFor = (tenantId: string) => `finthera.theme.${tenantId}`;

function readStoredTheme(tenantId: string | null): string {
  if (!tenantId) return DEFAULT_THEME;
  try {
    return localStorage.getItem(keyFor(tenantId)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStoredTheme(tenantId: string | null, theme: string) {
  if (!tenantId) return;
  try {
    localStorage.setItem(keyFor(tenantId), theme);
  } catch {
    /* quota / unavailable */
  }
}

/**
 * Active company for theming: the switched-to tenant when the app store has one
 * (main app), else the user's own tenant (employee portal, pre-hydration).
 */
function useThemeTenantId(): string | null {
  const storeTenantId = useTenantId();
  const { appUser } = useAuth();
  return storeTenantId ?? appUser?.tenant_id ?? null;
}

/** Read + write the current tenant's theme. */
export function useTenantTheme() {
  const tenantId = useThemeTenantId();
  const { resolvedTheme, setTheme } = useTheme();

  const setTenantTheme = useCallback(
    (theme: string) => {
      writeStoredTheme(tenantId, theme);
      setTheme(theme);
    },
    [tenantId, setTheme]
  );

  return { resolvedTheme, isDark: resolvedTheme === "dark", setTenantTheme };
}

/**
 * Applies the stored preference on every tenant change. Signed out (no tenant)
 * falls back to the app default so the previous company's theme doesn't linger.
 */
export function useTenantThemeSync() {
  const tenantId = useThemeTenantId();
  const { setTheme } = useTheme();
  const appliedFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (appliedFor.current === tenantId) return;

    // First run before auth resolves: leave next-themes' restored value alone,
    // otherwise every reload flashes light before the tenant preference lands.
    if (appliedFor.current === undefined && !tenantId) {
      appliedFor.current = null;
      return;
    }

    appliedFor.current = tenantId;
    setTheme(readStoredTheme(tenantId));
  }, [tenantId, setTheme]);
}

export default function TenantThemeSync() {
  useTenantThemeSync();
  return null;
}
