import { useState, useEffect, Fragment } from "react";
import { History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useCheckAuditHistory } from "@/hooks/useData";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  "Check Created": "Check Created",
  "Check Voided": "Check Voided",
};

const ACTION_COLORS: Record<string, string> = {
  "Check Created": "bg-success/10 text-success",
  "Check Voided": "bg-destructive/10 text-destructive",
};

function humanizeKey(key: string): string {
  return key
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

interface Props {
  voucherId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CheckAuditHistorySheet({ voucherId, open, onOpenChange }: Props) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    if (open) setLimit(PAGE_SIZE);
  }, [voucherId, open]);

  const { data: entries, isLoading } = useCheckAuditHistory(voucherId ?? undefined, limit);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Audit History</SheetTitle>
          <SheetDescription>Changes made to this check.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
              <History className="w-6 h-6 text-muted-foreground/40" />
              No recorded history for this check yet.
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {entries.map((entry) => {
                  const detailKeys = entry.details ? Object.keys(entry.details) : [];
                  const userName = [entry.users?.first_name, entry.users?.last_name].filter(Boolean).join(" ");
                  return (
                    <li key={entry.id} className="border border-border rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${ACTION_COLORS[entry.action] ?? "bg-muted text-muted-foreground"}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{formatDateTime(entry.created_at)}</span>
                      </div>
                      {userName && <p className="text-[11px] text-muted-foreground mt-1">by {userName}</p>}
                      {detailKeys.length > 0 && (
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                          {detailKeys.map((k) => (
                            <Fragment key={k}>
                              <dt className="text-muted-foreground">{humanizeKey(k)}:</dt>
                              <dd className="text-foreground truncate" title={String(entry.details?.[k] ?? "")}>
                                {formatValue(entry.details?.[k])}
                              </dd>
                            </Fragment>
                          ))}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>
              {entries.length >= limit && (
                <button
                  onClick={() => setLimit((l) => l + PAGE_SIZE)}
                  className="w-full text-xs text-primary hover:underline py-2"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
