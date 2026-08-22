import { forwardRef } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  accentVar: string; // bare CSS var ref, e.g. "var(--warning)"
  size?: "sm" | "md";
  emphasis?: boolean;
  disabled?: boolean;
  reason?: "locked" | "soon";
}

const SIZE_CLASSES: Record<"sm" | "md", { chip: string; icon: string }> = {
  sm: { chip: "size-9", icon: "size-4" },
  md: { chip: "size-11", icon: "size-5" },
};

// Forwards a ref to the chip itself (not the icon+label stack around it) so
// the connector layer can anchor lines to the visual icon, not to the wider,
// taller bounding box of the tile that contains its label text too.
const WorkflowChip = forwardRef<HTMLDivElement, Props>(function WorkflowChip(
  { icon: Icon, accentVar, size = "md", emphasis, disabled, reason },
  ref,
) {
  const solid = `hsl(${accentVar})`;
  const tinted = `hsl(${accentVar} / 20%)`;
  const ringTint = `hsl(${accentVar} / 45%)`;
  const emphasised = !!emphasis && !disabled;
  const { chip, icon } = SIZE_CLASSES[size];

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex items-center justify-center rounded-md transition-all",
        chip,
        !disabled && "hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        emphasised && "ring-2 ring-offset-2",
      )}
      style={{
        backgroundColor: emphasised ? solid : tinted,
        ["--tw-ring-color" as string]: emphasised ? ringTint : undefined,
      }}
    >
      <Icon
        className={icon}
        style={{
          color: emphasised ? "hsl(var(--primary-foreground))" : solid,
          filter: emphasised ? undefined : "brightness(0.42) saturate(1.2)",
        }}
      />
      {reason === "soon" && (
        <span className="absolute -top-1 -right-1 rounded-full bg-muted px-1 py-px text-[10px] font-medium leading-none text-muted-foreground shadow-sm">
          Soon
        </span>
      )}
      {reason === "locked" && (
        <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-muted shadow-sm">
          <Lock className="size-2.5 text-muted-foreground" />
        </span>
      )}
    </div>
  );
});

export default WorkflowChip;
