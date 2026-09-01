import { forwardRef, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Bookmark, Grid3X3, BarChart3, Settings, HelpCircle, Lock, X, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_CONFIGS } from "@/config/modules";
import { matchNavItem, allNavItems } from "@/lib/navMatch";
import { useNavStore, MAX_PINNED_MODULES } from "@/stores/useNavStore";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Modules that always have their own button on the rail. */
const FIXED_RAIL_MODULES = new Set(["reports", "tenantAdmin"]);

const APP_GROUPS: { label: string; moduleIds: string[] }[] = [
  { label: "Core", moduleIds: ["accounting", "sales", "banking", "expenses"] },
  { label: "Operations", moduleIds: ["payroll", "assets"] },
  { label: "Reports & admin", moduleIds: ["reports", "tenantAdmin"] },
];

export default function NavRail() {
  const navigate = useNavigate();
  const activeModule = useNavStore((s) => s.activeModule);
  const setActiveModule = useNavStore((s) => s.setActiveModule);
  const pinnedModules = useNavStore((s) => s.pinnedModules);
  const { isModuleAllowed } = useSubscriptionLimits();

  const pinned = pinnedModules
    .map((id) => MODULE_CONFIGS[id])
    .filter((m): m is NonNullable<typeof m> => !!m && isModuleAllowed(m.basePath));

  // Reports and Settings have permanent buttons at the bottom of the rail, so
  // pinning either one must not render it a second time in the pinned strip.
  const pinnedIds = new Set(pinned.map((m) => m.id));
  const railModuleIds = new Set([...pinnedIds, "reports", "tenantAdmin"]);

  return (
    <nav
      aria-label="Primary"
      className="w-14 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col items-center pt-5 pb-2 gap-1"
    >
      <RailButton
        icon={LayoutDashboard}
        label="Home"
        active={activeModule === null}
        onClick={() => {
          setActiveModule(null);
          navigate("/home");
        }}
      />

      <RailBookmarks />

      <RailAllApps railModuleIds={railModuleIds} />

      {pinned.some((m) => !FIXED_RAIL_MODULES.has(m.id)) && (
        <div className="w-6 h-px bg-sidebar-border mx-auto my-1" />
      )}
      {pinned.filter((m) => !FIXED_RAIL_MODULES.has(m.id)).map((mod) => (
        <RailButton
          key={mod.id}
          icon={mod.icon}
          label={mod.label}
          active={activeModule === mod.id}
          onClick={() => {
            setActiveModule(mod.id);
            navigate(mod.basePath);
          }}
        />
      ))}

      <RailButton
        icon={BarChart3}
        label="Reports"
        active={activeModule === "reports"}
        onClick={() => {
          setActiveModule("reports");
          navigate("/reports");
        }}
      />

      <div className="w-6 h-px bg-sidebar-border mx-auto my-1" />

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailButton
          icon={Settings}
          label="Settings"
          active={activeModule === "tenantAdmin"}
          onClick={() => {
            setActiveModule("tenantAdmin");
            navigate("/settings");
          }}
        />
        <RailButton icon={HelpCircle} label="Help" onClick={() => window.open("https://help.trishbooks.com", "_blank")} />
      </div>
    </nav>
  );
}

interface RailButtonProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  /** Set on the buttons that open a flyout, so the panel state is announced. */
  expanded?: boolean;
  onClick: () => void;
}

const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(function RailButton(
  { icon: Icon, label, active, expanded, onClick },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          aria-haspopup={expanded === undefined ? undefined : "menu"}
          aria-expanded={expanded}
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0",
            "hover:bg-sidebar-accent",
            active && "border-l-[3px] border-l-primary bg-sidebar-accent",
          )}
        >
          <Icon className={cn("w-5 h-5 text-sidebar-foreground/70", active && "text-primary")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
});

interface RailFlyoutProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  panelClassName?: string;
  children: React.ReactNode;
}

/**
 * A rail button and the panel it opens. Click to toggle, Escape or an outside
 * click to dismiss — deliberately NOT hover-to-open: these panels hold their
 * own controls (pin a module, remove a bookmark), and one that disappears the
 * moment the pointer slips off it makes those controls unusable. Hover-open
 * also fought the click handler, since clicking while already hovered closed
 * the panel and it could not reopen until the pointer left the rail entirely.
 */
function RailFlyout({ icon, label, active, open, setOpen, panelClassName, children }: RailFlyoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <div ref={containerRef} className="relative">
      <RailButton ref={buttonRef} icon={icon} label={label} active={active} expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div
          className={cn(
            "absolute left-14 top-0 z-50 bg-card border border-border rounded-xl shadow-xl",
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface BookmarkDisplay {
  label: string;
  icon: React.ElementType;
}

/**
 * Resolves a bookmarked URL to a label + icon. matchNavItem handles the
 * sidebar-item cases (exact, query-string, and detail routes under a list);
 * a module root falls back to the module, and anything still unresolved to a
 * label derived from the path — so a bookmark never silently vanishes.
 */
function resolveBookmark(path: string): BookmarkDisplay {
  const item = matchNavItem(allNavItems(), path);
  if (item) return { label: item.label, icon: item.icon };

  const pathname = path.split("?")[0];
  const mod = Object.values(MODULE_CONFIGS).find((m) => m.basePath === pathname);
  if (mod) return { label: mod.label, icon: mod.icon };

  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? pathname;
  const label = lastSegment.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return { label, icon: Bookmark };
}

function RailBookmarks() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const bookmarks = useNavStore((s) => s.bookmarks);
  const removeBookmark = useNavStore((s) => s.removeBookmark);

  const items = bookmarks.map((path) => ({ path, ...resolveBookmark(path) }));

  return (
    <RailFlyout
      icon={Bookmark}
      label="Bookmarks"
      open={open}
      setOpen={setOpen}
      panelClassName="w-56 overflow-hidden"
    >
      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto py-1.5">
        {items.length === 0 ? (
          <p className="px-3.5 py-6 text-xs text-muted-foreground text-center">
            No bookmarks yet. Right-click any page to bookmark it.
          </p>
        ) : (
          items.map(({ path, label, icon: Icon }) => (
            <div
              key={path}
              className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/60 group"
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => {
                  navigate(path);
                  setOpen(false);
                }}
                className="truncate flex-1 text-left"
              >
                {label}
              </button>
              <button
                type="button"
                onClick={() => removeBookmark(path)}
                aria-label={`Remove bookmark: ${label}`}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border px-3.5 py-2">
        <p className="text-[10px] text-muted-foreground">Tip: press Ctrl+D to bookmark the current page</p>
      </div>
    </RailFlyout>
  );
}

function RailAllApps({ railModuleIds }: { railModuleIds: Set<string> }) {
  const navigate = useNavigate();
  const open = useNavStore((s) => s.allAppsOpen);
  const setOpen = useNavStore((s) => s.setAllAppsOpen);
  const setActiveModule = useNavStore((s) => s.setActiveModule);
  const activeModule = useNavStore((s) => s.activeModule);
  const pinnedModules = useNavStore((s) => s.pinnedModules);
  const togglePinnedModule = useNavStore((s) => s.togglePinnedModule);
  const { isModuleAllowed, planName } = useSubscriptionLimits();

  const handleSelect = (id: string, basePath: string) => {
    setActiveModule(id);
    navigate(basePath);
    setOpen(false);
  };

  return (
    <RailFlyout
      icon={Grid3X3}
      label="All apps"
      active={activeModule !== null && !railModuleIds.has(activeModule)}
      open={open}
      setOpen={setOpen}
      panelClassName="w-64 max-h-[calc(100vh-8rem)] overflow-y-auto py-1.5"
    >
      {APP_GROUPS.map((group) => {
            const modules = group.moduleIds
              .map((id) => MODULE_CONFIGS[id])
              .filter((m): m is NonNullable<typeof m> => !!m);
            if (modules.length === 0) return null;
            return (
              <div key={group.label} className="py-1">
                <p className="px-3.5 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </p>
                {modules.map((mod) => {
                  const allowed = isModuleAllowed(mod.basePath);
                  const pinned = pinnedModules.includes(mod.id);
                  const pinDisabled = !pinned && pinnedModules.length >= MAX_PINNED_MODULES;
                  return (
                    <Tooltip key={mod.id}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors group",
                            allowed ? "text-foreground hover:bg-muted/60" : "text-muted-foreground/50",
                          )}
                        >
                          <button
                            type="button"
                            disabled={!allowed}
                            onClick={() => allowed && handleSelect(mod.id, mod.basePath)}
                            className={cn("flex items-center gap-2.5 flex-1 min-w-0", !allowed && "cursor-not-allowed")}
                          >
                            <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0", mod.color)}>
                              <mod.icon className="w-3.5 h-3.5 text-primary-foreground" />
                            </div>
                            <span className="truncate flex-1 text-left">{mod.label}</span>
                          </button>
                          {!allowed && <Lock className="w-3 h-3 shrink-0" />}
                          {allowed && (
                            <button
                              type="button"
                              disabled={pinDisabled}
                              onClick={() => togglePinnedModule(mod.id)}
                              aria-label={pinned ? `Unpin ${mod.label}` : `Pin ${mod.label}`}
                              className={cn(
                                "shrink-0 p-1 rounded-md transition-opacity",
                                pinned
                                  ? "text-primary opacity-100 hover:bg-primary/10"
                                  : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-muted",
                                pinDisabled && "opacity-0 group-hover:opacity-40 cursor-not-allowed",
                              )}
                            >
                              {pinned ? <Pin className="w-3 h-3 fill-current" /> : <Pin className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      </TooltipTrigger>
                      {!allowed && (
                        <TooltipContent side="right">
                          Upgrade from <strong>{planName}</strong> to access
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </div>
            );
          })}
    </RailFlyout>
  );
}
