import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import WorkflowChip from "./WorkflowChip";
import { useWorkflowHover } from "./WorkflowHoverContext";
import type { WorkflowNode } from "@/config/workflow";

interface Props {
  node: WorkflowNode;
  accentVar: string;
  disabled: boolean;
  reason?: "locked" | "soon";
  planName?: string | null;
  registerRef: (id: string, el: HTMLElement | null) => void;
}

export default function WorkflowNodeTile({ node, accentVar, disabled, reason, planName, registerRef }: Props) {
  const { setHoveredId, isNodeActive } = useWorkflowHover();
  const dimmed = !disabled && !isNodeActive(node.id);
  const hoverHandlers = {
    onMouseEnter: () => setHoveredId(node.id),
    onMouseLeave: () => setHoveredId(null),
  };

  // registerRef targets the chip itself, not the tile wrapper below — the
  // connector layer anchors to the icon's actual box, not to a bounding box
  // stretched by the label text underneath it.
  const content = (
    <div className="flex flex-col items-center gap-1.5">
      <WorkflowChip
        ref={(el) => registerRef(node.id, el)}
        icon={node.icon}
        accentVar={accentVar}
        size="md"
        emphasis={node.emphasis}
        disabled={disabled}
        reason={reason}
      />
      <span className="max-w-[88px] text-center text-xs font-medium leading-tight text-foreground">
        {node.label}
      </span>
    </div>
  );

  const wrapperClassName = cn(
    "inline-flex flex-col items-center rounded-md p-1 transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
    dimmed && "opacity-30",
  );

  const inner = disabled ? (
    <div role="button" aria-disabled="true" className={wrapperClassName} {...hoverHandlers}>
      {content}
    </div>
  ) : (
    <Link to={node.path!} className={wrapperClassName} {...hoverHandlers}>
      {content}
    </Link>
  );

  if (reason === "locked") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent>Not included in your {planName || "current"} plan</TooltipContent>
      </Tooltip>
    );
  }

  return inner;
}
