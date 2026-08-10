import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { ChevronRight, Menu, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useHideSidebar, useSetHideSidebar } from "@/stores/useAppStore";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";
import NavRail, { railModulesFor } from "@/components/layout/NavRail";
import ModuleNavPanel from "@/components/layout/ModuleNavPanel";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

/**
 * Shell v2 — persistent module rail + contextual module panel.
 *
 * Replaces ModuleLayout's single dark sidebar. Differences that matter:
 *  - every module is reachable in one click from anywhere (the rail)
 *  - long modules are grouped into labelled sections (the panel)
 *  - the standalone breadcrumb strip is folded into the content header
 *  - nav surfaces are neutral; green is reserved for the active state
 */
interface AppShellProps {
  config: ModuleConfig;
  /** Render this instead of <Outlet /> — used by the design preview. */
  children?: React.ReactNode;
}

export default function AppShell({ config, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isCompanyAdmin, isSuperAdmin } = useAuth();
  const collapsed = useHideSidebar();
  const setCollapsed = useSetHideSidebar();

  const visibleItems = config.sidebarItems.filter((i) => !i.adminOnly || isCompanyAdmin);
  const currentItem = visibleItems.find((i) => location.pathname === i.path);
  const isModuleRoot = location.pathname === config.basePath;
  const railModules = railModulesFor(isSuperAdmin);

  return (
    <div className="shell-v2 flex h-full overflow-hidden">
      <NavRail activeModuleId={config.id} />

      {!collapsed && <ModuleNavPanel config={config} onCollapse={() => setCollapsed(true)} />}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Content header: breadcrumb + section title, replacing the old
            standalone breadcrumb strip and the mobile nav row. */}
        <header
          className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-5 print:hidden"
          style={{
            borderColor: "hsl(var(--nav-border))",
            backgroundColor: "hsl(var(--nav-panel))",
          }}
        >
          {/* Mobile: full nav in a drawer */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open navigation"
                className="rounded-md p-1.5 transition-colors hover:bg-[hsl(var(--nav-hover))] md:hidden"
                style={{ color: "hsl(var(--nav-fg))" }}
              >
                <Menu className="h-4 w-4" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="shell-v2 w-72 p-0">
              <MobileNav
                config={config}
                railModules={railModules}
                items={visibleItems}
                onNavigate={navigate}
              />
            </SheetContent>
          </Sheet>

          {/* Desktop: re-open the collapsed panel */}
          {collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Show navigation"
              className="hidden rounded-md p-1.5 transition-colors hover:bg-[hsl(var(--nav-hover))] md:block"
              style={{ color: "hsl(var(--nav-fg))" }}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <Link
              to="/home"
              className="shrink-0 transition-colors hover:underline"
              style={{ color: "hsl(var(--nav-section))" }}
            >
              Home
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0" style={{ color: "hsl(var(--nav-section))" }} />
            <Link
              to={config.basePath}
              className={cn("shrink-0 transition-colors", !isModuleRoot && "hover:underline")}
              style={{
                color: isModuleRoot ? "hsl(var(--nav-fg-strong))" : "hsl(var(--nav-section))",
                fontWeight: isModuleRoot ? 600 : 400,
              }}
            >
              {config.label}
            </Link>
            {currentItem && !isModuleRoot && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0" style={{ color: "hsl(var(--nav-section))" }} />
                <span
                  className="truncate font-semibold"
                  style={{ color: "hsl(var(--nav-fg-strong))" }}
                >
                  {currentItem.label}
                </span>
              </>
            )}
          </nav>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}

interface MobileNavProps {
  config: ModuleConfig;
  railModules: ModuleConfig[];
  items: ModuleConfig["sidebarItems"];
  onNavigate: (path: string) => void;
}

function MobileNav({ config, railModules, items, onNavigate }: MobileNavProps) {
  const location = useLocation();
  return (
    <div
      className="flex h-full flex-col"
      style={{ backgroundColor: "hsl(var(--nav-panel))" }}
    >
      <div
        className="shrink-0 border-b p-3"
        style={{ borderColor: "hsl(var(--nav-border))" }}
      >
        <p
          className="pb-2 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "hsl(var(--nav-section))" }}
        >
          Modules
        </p>
        <div className="flex flex-wrap gap-1.5">
          {railModules.map((mod) => {
            const active = mod.id === config.id;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => onNavigate(mod.basePath)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors"
                style={
                  active
                    ? {
                        backgroundColor: "hsl(var(--nav-active-bg))",
                        color: "hsl(var(--nav-active-fg))",
                        fontWeight: 600,
                      }
                    : { color: "hsl(var(--nav-fg))" }
                }
              >
                <mod.icon className="h-3.5 w-3.5" />
                {mod.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {items.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] transition-colors"
              style={
                active
                  ? {
                      backgroundColor: "hsl(var(--nav-active-bg))",
                      color: "hsl(var(--nav-active-fg))",
                      fontWeight: 500,
                    }
                  : { color: "hsl(var(--nav-fg))" }
              }
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-80" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
