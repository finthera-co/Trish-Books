import { create } from "zustand";
import { MODULE_CONFIGS } from "@/config/modules";

const BOOKMARKS_KEY = "tb_bookmarks";
const MAX_BOOKMARKS = 10;

const PINNED_MODULES_KEY = "tb_pinned_modules";
export const MAX_PINNED_MODULES = 6;

function loadBookmarks(): string[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks: string[]) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    /* private mode — bookmarks simply don't persist */
  }
}

function loadPinnedModules(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_MODULES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function savePinnedModules(pinned: string[]) {
  try {
    localStorage.setItem(PINNED_MODULES_KEY, JSON.stringify(pinned));
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
  activeModule: string | null;
  setActiveModule: (id: string | null) => void;

  allAppsOpen: boolean;
  setAllAppsOpen: (open: boolean) => void;

  bookmarks: string[];
  addBookmark: (path: string) => void;
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
  activeModule: null,
  setActiveModule: (id) => set({ activeModule: id }),

  allAppsOpen: false,
  setAllAppsOpen: (open) => set({ allAppsOpen: open }),

  bookmarks: loadBookmarks(),
  addBookmark: (path) => {
    const { bookmarks } = get();
    if (bookmarks.includes(path) || bookmarks.length >= MAX_BOOKMARKS) return;
    const next = [...bookmarks, path];
    saveBookmarks(next);
    set({ bookmarks: next });
  },
  removeBookmark: (path) => {
    const next = get().bookmarks.filter((p) => p !== path);
    saveBookmarks(next);
    set({ bookmarks: next });
  },

  pinnedModules: loadPinnedModules(),
  togglePinnedModule: (id) => {
    const { pinnedModules } = get();
    const next = pinnedModules.includes(id)
      ? pinnedModules.filter((m) => m !== id)
      : pinnedModules.length >= MAX_PINNED_MODULES
        ? pinnedModules
        : [...pinnedModules, id];
    savePinnedModules(next);
    set({ pinnedModules: next });
  },

  sidebarPinned: true,
  setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),

  shortcutsDialogOpen: false,
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),

  createMenuOpen: false,
  setCreateMenuOpen: (open) => set({ createMenuOpen: open }),
}));
