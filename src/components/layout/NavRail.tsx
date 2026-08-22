import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Bookmark, Grid3X3, BarChart3, Settings, HelpCircle, Lock, X, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_CONFIGS } from "@/config/modules";
import { useNavStore, MAX_PINNED_MODULES } from "@/stores/useNavStore";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

      <RailAllApps />

      {pinned.length > 0 && <div className="w-6 h-px bg-sidebar-border mx-auto my-1" />}
      {pinned.map((mod) => (
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
  onClick: () => void;
}

function RailButton({ icon: Icon, label, active, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
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
}

interface BookmarkDisplay {
  label: string;
  icon: React.ElementType;
}

/**
 * Resolves a bookmarked path to a label + icon. Exact sidebar-item matches win;
 * a module's own root (e.g. "/accounting") falls back to the module itself;
 * anything else (detail/edit routes with an :id, etc.) falls back to the
 * longest sidebar-item path that prefixes it, then finally a generic label
 * derived from the path — so a bookmark never silently vanishes from the list.
 */
function resolveBookmark(path: string): BookmarkDisplay {
  for (const mod of Object.values(MODULE_CONFIGS)) {
    const exact = mod.sidebarItems.find((i) => i.path === path);
    if (exact) return { label: exact.label, icon: exact.icon };
  }
  for (const mod of Object.values(MODULE_CONFIGS)) {
    if (mod.basePath === path) return { label: mod.label, icon: mod.icon };
  }
  let best: BookmarkDisplay | null = null;
  let bestLen = 0;
  for (const mod of Object.values(MODULE_CONFIGS)) {
    for (const item of mod.sidebarItems) {
      if (path.startsWith(`${item.path}/`) && item.path.length > bestLen) {
        best = { label: item.label, icon: item.icon };
        bestLen = item.path.length;
      }
    }
  }
  if (best) return best;
  const lastSegment = path.split("/").filter(Boolean).pop() ?? path;
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
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <RailButton icon={Bookmark} label="Bookmarks" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="absolute left-14 top-0 z-50 w-56 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
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
                  <button type="button" onClick={() => navigate(path)} className="truncate flex-1 text-left">
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
        </div>
      )}
    </div>
  );
}

function RailAllApps() {
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
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <RailButton
        icon={Grid3X3}
        label="All apps"
        active={activeModule !== null && activeModule !== "reports" && activeModule !== "tenantAdmin"}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="absolute left-14 top-0 z-50 w-64 max-h-[calc(100vh-8rem)] overflow-y-auto bg-card border border-border rounded-xl shadow-xl py-1.5">
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
        </div>
      )}
    </div>
  );
}
