import { useState, useEffect, useMemo } from "react";
import { History, ChevronRight, FilePlus2, Pencil, DollarSign, Folder, FolderOpen } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAccountAuditHistory } from "@/hooks/useData";
import { formatDate, formatTime } from "@/lib/format";

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

const ACTION_ICONS: Record<string, typeof History> = {
  "Account Created": FilePlus2,
  "Account Updated": Pencil,
  "Opening Balance Updated": DollarSign,
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
  // Collapsed rather than expanded ids, so a newly loaded page of history
  // arrives open by default instead of silently hidden behind a chevron.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setLimit(PAGE_SIZE);
      setCollapsed(new Set());
    }
  }, [account?.id, open]);

  const { data: entries, isLoading } = useAccountAuditHistory(account?.id, limit);

  const resolveName = (id: string): string | null => {
    const acc = accountsMap?.get(id);
    if (acc) return `${acc.account_code ?? ""} ${acc.account_name ?? ""}`.trim() || null;
    const cat = categories?.find((c) => c.id === id);
    return cat?.name ?? null;
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Day → events. The query already returns newest-first, so insertion order
  // into the Map preserves that for both the days and the events inside them.
  const dayGroups = useMemo(() => {
    const groups = new Map<string, typeof entries>();
    for (const entry of entries ?? []) {
      const dayKey = String(entry.created_at).slice(0, 10);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey)!.push(entry);
    }
    return Array.from(groups.entries());
  }, [entries]);

  const allNodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const [dayKey, dayEntries] of dayGroups) {
      ids.push(dayKey);
      for (const e of dayEntries ?? []) ids.push(e.id);
    }
    return ids;
  }, [dayGroups]);

  const allCollapsed = allNodeIds.length > 0 && allNodeIds.every((id) => collapsed.has(id));

  const totalChanges = entries?.length ?? 0;
  const newest = entries?.[0];
  const oldest = entries?.[entries.length - 1];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {account ? `${account.account_code} · ${account.account_name}` : "Edit History"}
          </SheetTitle>
          <SheetDescription>
            Every change made to this account record, grouped by the day it happened.
          </SheetDescription>
        </SheetHeader>

        {/* ── Summary strip ── */}
        {!isLoading && totalChanges > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Changes</p>
              <p className="text-sm font-bold text-foreground mt-0.5 tabular-nums">{totalChanges}</p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Last Change</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{newest ? formatDate(newest.created_at) : "—"}</p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">First Change</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{oldest ? formatDate(oldest.created_at) : "—"}</p>
            </div>
          </div>
        )}

        <div className="mt-4">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
              <History className="w-6 h-6 text-muted-foreground/40" />
              No recorded history for this account yet.
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allNodeIds))}
                  className="text-[11px] text-primary hover:underline"
                >
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </button>
              </div>

              {/* ── Tree: Day → Change → Field ──
                  Each child row draws its own connector: a vertical trunk
                  descending from the parent (stopping at the elbow on the last
                  child, so the branch visibly terminates) plus a horizontal
                  elbow into the row. */}
              <ul className="space-y-1">
                {dayGroups.map(([dayKey, dayEntries]) => {
                  const dayOpen = !collapsed.has(dayKey);
                  const count = dayEntries?.length ?? 0;
                  const events = dayEntries ?? [];
                  return (
                    <li key={dayKey}>
                      {/* Level 1 — the day (tree root) */}
                      <button
                        onClick={() => toggle(dayKey)}
                        className="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded-md hover:bg-muted/50 text-left"
                      >
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${dayOpen ? "rotate-90" : ""}`}
                        />
                        {dayOpen ? (
                          <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-foreground tabular-nums">{formatDate(dayKey)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          ({count} change{count !== 1 ? "s" : ""})
                        </span>
                      </button>

                      {dayOpen && (
                        <ul className="ml-[9px]">
                          {events.map((entry, ei) => {
                            const entryOpen = !collapsed.has(entry.id);
                            const detailKeys = entry.details ? Object.keys(entry.details) : [];
                            const userName = [entry.users?.first_name, entry.users?.last_name]
                              .filter(Boolean)
                              .join(" ");
                            const Icon = ACTION_ICONS[entry.action] ?? History;
                            const isLastEvent = ei === events.length - 1;
                            return (
                              /* Level 2 — the change event */
                              <li key={entry.id} className="relative pl-4">
                                {/* trunk: full height unless this is the last branch */}
                                <span
                                  aria-hidden="true"
                                  className={`absolute left-0 top-0 w-px bg-border ${isLastEvent ? "h-[16px]" : "bottom-0"}`}
                                />
                                {/* elbow into the row */}
                                <span aria-hidden="true" className="absolute left-0 top-[16px] h-px w-3 bg-border" />

                                <button
                                  onClick={() => detailKeys.length > 0 && toggle(entry.id)}
                                  className={`w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-left ${detailKeys.length > 0 ? "hover:bg-muted/50" : "cursor-default"}`}
                                >
                                  {detailKeys.length > 0 ? (
                                    <ChevronRight
                                      className={`w-3 h-3 text-muted-foreground transition-transform shrink-0 ${entryOpen ? "rotate-90" : ""}`}
                                    />
                                  ) : (
                                    <span className="w-3 shrink-0" />
                                  )}
                                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                  <span
                                    className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 ${ACTION_COLORS[entry.action] ?? "bg-muted text-muted-foreground"}`}
                                  >
                                    {ACTION_LABELS[entry.action] ?? entry.action}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                                    {formatTime(entry.created_at)}
                                  </span>
                                  {userName && (
                                    <span className="text-[11px] text-muted-foreground truncate">by {userName}</span>
                                  )}
                                  {detailKeys.length > 0 && (
                                    <span className="text-[10px] text-muted-foreground/70 ml-auto shrink-0">
                                      {detailKeys.length} field{detailKeys.length !== 1 ? "s" : ""}
                                    </span>
                                  )}
                                </button>

                                {/* Level 3 — the individual fields changed */}
                                {entryOpen && detailKeys.length > 0 && (
                                  <ul className="ml-[9px] pb-1">
                                    {detailKeys.map((k, fi) => {
                                      const isLastField = fi === detailKeys.length - 1;
                                      return (
                                        <li
                                          key={k}
                                          className="relative pl-4"
                                          title={`${humanizeKey(k)}: ${String(entry.details?.[k] ?? "")}`}
                                        >
                                          <span
                                            aria-hidden="true"
                                            className={`absolute left-0 top-0 w-px bg-border/70 ${isLastField ? "h-[13px]" : "bottom-0"}`}
                                          />
                                          <span
                                            aria-hidden="true"
                                            className="absolute left-0 top-[13px] h-px w-3 bg-border/70"
                                          />
                                          <div className="flex items-baseline gap-1.5 px-1.5 py-1 text-xs">
                                            <span className="text-muted-foreground shrink-0">{humanizeKey(k)}</span>
                                            <span className="text-muted-foreground/50 shrink-0">→</span>
                                            <span className="text-foreground font-medium break-all">
                                              {formatValue(k, entry.details?.[k], resolveName)}
                                            </span>
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>

              {entries.length >= limit && (
                <button
                  onClick={() => setLimit((l) => l + PAGE_SIZE)}
                  className="w-full text-xs text-primary hover:underline py-2 mt-2"
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
