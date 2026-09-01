import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchNavItem } from "@/lib/navMatch";
import { useWindowsStore } from "@/stores/useWindowsStore";
import WindowedOutlet from "@/components/windows/WindowedOutlet";
import MinimizeButton from "@/components/windows/MinimizeButton";
import CloseButton from "@/components/windows/CloseButton";

export interface ModuleConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  basePath: string;
  /** Set on the pseudo-module that carries workspace-level pages (dashboard,
   *  notifications, profile). They have no module of their own, so the module
   *  crumb is skipped and the trail reads Home > Page. */
  standalone?: boolean;
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
        <WindowedOutlet config={config} />
      </main>
    </div>
  );
}

function Breadcrumbs({ config }: { config: ModuleConfig }) {
  const location = useLocation();
  const url = location.pathname + location.search;
  const currentItem = matchNavItem(config.sidebarItems, url);
  const isModuleRoot = location.pathname === config.basePath;
  // A detail route ("/accounting/journals/JE-123") resolves to the list item it
  // came from, so the list stays a live link and the record gets its own leaf.
  const isDetailOfItem = !!currentItem && currentItem.path !== url;
  const pageTitle = useWindowsStore((s) => s.pageTitles[url]);

  return (
    <div className="h-10 flex items-center gap-1.5 px-5 border-b border-border bg-card text-xs shrink-0 print:hidden">
      <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
        <Home className="w-3.5 h-3.5" />
        <span>Home</span>
      </Link>
      {!config.standalone && (
        <>
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
        </>
      )}
      {currentItem && !isModuleRoot && (
        <>
          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
          {isDetailOfItem ? (
            <Link to={currentItem.path} className="text-muted-foreground hover:text-foreground transition-colors">
              {currentItem.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{currentItem.label}</span>
          )}
        </>
      )}
      {isDetailOfItem && pageTitle && (
        <>
          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
          <span className="text-foreground font-medium truncate max-w-[16rem]">{pageTitle}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <MinimizeButton />
        <CloseButton />
      </div>
    </div>
  );
}
