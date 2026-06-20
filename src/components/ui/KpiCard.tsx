import { cn } from "@/lib/utils";

export type KpiTone = "primary" | "success" | "warning" | "info" | "violet" | "rose";

/** Each tone maps to an HSL design token (or a fixed hue) used for the accent + soft wash. */
const TONES: Record<KpiTone, { from: string; to: string; fg: string; chip: string }> = {
  primary: { from: "hsl(var(--primary) / 0.16)", to: "hsl(var(--primary) / 0.04)", fg: "hsl(var(--primary))", chip: "hsl(var(--primary) / 0.15)" },
  success: { from: "hsl(var(--success) / 0.18)", to: "hsl(var(--success) / 0.04)", fg: "hsl(var(--success))", chip: "hsl(var(--success) / 0.16)" },
  warning: { from: "hsl(var(--warning) / 0.20)", to: "hsl(var(--warning) / 0.05)", fg: "hsl(var(--warning))", chip: "hsl(var(--warning) / 0.18)" },
  info:    { from: "hsl(var(--info) / 0.18)",    to: "hsl(var(--info) / 0.04)",    fg: "hsl(var(--info))",    chip: "hsl(var(--info) / 0.16)" },
  violet:  { from: "hsl(262 83% 58% / 0.16)",    to: "hsl(262 83% 58% / 0.04)",    fg: "hsl(262 83% 58%)",    chip: "hsl(262 83% 58% / 0.15)" },
  rose:    { from: "hsl(347 77% 50% / 0.16)",    to: "hsl(347 77% 50% / 0.04)",    fg: "hsl(347 77% 50%)",    chip: "hsl(347 77% 50% / 0.15)" },
};

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  icon?: React.ElementType;
  tone?: KpiTone;
  className?: string;
}

export function KpiCard({ label, value, sublabel, icon: Icon, tone = "primary", className }: KpiCardProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 p-5 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5",
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${t.from}, ${t.to})` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-foreground truncate">{value}</p>
          {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
        </div>
        {Icon && (
          <div
            className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: t.chip, color: t.fg }}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 h-1 w-full" style={{ backgroundColor: t.fg, opacity: 0.55 }} />
    </div>
  );
}
