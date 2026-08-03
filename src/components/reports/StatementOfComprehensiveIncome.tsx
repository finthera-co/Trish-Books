import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format as formatDate } from "date-fns";
import { Download, FileText, Printer, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import { useFsStatement, useFsCoverage, useFsStatementMeta } from "@/hooks/useFinancialStatements";
import { exportSociCsv, exportSociPdf } from "@/lib/fsStatementExport";
import { fmtStatement, fmtEps, fmtMargin, rowClasses } from "@/lib/fsStatementModel";

const STATEMENT_CODE = "SOCI";

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function StatementOfComprehensiveIncome() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const { data: fiscalPeriods } = useFiscalPeriods();

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodPreset, setPeriodPreset] = useState("custom");
  const [cmpDateFrom, setCmpDateFrom] = useState<string | null>(null);
  const [cmpDateTo, setCmpDateTo] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const [pendingAction, setPendingAction] = useState<"csv" | "pdf" | "print" | null>(null);

  const { data: company } = useQuery({
    queryKey: ["tenant_company_for_soci", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("company_name").eq("id", appUser!.tenant_id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: meta } = useFsStatementMeta(STATEMENT_CODE);
  const { data: lines, isLoading, error } = useFsStatement(STATEMENT_CODE, dateFrom, dateTo, cmpDateFrom, cmpDateTo);
  const { data: coverage } = useFsCoverage(STATEMENT_CODE, dateFrom, dateTo);

  const errors = useMemo(() => (coverage ?? []).filter((c) => c.severity === "error"), [coverage]);
  const warnings = useMemo(() => (coverage ?? []).filter((c) => c.severity === "warning"), [coverage]);
  const unmapped = useMemo(() => errors.filter((c) => c.issue_code === "UNMAPPED_ACCOUNT"), [errors]);
  const unmappedTotal = useMemo(() => unmapped.reduce((s, c) => s + Math.abs(c.amount ?? 0), 0), [unmapped]);
  const tieOut = useMemo(() => errors.find((c) => c.issue_code === "TIE_OUT_VARIANCE"), [errors]);
  const cycle = useMemo(() => errors.find((c) => c.issue_code === "CYCLE"), [errors]);

  // A new/changed set of issues always needs fresh acknowledgement.
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

  const runExport = (action: "csv" | "pdf" | "print") => {
    if (errors.length > 0 && !acked) {
      setPendingAction(action);
      return;
    }
    execute(action);
  };

  const execute = (action: "csv" | "pdf" | "print") => {
    if (!lines) return;
    const ackNote = errors.length > 0 ? `Exported with ${errors.length} unresolved coverage error(s), acknowledged by ${appUser?.first_name ?? "user"} on ${formatDate(new Date(), "PPpp")}` : undefined;
    const exportMeta = {
      tenantId: appUser?.tenant_id ?? "",
      userId: appUser?.id,
      statementCode: STATEMENT_CODE,
      title: meta?.title ?? "Statement Of Comprehensive Income",
      periodCaption: meta?.period_caption,
      dateFrom,
      dateTo,
      warnings: (coverage ?? []).map((c) => `[${c.severity.toUpperCase()}] ${c.issue_code}: ${c.detail}`),
      ackNote,
      footerNotes: meta?.footer_notes ?? [],
    };
    if (action === "csv") {
      exportSociCsv(lines, exportMeta);
    } else if (action === "pdf") {
      exportSociPdf(lines, exportMeta);
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

  return (
    <div className="space-y-4">
      <div className="stat-card print:hidden">
        <div className="flex flex-wrap items-end gap-4">
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
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => runExport("csv")} disabled={!lines?.length}>
              <Download className="w-4 h-4 mr-1" /> CSV
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
            onClick={() => navigate(`/accounting/statement-mapping?from=${dateFrom}&to=${dateTo}`)}
          >
            Map these accounts
          </Button>
        </div>
      )}
      {tieOut && (
        <div className="print:hidden rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-3">
          <XCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
          <div><strong>Does not tie to the trial balance.</strong> Profit for the year is LKR {Math.abs(tieOut.amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {(tieOut.amount ?? 0) > 0 ? "higher" : "lower"} than the ledger's net P&L movement for this period.</div>
        </div>
      )}
      {cycle && (
        <div className="print:hidden rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-3">
          <XCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
          <div>{cycle.detail}</div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="print:hidden rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
          <div>{warnings.map((w) => w.detail).join(" · ")}</div>
        </div>
      )}

      <div className="stat-card print:shadow-none">
        <div className="text-center mb-6 print:mb-4">
          <p className="text-sm text-muted-foreground uppercase tracking-wide">{company?.company_name}</p>
          <h2 className="text-lg font-bold text-foreground mt-1">{meta?.title ?? "Statement Of Comprehensive Income"}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {meta?.period_caption ?? "For the Year Ended 31st March"} {new Date(dateTo).getFullYear()}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Generated: {formatDate(new Date(), "PPpp")}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-destructive">
            <p className="font-medium">Failed to load the statement.</p>
            <p className="text-sm mt-1">{(error as Error).message}</p>
          </div>
        ) : !lines?.length ? (
          <div className="text-center py-16 text-muted-foreground">No statement lines defined. Seed the default SOCI and map accounts first.</div>
        ) : (
          <table className="w-full text-sm max-w-3xl mx-auto">
            <thead>
              <tr className="border-b-2 border-foreground/30">
                <th scope="col" className="text-left py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground"></th>
                <th scope="col" className="w-10 text-center py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Note</th>
                <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-36">
                  {new Date(dateTo).getFullYear()}
                </th>
                {cmpDateTo && (
                  <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-36">
                    {new Date(cmpDateTo).getFullYear()}
                  </th>
                )}
                <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-16">%</th>
                {cmpDateTo && <th scope="col" className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-16">%</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                if (l.line_type === "spacer") return <tr key={l.line_id}><td colSpan={6} className="py-1"></td></tr>;
                const isEps = l.line_type === "per_share";
                return (
                  <tr key={l.line_id} className={rowClasses(l.emphasis)}>
                    <td className="py-1.5 pr-2 text-foreground">{l.label}</td>
                    <td className="py-1.5 text-center font-mono text-xs text-muted-foreground">{l.note_ref ?? ""}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {isEps ? fmtEps(l.current_value) : fmtStatement(l.current_value, l.line_type === "detail")}
                    </td>
                    {cmpDateTo && (
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {isEps ? fmtEps(l.compare_value) : fmtStatement(l.compare_value, l.line_type === "detail")}
                      </td>
                    )}
                    <td className="py-1.5 text-right font-mono tabular-nums text-xs">{l.show_margin ? fmtMargin(l.current_margin) : ""}</td>
                    {cmpDateTo && <td className="py-1.5 text-right font-mono tabular-nums text-xs">{l.show_margin ? fmtMargin(l.compare_margin) : ""}</td>}
                  </tr>
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
