import { useNavigate, useLocation } from "react-router-dom";
import { Home, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { MODULE_CONFIGS } from "@/config/modules";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Persistent module rail.
 *
 * The old shell could only reach another module by going back to /home and
 * picking a card — three clicks and a full loss of context. The rail keeps
 * every module one click away from anywhere in the app.
 */

/** Order modules appear in the rail (tenant users). */
const TENANT_RAIL_ORDER = [
  "accounting",
  "banking",
  "sales",
  "expenses",
  "payroll",
  "assets",
  "reports",
  "tenantAdmin",
] as const;

export function railModulesFor(isSuperAdmin: boolean): ModuleConfig[] {
  if (isSuperAdmin) return [MODULE_CONFIGS.superadmin];
  return TENANT_RAIL_ORDER.map((id) => MODULE_CONFIGS[id]).filter(Boolean);
}

interface NavRailProps {
  /** id of the module currently being viewed, if any */
  activeModuleId?: string;
}

export default function NavRail({ activeModuleId }: NavRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSuperAdmin } = useAuth();
  const { isModuleAllowed, planName } = useSubscriptionLimits();

  const modules = railModulesFor(isSuperAdmin);
  const onHome = location.pathname === "/home";

  return (
    <nav
      aria-label="Modules"
      className="hidden md:flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3 print:hidden"
      style={{
        backgroundColor: "hsl(var(--nav-rail))",
        borderColor: "hsl(var(--nav-border))",
      }}
    >
      <RailButton
        label="Home"
        icon={Home}
        active={onHome}
        onClick={() => navigate("/home")}
      />

      <div
        className="my-2 h-px w-6 shrink-0"
        style={{ backgroundColor: "hsl(var(--nav-border))" }}
      />

      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
        {modules.map((mod) => {
          const allowed = isModuleAllowed(mod.basePath);
          return (
            <RailButton
              key={mod.id}
              label={mod.label}
              icon={mod.icon}
              active={activeModuleId === mod.id}
              locked={!allowed}
              lockedHint={`Upgrade from ${planName ?? "your plan"} to access`}
              onClick={() => navigate(mod.basePath)}
            />
          );
        })}
      </div>
    </nav>
  );
}

interface RailButtonProps {
  label: string;
  icon: React.ElementType;
  active?: boolean;
  locked?: boolean;
  lockedHint?: string;
  onClick: () => void;
}

function RailButton({ label, icon: Icon, active, locked, lockedHint, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={locked ? undefined : onClick}
          aria-current={active ? "page" : undefined}
          aria-disabled={locked || undefined}
          className={cn(
            "group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
            locked ? "cursor-not-allowed opacity-40" : "cursor-pointer",
            !locked && !active && "hover:bg-[hsl(var(--nav-hover))]",
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
          {/* accent marker on the rail edge — the only place colour is spent */}
          {active && (
            <span
              className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            />
          )}
          <Icon className="h-[18px] w-[18px]" />
          {locked && (
            <Lock
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full p-[1px]"
              style={{ backgroundColor: "hsl(var(--nav-rail))" }}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {locked ? lockedHint : label}
      </TooltipContent>
    </Tooltip>
  );
}
