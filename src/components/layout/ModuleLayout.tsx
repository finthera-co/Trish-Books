import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { ChevronRight, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHideSidebar } from "@/stores/useAppStore";
import { useAuth } from "@/contexts/AuthContext";
import { useShellV2 } from "@/lib/shellFlag";
import AppShell from "@/components/layout/AppShell";

export interface ModuleConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  basePath: string;
  sidebarItems: { label: string; path: string; icon: React.ElementType; adminOnly?: boolean; group?: string }[];
}

interface ModuleLayoutProps {
  config: ModuleConfig;
}

export default function ModuleLayout({ config }: ModuleLayoutProps) {
  const shellV2 = useShellV2();
  return shellV2 ? <AppShell config={config} /> : <LegacyModuleLayout config={config} />;
}

/** Original single-sidebar shell. Removed once shell v2 is approved. */
function LegacyModuleLayout({ config }: ModuleLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const hideSidebar = useHideSidebar();
  const { isCompanyAdmin } = useAuth();

  const visibleItems = config.sidebarItems.filter((i) => !i.adminOnly || isCompanyAdmin);
  const currentItem = config.sidebarItems.find(i => location.pathname === i.path);
  const isModuleRoot = location.pathname === config.basePath;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Dark contextual sidebar */}
      <aside className={cn(
        "shrink-0 bg-sidebar hidden md:flex flex-col border-r border-sidebar-border transition-all duration-300 overflow-hidden",
        hideSidebar ? "w-0 border-r-0" : "w-60"
      )}>
        <div className="relative p-4 border-b border-sidebar-border overflow-hidden">
          {/* module-colored wash */}
          <div className={cn("absolute inset-0 opacity-[0.16] pointer-events-none", config.color)} />
          <div className="relative">
            <button
              onClick={() => navigate("/home")}
              className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground transition-all duration-200"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Home
            </button>
            <div className="flex items-center gap-3 mt-4">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shadow-md", config.color)}>
                <config.icon className="w-4.5 h-4.5 text-primary-foreground" />
              </div>
              <span className="font-bold text-sidebar-accent-foreground text-sm tracking-tight">{config.label}</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-out",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-sidebar-foreground hover:bg-muted hover:text-foreground hover:translate-x-0.5",
                )}
              >
                {isActive && <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full", config.color)} />}
                <item.icon className={cn("w-[18px] h-[18px] shrink-0", isActive && "text-foreground")} />
                <span className="text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Breadcrumb bar */}
        <div className="h-10 flex items-center gap-1.5 px-5 border-b border-border bg-card text-xs shrink-0 print:hidden">
          <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
          <Link
            to={config.basePath}
            className={cn(
              "transition-colors",
              isModuleRoot ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {config.label}
          </Link>
          {currentItem && !isModuleRoot && (
            <>
              <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
              <span className="text-foreground font-medium">{currentItem.label}</span>
            </>
          )}
        </div>

        {/* Mobile module nav */}
        <div className="md:hidden flex items-center gap-2 px-4 py-2 border-b border-border overflow-x-auto bg-card print:hidden">
          <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2 text-xs" onClick={() => navigate("/home")}>
            <Home className="w-3.5 h-3.5 mr-1" /> Home
          </Button>
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.path}
                variant={isActive ? "default" : "ghost"}
                size="sm"
                className="shrink-0 h-7 px-2.5 text-xs"
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </Button>
            );
          })}
        </div>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
