import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { ChevronRight, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";

export interface ModuleConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  basePath: string;
  sidebarItems: { label: string; path: string; icon: React.ElementType }[];
}

interface ModuleLayoutProps {
  config: ModuleConfig;
}

export default function ModuleLayout({ config }: ModuleLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Build breadcrumb
  const currentItem = config.sidebarItems.find(i => location.pathname === i.path);
  const isModuleRoot = location.pathname === config.basePath;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Contextual Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-card hidden md:flex flex-col">
        <div className="p-4 border-b border-border">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </button>
          <div className="flex items-center gap-2.5 mt-3">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.color)}>
              <config.icon className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm">{config.label}</span>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {config.sidebarItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                activeClassName="bg-primary/10 text-primary font-medium"
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Breadcrumb bar */}
        <div className="h-10 flex items-center gap-1.5 px-4 border-b border-border bg-card/50 text-xs shrink-0">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
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
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-foreground font-medium">{currentItem.label}</span>
            </>
          )}
        </div>

        {/* Mobile module nav */}
        <div className="md:hidden flex items-center gap-2 px-4 py-2 border-b border-border overflow-x-auto bg-card">
          <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2 text-xs" onClick={() => navigate("/")}>
            <Home className="w-3.5 h-3.5 mr-1" /> Home
          </Button>
          {config.sidebarItems.map((item) => {
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
