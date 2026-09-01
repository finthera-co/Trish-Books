import { useRef, useLayoutEffect } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { useWindowsStore } from "@/stores/useWindowsStore";
import { matchNavItem } from "@/lib/navMatch";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

interface WindowedOutletProps {
  config: ModuleConfig;
}

/**
 * Drop-in replacement for <Outlet/> inside ModuleLayout. Renders only an
 * empty placeholder — the actual page element is captured and handed to
 * WindowManager (mounted once in AppLayout, for the life of the session),
 * which is the ONLY place it's ever actually rendered. This is what lets a
 * page keep running after being minimized: it was never a direct child of
 * this per-navigation subtree to begin with.
 */
export default function WindowedOutlet({ config }: WindowedOutletProps) {
  const location = useLocation();
  const outletElement = useOutlet();
  const slotRef = useRef<HTMLDivElement>(null);
  const registerActive = useWindowsStore((s) => s.registerActive);
  const discardIfActive = useWindowsStore((s) => s.discardIfActive);
  const setMainSlotNode = useWindowsStore((s) => s.setMainSlotNode);

  const id = location.pathname + location.search;

  useLayoutEffect(() => {
    const matchedItem = matchNavItem(config.sidebarItems, id);
    registerActive({
      id,
      path: id,
      title: matchedItem?.label ?? config.label,
      icon: matchedItem?.icon ?? config.icon,
      color: config.color,
      element: outletElement,
    });
    return () => discardIfActive(id);
    // Only re-run when the route actually changes (location.key), not on
    // every incidental re-render of ModuleLayout/WindowedOutlet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useLayoutEffect(() => {
    setMainSlotNode(slotRef.current);
    return () => setMainSlotNode(null);
  }, [setMainSlotNode]);

  return <div ref={slotRef} className="contents" />;
}
