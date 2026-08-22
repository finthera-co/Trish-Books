import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import WorkflowNodeTile from "./WorkflowNodeTile";
import type { WorkflowBand } from "@/config/workflow";

interface Props {
  band: WorkflowBand;
  registerRef: (id: string, el: HTMLElement | null) => void;
}

export default function WorkflowBandRow({ band, registerRef }: Props) {
  const { isModuleAllowed, planName } = useSubscriptionLimits();

  return (
    <div className="relative">
      <div className="absolute left-6 top-0 z-20 -translate-y-1/2">
        <span
          className="rounded-full border bg-muted px-3 py-0.5 text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: `hsl(${band.accentVar})`, borderColor: `hsl(${band.accentVar} / 55%)` }}
        >
          {band.label}
        </span>
      </div>
      <div className="rounded-lg border border-dashed border-border/70 bg-card/40 px-6 pb-6 pt-8">
        <div className="flex flex-wrap items-start justify-start gap-x-16 gap-y-8">
          {[...band.nodes]
            .sort((a, b) => a.col - b.col)
            .map((node) => {
              const isSoon = node.path === null;
              const isLocked = !isSoon && !isModuleAllowed(node.moduleId);
              const disabled = isSoon || isLocked;
              return (
                <WorkflowNodeTile
                  key={node.id}
                  node={node}
                  accentVar={band.accentVar}
                  disabled={disabled}
                  reason={isSoon ? "soon" : isLocked ? "locked" : undefined}
                  planName={planName}
                  registerRef={registerRef}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
