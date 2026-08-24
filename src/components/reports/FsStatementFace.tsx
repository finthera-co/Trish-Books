import { useState, useMemo, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { formatDateTime } from "@/lib/format";
import { Download, FileText, FileSpreadsheet, Printer, AlertTriangle, XCircle, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import {
  useFsStatement, useFsCoverage, useFsStatementMeta, useFsStatementAccounts,
  useSeedFsStatement, type FsStatementAccount,
} from "@/hooks/useFinancialStatements";
import { ReportMasthead, formatReportDate, useReportCompany } from "@/components/reports/ReportMasthead";
import { exportSociCsv, exportSociPdf } from "@/lib/fsStatementExport";
import { downloadSociWorkbook } from "@/lib/fsStatementWorkbook";
import { fmtStatement, fmtEps, fmtMargin, rowClasses } from "@/lib/fsStatementModel";

type ExportAction = "csv" | "xlsx" | "pdf" | "print";

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface FsStatementFaceProps {
  statementCode: string;
  fallbackTitle: string;
  subtitle: string;
  /** True for a point-in-time statement (Balance Sheet: "As at" one date) —
   * swaps the From/To range pickers for a single date, and calls the RPCs
   * with p_date_from = p_date_to since a cumulative line only reads date_to. */
  pointInTime?: boolean;
}

/** The shared rendering shell for every fs_lines-engine statement (SOCI, SFP,
 * CF today). Table, coverage banners, export wiring, collapse/expand, and the
 * "not set up yet" empty state are identical across statements — only the
 * statement code, title/subtitle, and date-range vs point-in-time period
 * picker differ, which is what the props above carry. */
export default function FsStatementFace({ statementCode, fallbackTitle, subtitle, pointInTime = false }: FsStatementFaceProps) {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const { data: fiscalPeriods } = useFiscalPeriods();
  const seedStatement = useSeedFsStatement();

  const [asAt, setAsAt] = useState(today);
  const [cmpAsAt, setCmpAsAt] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(today);
  const [periodPreset, setPeriodPreset] = useState("custom");
  const [cmpDateFrom, setCmpDateFrom] = useState<string | null>(null);
  const [cmpDateTo, setCmpDateTo] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const [pendingAction, setPendingAction] = useState<ExportAction | null>(null);

  // Point-in-time: p_date_from only bounds 'period'-basis lines (none on a
  // pure balance sheet) — a 'cumulative' line ignores it and reads as at
  // p_date_to regardless, so date_from = date_to is a safe, correct choice.
  const effectiveDateFrom = pointInTime ? asAt : dateFrom;
  const effectiveDateTo = pointInTime ? asAt : dateTo;
  const effectiveCmpFrom = pointInTime ? cmpAsAt : cmpDateFrom;
  const effectiveCmpTo = pointInTime ? cmpAsAt : cmpDateTo;

  const { data: company } = useReportCompany();
  const { data: meta, isLoading: metaLoading } = useFsStatementMeta(statementCode);
  // rpc_fs_statement/coverage/statement_accounts all raise an exception when
  // the statement code has no fs_statements row for this tenant yet — that's
  // the normal "not set up" case, not an error worth a failed network call
  // and a console entry for. Hold off calling them (empty statementCode ->
  // each hook's own `enabled` goes false) until the meta query has confirmed
  // the statement actually exists.
  const queryCode = !metaLoading && meta ? statementCode : "";
  const { data: lines, isLoading, error } = useFsStatement(queryCode, effectiveDateFrom, effectiveDateTo, effectiveCmpFrom, effectiveCmpTo);
  const { data: coverage } = useFsCoverage(queryCode, effectiveDateFrom, effectiveDateTo);
  const { data: lineAccounts } = useFsStatementAccounts(queryCode, effectiveDateFrom, effectiveDateTo, effectiveCmpFrom, effectiveCmpTo);

  const accountsByLine = useMemo(() => {
    const map = new Map<string, FsStatementAccount[]>();
    for (const a of lineAccounts ?? []) {
      const arr = map.get(a.line_id) ?? [];
      arr.push(a);
      map.set(a.line_id, arr);
    }
    return map;
  }, [lineAccounts]);

  const colCount = effectiveCmpTo ? 6 : 4;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allCollapsed = (lines ?? []).every((l) => accountsByLine.get(l.line_id)?.length ? collapsed.has(l.line_id) : true);
  const toggleLine = (lineId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      return next;
    });
  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(accountsByLine.keys()));

  const errors = useMemo(() => (coverage ?? []).filter((c) => c.severity === "error"), [coverage]);
  const warnings = useMemo(() => (coverage ?? []).filter((c) => c.severity === "warning"), [coverage]);
  const unmapped = useMemo(() => errors.filter((c) => c.issue_code === "UNMAPPED_ACCOUNT"), [errors]);
  const unmappedTotal = useMemo(() => unmapped.reduce((s, c) => s + Math.abs(c.amount ?? 0), 0), [unmapped]);
  const otherErrors = useMemo(() => errors.filter((c) => c.issue_code !== "UNMAPPED_ACCOUNT"), [errors]);

  const issueFingerprint = errors.map((e) => `${e.issue_code}:${e.account_id ?? ""}:${e.amount ?? ""}`).sort().join("|");
  useEffect(() => setAcked(false), [issueFingerprint]);

  const onPeriodPresetChange = (val: string) => {
    setPeriodPreset(val);
    if (val === "custom") return;
    const period = fiscalPeriods?.find((p: any) => p.id === val);
    if (period) {
      setDateFrom(period.period_start);
      setDateTo(period.period_end);
    }
  };

  const runExport = (action: ExportAction) => {
    if (errors.length > 0 && !acked) {
      setPendingAction(action);
      return;
    }
    execute(action);
  };

  const execute = (action: ExportAction) => {
    if (!lines) return;
    const ackNote = errors.length > 0 ? `Exported with ${errors.length} unresolved coverage error(s), acknowledged by ${appUser?.first_name ?? "user"} on ${formatDateTime(new Date())}` : undefined;
    const exportMeta = {
      tenantId: appUser?.tenant_id ?? "",
      userId: appUser?.id,
      statementCode,
      title: meta?.title ?? fallbackTitle,
      periodCaption: meta?.period_caption,
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
      cmpDateFrom: effectiveCmpFrom,
      cmpDateTo: effectiveCmpTo,
      currencyCaption: meta?.currency_caption,
      company: {
        companyName: company?.company_name,
        address: company?.address,
        phone: company?.phone,
        taxId: company?.tax_id,
        registrationNumber: company?.registration_number,
      },
      preparedBy: [appUser?.first_name, appUser?.last_name].filter(Boolean).join(" "),
      warnings: (coverage ?? []).map((c) => `[${c.severity.toUpperCase()}] ${c.issue_code}: ${c.detail}`),
      ackNote,
      footerNotes: meta?.footer_notes ?? [],
    };
    if (action === "csv") {
      exportSociCsv(lines, exportMeta, accountsByLine);
    } else if (action === "xlsx") {
      downloadSociWorkbook({ lines, meta: exportMeta, accounts: accountsByLine });
    } else if (action === "pdf") {
      exportSociPdf(lines, exportMeta, accountsByLine);
    } else {
      window.print();
    }
  };

  const confirmAck = () => {
    setAcked(true);
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      execute(action);
    }
  };

  const notSeeded = !metaLoading && !meta;

  return (
    <div className="space-y-4">
      <div className="stat-card print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          {pointInTime ? (
            <>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">As at</label>
                <input type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)}
                  className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Comparative as at</label>
                <input type="date" value={cmpAsAt ?? ""} onChange={(e) => setCmpAsAt(e.target.value || null)}
                  className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">From</label>
                <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPeriodPreset("custom"); }}
                  className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">To</label>
                <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPeriodPreset("custom"); }}
                  className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Comparative From</label>
                <input type="date" value={cmpDateFrom ?? ""} onChange={(e) => setCmpDateFrom(e.target.value || null)}
                  className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Comparative To</label>
                <input type="date" value={cmpDateTo ?? ""} onChange={(e) => setCmpDateTo(e.target.value || null)}
                  className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div className="min-w-[160px]">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period preset</label>
                <select value={periodPreset} onChange={(e) => onPeriodPresetChange(e.target.value)}
                  className="w-full text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                  <option value="custom">Custom range</option>
                  {fiscalPeriods?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={toggleAll} disabled={accountsByLine.size === 0}>
              {allCollapsed ? <ChevronRight className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
              {allCollapsed ? "Expand all" : "Collapse all"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => runExport("csv")} disabled={!lines?.length}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => runExport("xlsx")} disabled={!lines?.length}>
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => runExport("pdf")} disabled={!lines?.length}>
              <FileText className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => runExport("print")}>
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </div>

      {unmapped.length > 0 && (
        <div className="print:hidden rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-3">
          <XCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong>{unmapped.length} account{unmapped.length !== 1 ? "s" : ""} with activity are not mapped to any line</strong> — LKR{" "}
            {unmappedTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} excluded from this statement.
            <div className="mt-1 text-xs opacity-80">{unmapped.map((u) => u.account_name).join(", ")}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0 border-red-300 text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
            onClick={() => navigate(`/accounting/statement-mapping?statement=${statementCode}&from=${effectiveDateFrom}&to=${effectiveDateTo}`)}
          >
            Map these accounts
          </Button>
        </div>
      )}
      {otherErrors.map((e) => (
        <div key={`${e.issue_code}-${e.detail}`} className="print:hidden rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-3">
          <XCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
          <div>{e.detail}{e.amount != null ? ` (LKR ${Math.abs(e.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.amount > 0 ? "over" : "under"})` : ""}</div>
        </div>
      ))}
      {warnings.length > 0 && (
        <div className="print:hidden rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
          <div>{warnings.map((w) => w.detail).join(" · ")}</div>
        </div>
      )}

      <div className="stat-card print:shadow-none">
        <ReportMasthead
          title={meta?.title ?? fallbackTitle}
          subtitle={subtitle}
          periodCaption={pointInTime
            ? `${meta?.period_caption ?? "As At"} ${new Date(effectiveDateTo).getFullYear()}`
            : `${meta?.period_caption ?? "For the Year Ended 31st March"} ${new Date(effectiveDateTo).getFullYear()}`}
          currency="LKR"
          scope={[
            pointInTime
              ? { label: "As at", value: formatReportDate(effectiveDateTo) }
              : { label: "Reporting period", value: `${formatReportDate(effectiveDateFrom)} to ${formatReportDate(effectiveDateTo)}` },
            effectiveCmpTo
              ? { label: "Comparative", value: pointInTime ? formatReportDate(effectiveCmpTo) : `${formatReportDate(effectiveCmpFrom!)} to ${formatReportDate(effectiveCmpTo)}` }
              : null,
          ]}
          note={
            errors.length > 0
              ? `${errors.length} unresolved coverage issue${errors.length !== 1 ? "s" : ""} — see the notices above.`
              : null
          }
        />

        {isLoading || metaLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : notSeeded ? (
          <div className="text-center py-16 text-muted-foreground print:hidden">
            <p>This statement hasn't been set up for this tenant yet.</p>
            <p className="text-xs mt-1">Setting it up creates the standard line structure — every line can be renamed, reordered or remapped afterwards.</p>
            <Button className="mt-4" size="sm" disabled={seedStatement.isPending} onClick={() => seedStatement.mutate(statementCode)}>
              Set up this statement
            </Button>
          </div>
        ) : error ? (
          <div className="text-center py-16 text-destructive">
            <p className="font-medium">Failed to load the statement.</p>
            <p className="text-sm mt-1">{(error as Error).message}</p>
          </div>
        ) : !lines?.length ? (
          <div className="text-center py-16 text-muted-foreground">No statement lines defined yet.</div>
        ) : (
          <table className="w-full text-sm max-w-3xl mx-auto report-table">
            <thead>
              <tr className="border-b-2 border-foreground/30">
                <th scope="col" className="text-left py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground"></th>
                <th scope="col" className="w-10 text-center py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Note</th>
                <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-36">
                  {new Date(effectiveDateTo).getFullYear()}
                </th>
                {effectiveCmpTo && (
                  <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-36">
                    {new Date(effectiveCmpTo).getFullYear()}
                  </th>
                )}
                <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-16">%</th>
                {effectiveCmpTo && <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-16">%</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                if (l.line_type === "spacer") return <tr key={l.line_id}><td colSpan={colCount} className="py-1"></td></tr>;
                const isEps = l.line_type === "per_share";
                const kids = accountsByLine.get(l.line_id) ?? [];
                const isOpen = kids.length > 0 && !collapsed.has(l.line_id);
                return (
                  <Fragment key={l.line_id}>
                    <tr className={rowClasses(l.emphasis)}>
                      <td className="py-1.5 pr-2 text-foreground">
                        {kids.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleLine(l.line_id)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} the ${kids.length} ledger${kids.length !== 1 ? "s" : ""} behind ${l.label}`}
                            className="inline-flex items-center gap-1 text-left hover:text-primary print:pointer-events-none"
                          >
                            {isOpen
                              ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-60 print:hidden" />
                              : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-60 print:hidden" />}
                            <span>{l.label}</span>
                          </button>
                        ) : l.label}
                      </td>
                      <td className="py-1.5 text-center font-mono text-xs text-muted-foreground">{l.note_ref ?? ""}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {isEps ? fmtEps(l.current_value) : fmtStatement(l.current_value, l.line_type === "detail")}
                      </td>
                      {effectiveCmpTo && (
                        <td className="py-1.5 text-right font-mono tabular-nums">
                          {isEps ? fmtEps(l.compare_value) : fmtStatement(l.compare_value, l.line_type === "detail")}
                        </td>
                      )}
                      <td className="py-1.5 text-right font-mono tabular-nums text-xs">{l.show_margin ? fmtMargin(l.current_margin) : ""}</td>
                      {effectiveCmpTo && <td className="py-1.5 text-right font-mono tabular-nums text-xs">{l.show_margin ? fmtMargin(l.compare_margin) : ""}</td>}
                    </tr>
                    {isOpen && kids.map((a) => (
                      <tr key={a.account_id} className="text-xs text-muted-foreground">
                        <td className="py-1 pr-2 pl-6" style={{ paddingLeft: `${1.5 + a.depth * 0.75}rem` }}>
                          <span className="inline-block w-3 border-t border-border/60 align-middle mr-2" />
                          <span className="font-mono">{a.account_code}</span>
                          <span className="ml-2">{a.account_name}</span>
                        </td>
                        <td></td>
                        <td className="py-1 text-right font-mono tabular-nums">{fmtStatement(a.current_value, false)}</td>
                        {effectiveCmpTo && <td className="py-1 text-right font-mono tabular-nums">{fmtStatement(a.compare_value, false)}</td>}
                        <td></td>
                        {effectiveCmpTo && <td></td>}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground space-y-0.5 max-w-3xl mx-auto">
          {(meta?.footer_notes ?? []).map((n, i) => <p key={i}>{n}</p>)}
        </div>
      </div>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unresolved coverage issues</AlertDialogTitle>
            <AlertDialogDescription>
              This statement has {errors.length} unresolved coverage error{errors.length !== 1 ? "s" : ""} (unmapped accounts, a tie-out
              variance, or a formula cycle). Exporting or printing now will carry a note of this acknowledgement in the document footer.
              Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAck}>Acknowledge and proceed</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
