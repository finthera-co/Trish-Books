import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, CheckCircle2, AlertCircle } from "lucide-react";

type TraceEntry = Record<string, any> & { factor: string; points?: number };

interface Props {
  matchType?: string | null;
  matchConfidence?: number | null;
  metadata?: Record<string, any> | null;
}

const TIER_LABELS: Record<string, string> = {
  SOURCE: "Exact Source Match",
  AP_AUTO: "AP Vendor Auto-Match",
  AP_SUGGEST: "AP Vendor Suggestion",
  RULE: "Rule + Ledger Match",
  RULE_ONLY: "Rule (no ledger candidate)",
  RULE_AUTO: "Rule Auto-posted",
  SCORING: "Heuristic Scoring",
  COMPOSITE: "Composite (multi-line)",
};

const TIER_TONES: Record<string, string> = {
  SOURCE: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  AP_AUTO: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  AP_SUGGEST: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  RULE: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900",
  RULE_ONLY: "bg-amber-100 text-amber-700 border-amber-200",
  RULE_AUTO: "bg-purple-100 text-purple-700 border-purple-200",
  SCORING: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  COMPOSITE: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
};

function formatFactor(t: TraceEntry): { label: string; detail: string } {
  switch (t.factor) {
    case "reference_number":
      return { label: "Reference number", detail: `bank "${t.bank}" ↔ ledger "${t.ledger}"` };
    case "amount":
      return { label: "Amount", detail: `bank ${t.bank} ↔ ledger ${t.ledger}` };
    case "amount_sum":
      return { label: "Amount sum", detail: `bank ${t.bank} ↔ Σ ledger ${t.ledger_sum}` };
    case "date_distance":
      return { label: "Date distance", detail: `${t.days} day${t.days === 1 ? "" : "s"}` };
    case "description_similarity":
      return { label: "Description similarity", detail: `Jaccard ${t.similarity}` };
    case "vendor_name_similarity":
      return { label: "Vendor name similarity", detail: `${t.vendor} (${t.similarity})` };
    case "bill_no":
      return { label: "Bill number", detail: `${t.value} found in ${t.found_in}` };
    case "ap_payment_amount":
      return { label: "AP payment amount", detail: `bank ${t.bank} ↔ ledger ${t.ledger}` };
    case "user_rule":
      return { label: `Rule: ${t.rule_name}`, detail: t.condition };
    case "components":
      return { label: "Components", detail: `${t.count} ledger lines` };
    case "account_present":
      return { label: "Account linked", detail: "ledger line has account_id" };
    default:
      return { label: t.factor, detail: JSON.stringify(t) };
  }
}

export default function MatchExplanation({ matchType, matchConfidence, metadata }: Props) {
  if (!matchType) return null;
  const tier = (metadata?.tier as string) || matchType;
  const tierLabel = TIER_LABELS[tier] || tier;
  const tone = TIER_TONES[tier] || "bg-muted text-foreground border-border";
  const reason = metadata?.tier_reason as string | undefined;
  const trace = (metadata?.trace as TraceEntry[]) || [];
  const totalPoints = trace.reduce((s, t) => s + (Number(t.points) || 0), 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          aria-label="Why did this match?"
        >
          <Info className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-80 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 border-b">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className={`text-[10px] font-medium ${tone}`}>
              {tierLabel}
            </Badge>
            {typeof matchConfidence === "number" && (
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {matchConfidence}%
              </span>
            )}
          </div>
          {reason && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{reason}</p>
          )}
        </div>

        <div className="px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            <span>Contributing factors</span>
            {totalPoints > 0 && <span>Σ {totalPoints} pts</span>}
          </div>
          {trace.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
              <AlertCircle className="w-3 h-3" />
              No detailed trace available (legacy match).
            </div>
          ) : (
            <div className="space-y-1">
              {trace.map((t, i) => {
                const f = formatFactor(t);
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground truncate">{f.label}</span>
                        {typeof t.points === "number" && (
                          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                            +{t.points}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{f.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {(metadata?.rule_name || metadata?.vendor_name || metadata?.ledger_reference) && (
          <div className="px-3 py-2 border-t bg-muted/30 space-y-0.5 text-[11px]">
            {metadata?.rule_name && (
              <div><span className="text-muted-foreground">Rule:</span> <span className="font-medium">{metadata.rule_name}</span></div>
            )}
            {metadata?.vendor_name && (
              <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{metadata.vendor_name}</span></div>
            )}
            {metadata?.bill_no && (
              <div><span className="text-muted-foreground">Bill #:</span> <span className="font-medium">{metadata.bill_no}</span></div>
            )}
            {metadata?.ledger_reference && (
              <div><span className="text-muted-foreground">Ledger ref:</span> <span className="font-medium">{metadata.ledger_reference}</span></div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
