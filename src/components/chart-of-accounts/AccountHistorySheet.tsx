import { useState, useEffect, Fragment } from "react";
import { History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAccountAuditHistory } from "@/hooks/useData";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  "Account Created": "Account Created",
  "Account Updated": "Account Updated",
  "Opening Balance Updated": "Opening Balance Updated",
};

const ACTION_COLORS: Record<string, string> = {
  "Account Created": "bg-success/10 text-success",
  "Account Updated": "bg-info/10 text-info",
  "Opening Balance Updated": "bg-warning/10 text-warning",
};

/** "parent_account_id" -> "Parent Account" */
function humanizeKey(key: string): string {
  return key
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(key: string, value: unknown, resolveName: (id: string) => string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key.endsWith("_id") && typeof value === "string") {
    return resolveName(value) ?? `${value.slice(0, 8)}…`;
  }
  return String(value);
}

interface AccountHistorySheetProps {
  account: { id: string; account_code: string; account_name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Used to resolve *_id detail fields (e.g. parent_account_id) to a readable name instead of a raw UUID. */
  accountsMap?: Map<string, { account_code?: string; account_name?: string }>;
  categories?: { id: string; name: string }[];
}

/** Audit trail for changes to the account RECORD itself — not transactions posted to it (see AccountTransactionsSheet). */
export default function AccountHistorySheet({
  account, open, onOpenChange, accountsMap, categories,
}: AccountHistorySheetProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    if (open) setLimit(PAGE_SIZE);
  }, [account?.id, open]);

  const { data: entries, isLoading } = useAccountAuditHistory(account?.id, limit);

  const resolveName = (id: string): string | null => {
    const acc = accountsMap?.get(id);
    if (acc) return `${acc.account_code ?? ""} ${acc.account_name ?? ""}`.trim() || null;
    const cat = categories?.find((c) => c.id === id);
    return cat?.name ?? null;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {account ? `${account.account_code} · ${account.account_name}` : "Account History"}
          </SheetTitle>
          <SheetDescription>Changes made to this account record.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
              <History className="w-6 h-6 text-muted-foreground/40" />
              No recorded history for this account yet.
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
                                {formatValue(k, entry.details?.[k], resolveName)}
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
