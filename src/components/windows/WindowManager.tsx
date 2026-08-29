import { useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWindowsStore, type WindowEntry } from "@/stores/useWindowsStore";
import { useMovePortalNode } from "@/lib/domPortal";

/**
 * Mounted once in AppLayout — never unmounts for the life of the session.
 * Owns the single stable createPortal() call site per window (see
 * useWindowsStore's WindowEntry.portalNode) and the hidden holder that
 * minimized windows live in, plus the bottom dock bar.
 */
export default function WindowManager() {
  const windows = useWindowsStore((s) => s.windows);
  const holdingNode = useWindowsStore((s) => s.holdingNode);
  const setHoldingNode = useWindowsStore((s) => s.setHoldingNode);
  const holdingRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setHoldingNode(holdingRef.current);
    return () => setHoldingNode(null);
  }, [setHoldingNode]);

  const hasMinimized = windows.some((w) => w.minimized);

  return (
    <>
      {/* Always-mounted, invisible home for minimized windows' content. */}
      <div ref={holdingRef} style={{ display: "none" }} />

      {windows.map((w) => (
        <WindowPortalTarget key={w.id} window={w} holdingNode={holdingNode} />
      ))}

      {hasMinimized && <Dock windows={windows} />}
    </>
  );
}

interface WindowPortalTargetProps {
  window: WindowEntry;
  holdingNode: HTMLElement | null;
}

/** One per window — the single stable createPortal() call site for it. */
function WindowPortalTarget({ window: w, holdingNode }: WindowPortalTargetProps) {
  const mainSlotNode = useWindowsStore((s) => s.mainSlotNode);
  const target = w.minimized || !mainSlotNode ? holdingNode : mainSlotNode;
  useMovePortalNode(w.portalNode, target);
  return createPortal(w.element, w.portalNode);
}

function Dock({ windows }: { windows: WindowEntry[] }) {
  const navigate = useNavigate();
  const close = useWindowsStore((s) => s.close);
  const minimized = windows.filter((w) => w.minimized);

  if (minimized.length === 0) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur",
        "supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]",
        "flex items-center gap-2 px-3 py-2 overflow-x-auto",
      )}
    >
      {minimized.map((w) => (
        <div
          key={w.id}
          className="shrink-0 flex items-center gap-2 rounded-lg border border-border bg-card pl-3 pr-1.5 py-1.5 shadow-sm hover:shadow-md transition-shadow duration-200"
        >
          <button
            type="button"
            onClick={() => navigate(w.path)}
            className="flex items-center gap-2 text-left"
          >
            <div className={cn("w-5 h-5 rounded-md flex items-center justify-center shrink-0", w.color)}>
              <w.icon className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="text-xs font-medium text-foreground max-w-[140px] truncate">{w.title}</span>
          </button>
          <button
            type="button"
            onClick={() => close(w.id)}
            aria-label={`Close ${w.title}`}
            className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
