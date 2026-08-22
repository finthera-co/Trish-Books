import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useNavStore } from "@/stores/useNavStore";
import { MODULE_CONFIGS } from "@/config/modules";

const GO_TARGETS: Record<string, { path: string; moduleId: string | null }> = {
  h: { path: "/home", moduleId: null },
  a: { path: MODULE_CONFIGS.accounting.basePath, moduleId: "accounting" },
  s: { path: MODULE_CONFIGS.sales.basePath, moduleId: "sales" },
  b: { path: MODULE_CONFIGS.banking.basePath, moduleId: "banking" },
  r: { path: MODULE_CONFIGS.reports.basePath, moduleId: "reports" },
  p: { path: MODULE_CONFIGS.payroll.basePath, moduleId: "payroll" },
};

const GO_KEY_TIMEOUT = 500;

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * Global keyboard shortcuts, registered once in AppLayout. ⌘K search-focus is
 * intentionally NOT handled here — GlobalSearchBar already owns that listener.
 */
export function useGlobalKeyboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const bookmarks = useNavStore((s) => s.bookmarks);
  const addBookmark = useNavStore((s) => s.addBookmark);
  const removeBookmark = useNavStore((s) => s.removeBookmark);
  const sidebarPinned = useNavStore((s) => s.sidebarPinned);
  const setSidebarPinned = useNavStore((s) => s.setSidebarPinned);
  const setShortcutsDialogOpen = useNavStore((s) => s.setShortcutsDialogOpen);
  const setCreateMenuOpen = useNavStore((s) => s.setCreateMenuOpen);
  const setActiveModule = useNavStore((s) => s.setActiveModule);

  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;

  useEffect(() => {
    let awaitingGoKey = false;
    let goTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearGoState = () => {
      awaitingGoKey = false;
      if (goTimeout) clearTimeout(goTimeout);
      goTimeout = null;
    };

    const handler = (e: KeyboardEvent) => {
      const typing = isTypingTarget(document.activeElement);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const path = pathRef.current;
        if (bookmarksRef.current.includes(path)) {
          removeBookmark(path);
          toast("Bookmark removed");
        } else {
          addBookmark(path);
          toast("Page bookmarked");
        }
        return;
      }

      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarPinned(!sidebarPinned);
        return;
      }

      if (typing) return;

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsDialogOpen(true);
        return;
      }

      if (e.key.toLowerCase() === "n" && !mod) {
        e.preventDefault();
        setCreateMenuOpen(true);
        return;
      }

      if (e.key.toLowerCase() === "g" && !mod) {
        awaitingGoKey = true;
        if (goTimeout) clearTimeout(goTimeout);
        goTimeout = setTimeout(clearGoState, GO_KEY_TIMEOUT);
        return;
      }

      if (awaitingGoKey) {
        const target = GO_TARGETS[e.key.toLowerCase()];
        clearGoState();
        if (target) {
          e.preventDefault();
          setActiveModule(target.moduleId);
          navigate(target.path);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearGoState();
    };
  }, [navigate, addBookmark, removeBookmark, sidebarPinned, setSidebarPinned, setShortcutsDialogOpen, setCreateMenuOpen, setActiveModule]);
}
