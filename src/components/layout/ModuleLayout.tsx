import { Outlet, useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <Breadcrumbs config={config} />
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function Breadcrumbs({ config }: { config: ModuleConfig }) {
  const location = useLocation();
  const currentItem = config.sidebarItems.find((i) => location.pathname === i.path);
  const isModuleRoot = location.pathname === config.basePath;

  return (
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
          isModuleRoot ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
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
  );
}
