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

  registerActive: (entry: RegisterActiveInput) => void;
  discardIfActive: (id: string) => void;
  minimize: (id: string) => void;
  close: (id: string) => void;
  setMainSlotNode: (node: HTMLElement | null) => void;
  setHoldingNode: (node: HTMLElement | null) => void;
}

export const useWindowsStore = create<WindowsState>((set, get) => ({
  windows: [],
  mainSlotNode: null,
  holdingNode: null,

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
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },

  minimize: (id) => {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)) });
  },

  close: (id) => {
    const target = get().windows.find((w) => w.id === id);
    target?.portalNode.parentElement?.removeChild(target.portalNode);
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },

  setMainSlotNode: (node) => set({ mainSlotNode: node }),
  setHoldingNode: (node) => set({ holdingNode: node }),
}));
