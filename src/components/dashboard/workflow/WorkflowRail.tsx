import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import WorkflowChip from "./WorkflowChip";
import { WORKFLOW_RAILS, type RailItem } from "@/config/workflow";

// Accent is neutral for rail items (they aren't tied to a process band), so
// the chip renders in the app's primary token rather than a band color.
const RAIL_ACCENT = "var(--primary)";

function RailTile({ item, disabled, planName }: { item: RailItem; disabled: boolean; planName?: string | null }) {
  const content = (
    <div className="flex flex-col items-center gap-1">
      <WorkflowChip icon={item.icon} accentVar={RAIL_ACCENT} size="sm" disabled={disabled} reason={disabled ? "locked" : undefined} />
      <span className="max-w-[76px] text-center text-[11px] font-medium leading-tight text-foreground">
        {item.label}
      </span>
    </div>
  );

  const wrapperClassName = cn(
    "inline-flex flex-col items-center rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
  );

  const inner = disabled ? (
    <div role="button" aria-disabled="true" className={wrapperClassName}>
      {content}
    </div>
  ) : (
    <Link to={item.path} className={wrapperClassName}>
      {content}
    </Link>
  );

  if (!disabled) return inner;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent>Not included in your {planName || "current"} plan</TooltipContent>
    </Tooltip>
  );
}

export default function WorkflowRail() {
  const { isModuleAllowed, planName } = useSubscriptionLimits();

  return (
    <div className="w-full shrink-0 space-y-4 lg:w-[220px]">
      {WORKFLOW_RAILS.map((group) => (
        <div key={group.id} className="overflow-hidden rounded-lg border border-border">
          <div className="bg-muted px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </div>
          <div className="grid grid-cols-4 gap-2 p-3 lg:grid-cols-2">
            {group.items.map((item) => (
              <RailTile
                key={item.path}
                item={item}
                disabled={!isModuleAllowed(item.moduleId)}
                planName={planName}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
