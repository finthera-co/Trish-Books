import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, AlertTriangle, ArrowRight, X, ChevronUp, ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import {
  useFsMapping, useMapAccountToLine, useUnmapAccount, useMoveAccountToLine,
  useFsLineDetails, useUpdateFsLine, useFsLineTerms, useSetFsLineTerms,
  useFsParameters, useSetFsParameter, isFsPnlAccountType,
  type FsLineDetail, type FsUnmappedAccount,
} from "@/hooks/useFinancialStatements";

const STATEMENT_CODE = "SOCI";

function fmt(n: number): string {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < -0.005 ? `(${s})` : s;
}

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function FinancialStatementMapping() {
  // A report's coverage banner links here with ?from=&to= set to the exact
  // period it flagged issues for — arriving from that link must show the same
  // accounts the report saw, not silently re-scope to the last 12 months.
  const [searchParams] = useSearchParams();
  const linkedFrom = searchParams.get("from");
  const linkedTo = searchParams.get("to");

  const [dateFrom, setDateFrom] = useState(linkedFrom ?? defaultDateFrom);
  const [dateTo, setDateTo] = useState(linkedTo ?? (() => new Date().toISOString().slice(0, 10)));
  const [fiscalPeriodId, setFiscalPeriodId] = useState<string>("");
  const [editingLine, setEditingLine] = useState<FsLineDetail | null>(null);

  const { data: fiscalPeriods } = useFiscalPeriods();
  const { statementId, mapped, unmapped, others, isLoading, error } = useFsMapping(STATEMENT_CODE, dateFrom, dateTo);
  const { data: lineDetails } = useFsLineDetails(statementId);
  const mapAccount = useMapAccountToLine();
  const unmapAccount = useUnmapAccount();
  const moveAccount = useMoveAccountToLine();
  const updateLine = useUpdateFsLine();
  const { data: parameters } = useFsParameters(fiscalPeriodId || null);
  const setParameter = useSetFsParameter();

  const linesByLabel = useMemo(() => new Map((lineDetails ?? []).map((l) => [l.id, l])), [lineDetails]);

  const mappedByLine = useMemo(() => {
    const map = new Map<string, typeof mapped>();
    for (const m of mapped) {
      const arr = map.get(m.line_id) ?? [];
      arr.push(m);
      map.set(m.line_id, arr);
    }
    return map;
  }, [mapped]);

  // Balance-sheet accounts parked on a statement line are presentational; the
  // tie-out is a P&L coverage check and must ignore them on both sides.
  const mappedTotal = mapped
    .filter((m) => isFsPnlAccountType(m.account_type))
    .reduce((s, m) => s + m.balance, 0);
  const unmappedTotal = unmapped.reduce((s, a) => s + a.balance, 0);
  const fullTotal = mappedTotal + unmappedTotal;
  const isClean = Math.abs(unmappedTotal) < 0.005;

  const detailLines = useMemo(() => (lineDetails ?? []).filter((l) => l.line_type === "detail"), [lineDetails]);

  const [otherFilter, setOtherFilter] = useState("");
  const visibleOthers = useMemo(() => {
    const q = otherFilter.trim().toLowerCase();
    if (!q) return others;
    return others.filter((a) => `${a.account_code} ${a.account_name} ${a.account_type}`.toLowerCase().includes(q));
  }, [others, otherFilter]);

  const assign = (lineId: string, account: FsUnmappedAccount) => {
    const line = linesByLabel.get(lineId);
    mapAccount.mutate({ lineId, accountId: account.account_id, lineLabel: line?.label ?? "", accountName: account.account_name });
  };

  const weightedShares = parameters?.find((p) => p.key === "weighted_average_shares");
  const [sharesInput, setSharesInput] = useState("");
  const [sharesNote, setSharesNote] = useState("");

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Statement Mapping</h1>
          <p className="page-description">Map chart-of-accounts accounts onto statement lines. An unmapped account is visibly wrong; a wrongly-mapped one is not — check the tie-out strip.</p>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div className="min-w-[200px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Fiscal period (for EPS parameter)</label>
            <Select value={fiscalPeriodId} onValueChange={setFiscalPeriodId}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Select period" /></SelectTrigger>
              <SelectContent>
                {fiscalPeriods?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={`mt-4 flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-lg text-sm font-medium ${isClean ? "bg-success/10 text-success" : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          {isClean ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>Mapped {fmt(mappedTotal)}</span>
          <span className="opacity-50">·</span>
          <span>Unmapped {fmt(unmappedTotal)}</span>
          <span className="opacity-50">·</span>
          <span>Statement total {fmt(fullTotal)}</span>
          <span className="opacity-60 font-normal">profit &amp; loss accounts only</span>
        </div>

        {fiscalPeriodId && (
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Weighted average shares</label>
              <input type="number" placeholder={weightedShares ? String(weightedShares.value) : "e.g. 169900"} value={sharesInput}
                onChange={(e) => setSharesInput(e.target.value)}
                className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground w-40 focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Note</label>
              <input type="text" placeholder={weightedShares?.note ?? "e.g. Stated Capital 1,699,000 / 10"} value={sharesNote}
                onChange={(e) => setSharesNote(e.target.value)}
                className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <Button
              size="sm"
              disabled={!sharesInput || Number.isNaN(Number(sharesInput))}
              onClick={() => {
                setParameter.mutate({ fiscalPeriodId, key: "weighted_average_shares", value: Number(sharesInput), note: sharesNote || undefined });
                setSharesInput(""); setSharesNote("");
              }}
            >
              Save
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : error ? (
        // Never render empty panels on a failed load: "no unmapped accounts"
        // and "the query died" look identical, and one of them is a clean bill
        // of health the user would act on.
        <div className="stat-card text-center py-16">
          <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-destructive" />
          <p className="font-medium text-destructive">Could not load accounts for this period.</p>
          <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
          <p className="text-xs text-muted-foreground mt-3">The lists below would be misleading, so they are hidden. Narrow the date range and try again.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: unmapped P&L accounts, then the optional asset ledgers */}
          <div className="space-y-6">
            <div className="stat-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">Unmapped accounts ({unmapped.length})</h3>
              <div className="space-y-1.5 max-h-[45vh] overflow-y-auto">
                {unmapped.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Every account with activity is mapped.</p>
                ) : (
                  unmapped.map((a) => (
                    <AccountPickerRow key={a.account_id} account={a} lines={detailLines} onAssign={assign} />
                  ))
                )}
              </div>
            </div>

            <div className="stat-card">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h3 className="text-sm font-semibold text-foreground">Other ledgers ({others.length})</h3>
                <input
                  type="search"
                  value={otherFilter}
                  onChange={(e) => setOtherFilter(e.target.value)}
                  placeholder="Filter…"
                  className="text-xs border border-input rounded-lg px-2.5 py-1.5 bg-background w-36 focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Every asset, liability and equity account, balance or not, shown at its <strong>closing balance</strong> as at the To date. Assigning one is optional: it lands in the statement's memorandum section, below earnings per share, and changes no subtotal.
              </p>
              <div className="space-y-1.5 max-h-[45vh] overflow-y-auto">
                {visibleOthers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    {others.length === 0 ? "Every other account is already assigned to a line." : "No account matches that filter."}
                  </p>
                ) : (
                  visibleOthers.map((a) => (
                    <AccountPickerRow key={a.account_id} account={a} lines={detailLines} onAssign={assign} />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: statement lines with live subtotals */}
          <div className="stat-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">Statement lines</h3>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              {(lineDetails ?? []).map((line, idx) => {
                const accounts = mappedByLine.get(line.id) ?? [];
                const subtotal = accounts.reduce((s, a) => s + a.balance, 0);
                return (
                  <div key={line.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex flex-col">
                          <button disabled={idx === 0} onClick={() => {
                            const prev = lineDetails![idx - 1];
                            updateLine.mutate({ lineId: line.id, patch: { sort_order: prev.sort_order } });
                            updateLine.mutate({ lineId: prev.id, patch: { sort_order: line.sort_order } });
                          }} className="disabled:opacity-20 hover:text-primary"><ChevronUp className="w-3.5 h-3.5" /></button>
                          <button disabled={idx === (lineDetails?.length ?? 0) - 1} onClick={() => {
                            const next = lineDetails![idx + 1];
                            updateLine.mutate({ lineId: line.id, patch: { sort_order: next.sort_order } });
                            updateLine.mutate({ lineId: next.id, patch: { sort_order: line.sort_order } });
                          }} className="disabled:opacity-20 hover:text-primary"><ChevronDown className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{line.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {line.line_type}{line.note_ref ? ` · Note ${line.note_ref}` : ""}{line.line_type === "detail" ? ` · ${accounts.length} account${accounts.length !== 1 ? "s" : ""}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {line.line_type === "detail" && <span className="font-mono text-sm tabular-nums">{fmt(subtotal)}</span>}
                        <button onClick={() => setEditingLine(line)} className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground">
                          <Settings2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {line.line_type === "detail" && accounts.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                        {accounts.map((a) => (
                          <div key={a.fs_line_account_id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate text-foreground">{a.account_code} · {a.account_name}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">{fmt(a.balance)}</span>
                            <Select onValueChange={(toLineId) => {
                              const toLine = linesByLabel.get(toLineId);
                              moveAccount.mutate({ fsLineAccountId: a.fs_line_account_id, toLineId, fromLabel: line.label, toLabel: toLine?.label ?? "", accountName: a.account_name });
                            }}>
                              <SelectTrigger className="w-24 h-6 text-[10px]"><SelectValue placeholder="Move…" /></SelectTrigger>
                              <SelectContent>
                                {(lineDetails ?? []).filter((l) => l.line_type === "detail" && l.id !== line.id).map((l) => (
                                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              onClick={() => unmapAccount.mutate({ fsLineAccountId: a.fs_line_account_id, lineLabel: line.label, accountName: a.account_name })}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {editingLine && (
        <LineEditorDialog line={editingLine} allLines={lineDetails ?? []} onClose={() => setEditingLine(null)} />
      )}
    </div>
  );
}

function AccountPickerRow({
  account, lines, onAssign,
}: {
  account: FsUnmappedAccount;
  lines: FsLineDetail[];
  onAssign: (lineId: string, account: FsUnmappedAccount) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted/20">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
          <span className="text-sm font-medium text-foreground truncate">{account.account_name}</span>
        </div>
        <p className="text-xs text-muted-foreground">{account.account_type}</p>
      </div>
      <span className="font-mono text-sm tabular-nums">{fmt(account.balance)}</span>
      <Select onValueChange={(lineId) => onAssign(lineId, account)}>
        <SelectTrigger className="w-32 text-xs"><SelectValue placeholder="Assign to…" /></SelectTrigger>
        <SelectContent>
          {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function LineEditorDialog({ line, allLines, onClose }: { line: FsLineDetail; allLines: FsLineDetail[]; onClose: () => void }) {
  const updateLine = useUpdateFsLine();
  const { data: terms } = useFsLineTerms(line.id);
  const setTerms = useSetFsLineTerms();

  const [label, setLabel] = useState(line.label);
  const [noteRef, setNoteRef] = useState(line.note_ref ?? "");
  const [emphasis, setEmphasis] = useState(line.emphasis);
  const [showMargin, setShowMargin] = useState(line.show_margin);
  const [isMarginBase, setIsMarginBase] = useState(line.is_margin_base);
  const [valueBasis, setValueBasis] = useState<"period" | "cumulative">(line.value_basis ?? "period");

  const termFactors = useMemo(() => {
    const map = new Map<string, 1 | -1>();
    for (const t of terms ?? []) map.set(t.term_line_id, t.factor);
    return map;
  }, [terms]);

  const [pendingFactors, setPendingFactors] = useState<Map<string, 1 | -1 | 0> | null>(null);
  const factors = pendingFactors ?? new Map(Array.from(termFactors.entries()));

  const cycleFactor = (lineId: string) => {
    const next = new Map(factors);
    const cur = next.get(lineId) ?? 0;
    next.set(lineId, cur === 0 ? 1 : cur === 1 ? -1 : 0);
    setPendingFactors(next);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{line.label}</DialogTitle>
          <DialogDescription>Line code {line.line_code} · {line.line_type}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Note ref</label>
              <input value={noteRef} onChange={(e) => setNoteRef(e.target.value)} className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Emphasis</label>
              <select value={emphasis} onChange={(e) => setEmphasis(e.target.value)}
                className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background">
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="bold_rule">Bold + rule</option>
                <option value="total_rule">Bold + double rule</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showMargin} onChange={(e) => setShowMargin(e.target.checked)} /> Show margin %</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={isMarginBase} onChange={(e) => setIsMarginBase(e.target.checked)} /> Is margin base</label>
          </div>

          {line.line_type === "detail" && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Basis</label>
              <select value={valueBasis} onChange={(e) => setValueBasis(e.target.value as "period" | "cumulative")}
                className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background">
                <option value="period">Period movement — income and expense</option>
                <option value="cumulative">Closing balance — asset, liability, equity</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Closing balance matches the Trial Balance's Closing column. A line that feeds profit for the year cannot use it — the database refuses, because a balance is not an earning.
              </p>
            </div>
          )}

          {line.line_type === "computed" && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Formula (click to cycle: off → + → − → off)</label>
              <div className="flex flex-wrap gap-1.5">
                {allLines.filter((l) => l.id !== line.id).map((l) => {
                  const f = factors.get(l.id) ?? 0;
                  return (
                    <button key={l.id} onClick={() => cycleFactor(l.id)}
                      className={`px-2 py-1 rounded text-xs font-medium border ${
                        f === 1 ? "bg-success/10 border-success/40 text-success" :
                        f === -1 ? "bg-destructive/10 border-destructive/40 text-destructive" :
                        "bg-muted/30 border-border text-muted-foreground"
                      }`}
                    >
                      {f === 1 ? "+ " : f === -1 ? "− " : ""}{l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => {
              updateLine.mutate({
                lineId: line.id,
                patch: {
                  label, note_ref: noteRef || null, emphasis,
                  show_margin: showMargin, is_margin_base: isMarginBase,
                  ...(line.line_type === "detail" ? { value_basis: valueBasis } : {}),
                },
              });
              if (line.line_type === "computed" && pendingFactors) {
                const termsToSave = Array.from(pendingFactors.entries())
                  .filter(([, f]) => f !== 0)
                  .map(([termLineId, factor]) => ({ termLineId, factor: factor as 1 | -1 }));
                setTerms.mutate({ lineId: line.id, terms: termsToSave });
              }
              onClose();
            }}
          >
            <ArrowRight className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
