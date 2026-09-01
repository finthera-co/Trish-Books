import { create } from "zustand";
import { MODULE_CONFIGS } from "@/config/modules";

const BOOKMARKS_KEY_PREFIX = "tb_bookmarks";
export const MAX_BOOKMARKS = 10;

const PINNED_MODULES_KEY_PREFIX = "tb_pinned_modules";
export const MAX_PINNED_MODULES = 6;

/** Bookmarks/pins are per-tenant preferences — a shared key would leak one
 * tenant's nav customization (and removals) into every other tenant a user
 * can see, including across separate companies on a shared machine. */
function bookmarksKey(tenantId: string): string {
  return `${BOOKMARKS_KEY_PREFIX}:${tenantId}`;
}

function pinnedModulesKey(tenantId: string): string {
  return `${PINNED_MODULES_KEY_PREFIX}:${tenantId}`;
}

function loadBookmarks(tenantId: string | null): string[] {
  if (!tenantId) return [];
  try {
    const raw = localStorage.getItem(bookmarksKey(tenantId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveBookmarks(tenantId: string | null, bookmarks: string[]) {
  if (!tenantId) return;
  try {
    localStorage.setItem(bookmarksKey(tenantId), JSON.stringify(bookmarks));
  } catch {
    /* private mode — bookmarks simply don't persist */
  }
}

function loadPinnedModules(tenantId: string | null): string[] {
  if (!tenantId) return [];
  try {
    const raw = localStorage.getItem(pinnedModulesKey(tenantId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function savePinnedModules(tenantId: string | null, pinned: string[]) {
  if (!tenantId) return;
  try {
    localStorage.setItem(pinnedModulesKey(tenantId), JSON.stringify(pinned));
  } catch {
    /* private mode — pins simply don't persist */
  }
}

/** Matches a pathname to the module whose basePath it falls under. */
export function moduleIdForPath(pathname: string): string | null {
  let best: { id: string; basePath: string } | null = null;
  for (const config of Object.values(MODULE_CONFIGS)) {
    if (pathname === config.basePath || pathname.startsWith(`${config.basePath}/`)) {
      if (!best || config.basePath.length > best.basePath.length) {
        best = { id: config.id, basePath: config.basePath };
      }
    }
  }
  return best?.id ?? null;
}

interface NavState {
  /** Tenant these bookmarks/pins were loaded for. Null before login. */
  tenantId: string | null;
  /** Re-hydrates bookmarks/pins from this tenant's own storage. Call whenever
   * the authenticated tenant changes (login, tenant switch, logout). */
  setTenantScope: (tenantId: string | null) => void;

  activeModule: string | null;
  setActiveModule: (id: string | null) => void;

  allAppsOpen: boolean;
  setAllAppsOpen: (open: boolean) => void;

  bookmarks: string[];
  /** False when the cap is already full — callers surface that, rather than
   *  reporting a bookmark that was never actually stored. */
  addBookmark: (path: string) => boolean;
  removeBookmark: (path: string) => void;

  pinnedModules: string[];
  togglePinnedModule: (id: string) => void;

  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;

  shortcutsDialogOpen: boolean;
  setShortcutsDialogOpen: (open: boolean) => void;

  createMenuOpen: boolean;
  setCreateMenuOpen: (open: boolean) => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  tenantId: null,
  setTenantScope: (tenantId) => {
    if (tenantId === get().tenantId) return;
    set({
      tenantId,
      bookmarks: loadBookmarks(tenantId),
      pinnedModules: loadPinnedModules(tenantId),
    });
  },

  activeModule: null,
  setActiveModule: (id) => set({ activeModule: id }),

  allAppsOpen: false,
  setAllAppsOpen: (open) => set({ allAppsOpen: open }),

  bookmarks: [],
  addBookmark: (path) => {
    const { bookmarks, tenantId } = get();
    if (bookmarks.includes(path)) return true;
    if (bookmarks.length >= MAX_BOOKMARKS) return false;
    const next = [...bookmarks, path];
    saveBookmarks(tenantId, next);
    set({ bookmarks: next });
    return true;
  },
  removeBookmark: (path) => {
    const { tenantId } = get();
    const next = get().bookmarks.filter((p) => p !== path);
    saveBookmarks(tenantId, next);
    set({ bookmarks: next });
  },

  pinnedModules: [],
  togglePinnedModule: (id) => {
    const { pinnedModules, tenantId } = get();
    const next = pinnedModules.includes(id)
      ? pinnedModules.filter((m) => m !== id)
      : pinnedModules.length >= MAX_PINNED_MODULES
        ? pinnedModules
        : [...pinnedModules, id];
    savePinnedModules(tenantId, next);
    set({ pinnedModules: next });
  },

  sidebarPinned: true,
  setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),

  shortcutsDialogOpen: false,
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),

  createMenuOpen: false,
  setCreateMenuOpen: (open) => set({ createMenuOpen: open }),
}));
