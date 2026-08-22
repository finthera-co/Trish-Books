import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Pin, PinOff, BookmarkPlus, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useNavStore } from "@/stores/useNavStore";
import { NavLink } from "@/components/NavLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

interface AppsSidebarProps {
  config: ModuleConfig;
}

export default function AppsSidebar({ config }: AppsSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isCompanyAdmin } = useAuth();
  const { isModuleAllowed, planName } = useSubscriptionLimits();
  const sidebarPinned = useNavStore((s) => s.sidebarPinned);
  const setSidebarPinned = useNavStore((s) => s.setSidebarPinned);
  const bookmarks = useNavStore((s) => s.bookmarks);
  const addBookmark = useNavStore((s) => s.addBookmark);
  const removeBookmark = useNavStore((s) => s.removeBookmark);

  const visibleItems = config.sidebarItems.filter((i) => !i.adminOnly || isCompanyAdmin);

  const sections = useMemo(() => {
    const out: { label: string | null; items: typeof visibleItems }[] = [];
    for (const item of visibleItems) {
      const label = item.group ?? null;
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.sidebarItems, isCompanyAdmin]);

  const isBookmarked = bookmarks.includes(location.pathname);

  return (
    <aside
      aria-label={`${config.label} navigation`}
      className="hidden md:flex w-56 shrink-0 flex-col bg-card border-r border-border overflow-hidden"
    >
      <div className="p-3 border-b border-border">
        <button
          type="button"
          onClick={() => navigate("/home")}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </button>
        <div className="flex items-center gap-2.5 mt-3">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shadow-sm shrink-0", config.color)}>
            <config.icon className="w-4.5 h-4.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-foreground text-sm tracking-tight truncate">{config.label}</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section, si) => (
          <div key={section.label ?? `ungrouped-${si}`} className="mb-4 last:mb-0">
            {section.label && (
              <p className="px-2 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const allowed = isModuleAllowed(item.path);
                if (!allowed) {
                  return (
                    <Tooltip key={item.path}>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-muted-foreground/50 cursor-not-allowed">
                          <item.icon className="w-[18px] h-[18px] shrink-0" />
                          <span className="truncate flex-1">{item.label}</span>
                          <Lock className="w-3 h-3 shrink-0" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Upgrade from <strong>{planName}</strong> to access
                      </TooltipContent>
                    </Tooltip>
                  );
                }
                const itemBookmarked = bookmarks.includes(item.path);
                return (
                  <ContextMenu key={item.path}>
                    <ContextMenuTrigger asChild>
                      <NavLink
                        to={item.path}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-foreground transition-all duration-200 hover:bg-muted"
                        activeClassName="bg-accent text-accent-foreground font-medium border-l-[3px] border-l-primary"
                      >
                        <item.icon className="w-[18px] h-[18px] shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => (itemBookmarked ? removeBookmark(item.path) : addBookmark(item.path))}
                      >
                        {itemBookmarked ? (
                          <>
                            <BookmarkCheck className="w-3.5 h-3.5 mr-2" /> Remove bookmark
                          </>
                        ) : (
                          <>
                            <BookmarkPlus className="w-3.5 h-3.5 mr-2" /> Bookmark this page
                          </>
                        )}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2 space-y-0.5">
        <button
          type="button"
          onClick={() => setSidebarPinned(!sidebarPinned)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
        >
          {sidebarPinned ? <PinOff className="w-3.5 h-3.5 shrink-0" /> : <Pin className="w-3.5 h-3.5 shrink-0" />}
          {sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
        </button>
        <button
          type="button"
          onClick={() => (isBookmarked ? removeBookmark(location.pathname) : addBookmark(location.pathname))}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
        >
          {isBookmarked ? <BookmarkCheck className="w-3.5 h-3.5 shrink-0 text-primary" /> : <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />}
          {isBookmarked ? "Bookmarked" : "Bookmark this page"}
        </button>
      </div>
    </aside>
  );
}
