import { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

type Item = ModuleConfig["sidebarItems"][number];

/**
 * Contextual nav for the active module.
 *
 * Items carry an optional `group`; consecutive groups render under a small
 * section label so long modules (Accounting has 20 entries) read as a few
 * short lists instead of one wall of links.
 */
interface ModuleNavPanelProps {
  config: ModuleConfig;
  onCollapse?: () => void;
}

export default function ModuleNavPanel({ config, onCollapse }: ModuleNavPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isCompanyAdmin } = useAuth();

  const sections = useMemo(() => {
    const visible = config.sidebarItems.filter((i) => !i.adminOnly || isCompanyAdmin);
    const out: { label: string | null; items: Item[] }[] = [];
    for (const item of visible) {
      const label = item.group ?? null;
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }
    return out;
  }, [config.sidebarItems, isCompanyAdmin]);

  const isModuleRoot = location.pathname === config.basePath;

  return (
    <aside
      aria-label={`${config.label} navigation`}
      className="hidden w-56 shrink-0 flex-col border-r md:flex print:hidden"
      style={{
        backgroundColor: "hsl(var(--nav-panel))",
        borderColor: "hsl(var(--nav-border))",
      }}
    >
      {/* Module identity */}
      <div
        className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3"
        style={{ borderColor: "hsl(var(--nav-border))" }}
      >
        <button
          type="button"
          onClick={() => navigate(config.basePath)}
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[hsl(var(--nav-hover))]"
        >
          <config.icon
            className="h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--nav-fg))" }}
          />
          <span
            className="truncate text-sm font-semibold tracking-tight"
            style={{ color: "hsl(var(--nav-fg-strong))" }}
          >
            {config.label}
          </span>
        </button>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse navigation"
            className="shrink-0 rounded-md p-1 transition-colors hover:bg-[hsl(var(--nav-hover))]"
            style={{ color: "hsl(var(--nav-section))" }}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {/* Module overview */}
        <PanelItem
          label="Overview"
          icon={config.icon}
          active={isModuleRoot}
          onClick={() => navigate(config.basePath)}
        />

        {sections.map((section, si) => (
          <div key={section.label ?? `ungrouped-${si}`} className="mt-4 first:mt-3">
            {section.label && (
              <p
                className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "hsl(var(--nav-section))" }}
              >
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <PanelItem
                  key={item.path}
                  label={item.label}
                  icon={item.icon}
                  active={location.pathname === item.path}
                  onClick={() => navigate(item.path)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

interface PanelItemProps {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}

function PanelItem({ label, icon: Icon, active, onClick }: PanelItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
        active ? "font-medium" : "hover:bg-[hsl(var(--nav-hover))]",
      )}
      style={
        active
          ? {
              backgroundColor: "hsl(var(--nav-active-bg))",
              color: "hsl(var(--nav-active-fg))",
            }
          : { color: "hsl(var(--nav-fg))" }
      }
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </button>
  );
}
