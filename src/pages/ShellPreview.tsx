import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, LayoutGrid, Layers, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useShellV2, setShellV2 } from "@/lib/shellFlag";
import { MODULE_CONFIGS } from "@/config/modules";
import { useAuth } from "@/contexts/AuthContext";
import { railModulesFor } from "@/components/layout/NavRail";

/**
 * Design preview for the shell v2 navigation.
 * Toggling the switch swaps the real app shell — browse any module to review it.
 */
export default function ShellPreview() {
  const on = useShellV2();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const modules = railModulesFor(isSuperAdmin);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 space-y-8 overflow-y-auto">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Design preview
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Navigation shell v2</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Turn this on and browse the app normally — every module page renders with the new
          shell. Turn it off to go back. Nothing else in the app changes.
        </p>
      </div>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div className="space-y-1">
          <Label htmlFor="shell-v2" className="text-sm font-semibold">
            Use the new navigation shell
          </Label>
          <p className="text-xs text-muted-foreground">
            Stored locally in this browser only.
          </p>
        </div>
        <Switch id="shell-v2" checked={on} onCheckedChange={setShellV2} />
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">What changes</h2>
        <ChangeRow
          icon={LayoutGrid}
          title="A persistent module rail"
          body="Every module sits in a 56px rail on the left, so switching from Accounting to Sales is one click. Today it takes three — back to Home, pick a card, pick a page."
        />
        <ChangeRow
          icon={Layers}
          title="Grouped module menus"
          body={`Accounting's ${MODULE_CONFIGS.accounting.sidebarItems.length} links are split into General Ledger, Receivables, Payables, Cash & FX and Period Control. Banking, Sales, Payroll, Reports, Assets and Settings are grouped too.`}
        />
        <ChangeRow
          icon={Palette}
          title="Neutral surfaces, green as accent"
          body="The navy sidebar becomes a neutral surface that matches the rest of the app. Green is now reserved for the active page and primary actions, so it actually signals something."
        />
        <ChangeRow
          icon={Check}
          title="Breadcrumb folded into the header"
          body="The separate breadcrumb strip and the mobile nav row merge into one 48px header, giving pages back vertical space. Mobile gets a full nav drawer instead of a horizontal scroller."
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Jump into a module to review it</h2>
        <div className="flex flex-wrap gap-2">
          {modules.map((mod) => (
            <Button
              key={mod.id}
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate(mod.basePath)}
            >
              <mod.icon className="h-3.5 w-3.5" />
              {mod.label}
              <ArrowRight className="h-3 w-3 opacity-50" />
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Check both light and dark mode — the new surfaces are defined for both.
        </p>
      </div>
    </div>
  );
}

function ChangeRow({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-card p-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
