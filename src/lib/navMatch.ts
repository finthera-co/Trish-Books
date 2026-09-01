import { MODULE_CONFIGS } from "@/config/modules";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

export type NavItem = ModuleConfig["sidebarItems"][number];

/**
 * Resolves the sidebar item a URL belongs to. `url` is a pathname plus its
 * optional search string, i.e. `location.pathname + location.search`.
 *
 * Three passes, most specific first:
 *  1. Exact full-URL match — the only way an item whose own path carries a
 *     query string ("/reports/financial?report=fixed-asset-schedule") can win,
 *     and the reason it beats the plain-path item sharing that pathname.
 *  2. Exact pathname match, with query-string items excluded so they can never
 *     claim the bare pathname that belongs to a sibling.
 *  3. Longest path prefix — gives detail routes ("/accounting/journals/JE-123")
 *     the label of the list they came from, instead of falling back to the
 *     module name and rendering every open detail page identical.
 */
export function matchNavItem(items: NavItem[], url: string): NavItem | null {
  const pathname = url.split("?")[0];

  const exactUrl = items.find((i) => i.path === url);
  if (exactUrl) return exactUrl;

  const exactPath = items.find((i) => !i.path.includes("?") && i.path === pathname);
  if (exactPath) return exactPath;

  let best: NavItem | null = null;
  for (const item of items) {
    if (item.path.includes("?")) continue;
    if (!pathname.startsWith(`${item.path}/`)) continue;
    if (!best || item.path.length > best.path.length) best = item;
  }
  return best;
}

/** Every sidebar item across every module — for surfaces like bookmarks that
 *  hold a bare URL with no module context of their own. */
export function allNavItems(): NavItem[] {
  return Object.values(MODULE_CONFIGS).flatMap((m) => m.sidebarItems);
}
