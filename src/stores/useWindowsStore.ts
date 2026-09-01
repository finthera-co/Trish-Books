import { create } from "zustand";
import type { ReactNode } from "react";
import { createPortalNode } from "@/lib/domPortal";

/**
 * Minimize-to-dock window system.
 *
 * KNOWN V1 LIMITATION: a window's captured `element` still lives under the
 * app's single real BrowserRouter, so any `useLocation()` / `useNavigate()` /
 * `useParams()` call INSIDE a minimized page's subtree resolves against the
 * live browser location/navigator, not a frozen copy for that window. A page
 * that internally calls `navigate(...)` while minimized would affect the real
 * URL. Suspense Clearing (the first page this ships for) calls none of these
 * hooks, so it's unaffected. Full isolation would need a nested
 * <Router navigator={...}> per window — a scoped future enhancement, not
 * required for the current use case.
 */

export interface WindowEntry {
  id: string; // pathname + search — unique; also how browser back/forward re-docks a minimized window for free
  title: string;
  icon: React.ElementType;
  color: string;
  minimized: boolean;
  path: string; // for restore's navigate(w.path)
  element: ReactNode; // captured via useOutlet(), refreshed on every (re-)dock
  portalNode: HTMLDivElement; // created once, NEVER replaced — see src/lib/domPortal.ts
}

interface RegisterActiveInput {
  id: string;
  path: string;
  title: string;
  icon: React.ElementType;
  color: string;
  element: ReactNode;
}

interface WindowsState {
  windows: WindowEntry[];
  mainSlotNode: HTMLElement | null;
  holdingNode: HTMLElement | null;
  /** Page-supplied titles, keyed by window id. Kept OUT of WindowEntry because
   * registerActive rewrites a re-docked window's title from the nav match on
   * every navigation, which would clobber whatever the page had set. */
  pageTitles: Record<string, string>;

  registerActive: (entry: RegisterActiveInput) => void;
  discardIfActive: (id: string) => void;
  minimize: (id: string) => void;
  close: (id: string) => void;
  setPageTitle: (id: string, title: string | null) => void;
  setMainSlotNode: (node: HTMLElement | null) => void;
  setHoldingNode: (node: HTMLElement | null) => void;
}

/** Title a window shows in the dock and breadcrumb: the page's own if it set
 *  one (an invoice number, a customer name), else its nav-derived label. */
export function windowTitle(entry: WindowEntry, pageTitles: Record<string, string>): string {
  return pageTitles[entry.id] ?? entry.title;
}

function withoutTitle(titles: Record<string, string>, id: string): Record<string, string> {
  if (!(id in titles)) return titles;
  const next = { ...titles };
  delete next[id];
  return next;
}

export const useWindowsStore = create<WindowsState>((set, get) => ({
  windows: [],
  mainSlotNode: null,
  holdingNode: null,
  pageTitles: {},

  registerActive: (entry) => {
    const existing = get().windows.find((w) => w.id === entry.id);
    if (existing) {
      set({
        windows: get().windows.map((w) =>
          w.id === entry.id
            ? { ...w, title: entry.title, icon: entry.icon, color: entry.color, path: entry.path, element: entry.element, minimized: false }
            : w,
        ),
      });
      return;
    }
    const newEntry: WindowEntry = { ...entry, minimized: false, portalNode: createPortalNode() };
    set({ windows: [...get().windows, newEntry] });
  },

  discardIfActive: (id) => {
    const target = get().windows.find((w) => w.id === id);
    if (!target || target.minimized) return; // explicitly minimized — keep it
    set({ windows: get().windows.filter((w) => w.id !== id), pageTitles: withoutTitle(get().pageTitles, id) });
  },

  minimize: (id) => {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)) });
  },

  close: (id) => {
    const target = get().windows.find((w) => w.id === id);
    target?.portalNode.parentElement?.removeChild(target.portalNode);
    set({ windows: get().windows.filter((w) => w.id !== id), pageTitles: withoutTitle(get().pageTitles, id) });
  },

  setPageTitle: (id, title) => {
    const current = get().pageTitles;
    if (title === null) {
      if (!(id in current)) return;
      set({ pageTitles: withoutTitle(current, id) });
      return;
    }
    if (current[id] === title) return;
    set({ pageTitles: { ...current, [id]: title } });
  },

  setMainSlotNode: (node) => set({ mainSlotNode: node }),
  setHoldingNode: (node) => set({ holdingNode: node }),
}));
