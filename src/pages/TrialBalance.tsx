import { useState, useMemo, Fragment } from "react";
import { format as formatDate } from "date-fns";
import { Download, FileText, Printer, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import { useTrialBalance, type TrialBalanceGroupBy, type TrialBalanceRow } from "@/hooks/useTrialBalance";
import { fmtAmt, fmtBal } from "@/lib/glReportModel";
import { exportTrialBalanceCsv, exportTrialBalancePdf } from "@/lib/trialBalanceExport";
import { buildTrialBalanceGroups, filterVarianceRows, computeVarianceStats, type TrialBalanceGroupBlock } from "@/lib/trialBalanceModel";

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

type GroupBlock = TrialBalanceGroupBlock;

export default function TrialBalance() {
  const { appUser } = useAuth();
  const { data: fiscalPeriods } = useFiscalPeriods();

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodPreset, setPeriodPreset] = useState("custom");
  const [groupBy, setGroupBy] = useState<TrialBalanceGroupBy>("parent");
  const [includeZero, setIncludeZero] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: rows, isLoading, error } = useTrialBalance(dateFrom, dateTo, { groupBy, includeZero, includeInactive });

  const exportMeta = useMemo(
    () => ({
      tenantId: appUser?.tenant_id ?? "",
      userId: appUser?.id,
      dateFrom,
      dateTo,
      groupBy,
      includeZero,
      includeInactive,
      rowCount: rows?.length ?? 0,
    }),
    [appUser?.tenant_id, appUser?.id, dateFrom, dateTo, groupBy, includeZero, includeInactive, rows?.length]
  );

  const onPeriodPresetChange = (val: string) => {
    setPeriodPreset(val);
    if (val === "custom") return;
    const period = fiscalPeriods?.find((p: any) => p.id === val);
    if (period) {
      setDateFrom(period.period_start);
      setDateTo(period.period_end);
    }
  };

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    if (!varianceOnly) return rows;
    return filterVarianceRows(rows);
  }, [rows, varianceOnly]);

  const { groups, grand } = useMemo(() => buildTrialBalanceGroups(filteredRows), [filteredRows]);

  const varianceStats = useMemo(() => computeVarianceStats(rows ?? []), [rows]);

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.key)));
  const expandAll = () => setCollapsed(new Set());

  const isUnbalanced = Math.abs(grand.closing) > 0.005;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Trial Balance</h1>
          <p className="page-description">Ledger and audit-adjusted opening balances, with period movement and closing</p>
        </div>
      </div>

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
          <div className="min-w-[160px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period</label>
            <Select value={periodPreset} onValueChange={onPeriodPresetChange}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom range</SelectItem>
                {fiscalPeriods?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Group by</label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as TrialBalanceGroupBy)}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="parent">Parent Account</SelectItem>
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="type">Account Type</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
            <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
            <Button variant="outline" size="sm" onClick={() => rows && exportTrialBalanceCsv(groups, grand, exportMeta)} disabled={!rows?.length}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => rows && exportTrialBalancePdf(groups, grand, exportMeta)} disabled={!rows?.length}>
              <FileText className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            Include zero-balance accounts
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Include inactive accounts
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={varianceOnly} onChange={(e) => setVarianceOnly(e.target.checked)} />
            Show only audit variances
          </label>
          {varianceStats.count > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5" />
              {varianceStats.count} account{varianceStats.count !== 1 ? "s" : ""} with audit-adjusted openings · net {fmtBal(varianceStats.net)}
            </span>
          )}
        </div>
      </div>

      <div className="stat-card print:shadow-none overflow-x-auto">
        <div className="text-center mb-4 print:mb-3">
          <h2 className="text-lg font-bold text-foreground">Trial Balance</h2>
          <p className="text-sm text-muted-foreground">{dateFrom} — {dateTo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">All amounts in LKR</p>
          <p className="text-xs text-muted-foreground mt-0.5">Generated: {formatDate(new Date(), "PPpp")}</p>
        </div>

        {isUnbalanced && !isLoading && (
          <div className="print:hidden mb-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-2.5 text-sm text-red-900 dark:text-red-200 font-medium">
            Out of balance by {fmtBal(grand.closing)}. Review the ledger for the source of the difference.
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-destructive">
            <p className="font-medium">Failed to load the trial balance.</p>
            <p className="text-sm mt-1">{(error as Error).message}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No accounts match the current filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th rowSpan={2} scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground align-bottom w-16">No</th>
                <th rowSpan={2} scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground align-bottom">Ledger Name</th>
                <th rowSpan={2} scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground align-bottom w-36">Ledger Opening</th>
                <th rowSpan={2} scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground align-bottom w-36">Audit Opening</th>
                <th colSpan={3} scope="colgroup" className="px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/50">Transaction</th>
              </tr>
              <tr className="border-b-2 border-border">
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-36">Debit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-36">Credit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-36">Closing</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr className="bg-muted/40">
                      <td className="px-3 py-2">
                        <button onClick={() => toggleCollapse(g.key)} aria-expanded={!isCollapsed} className="p-0.5 rounded hover:bg-muted/60 print:hidden">
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td colSpan={5} className="px-3 py-2 font-semibold text-foreground text-xs uppercase tracking-wide">{g.label}</td>
                    </tr>
                    {!isCollapsed && g.rows.map((r) => {
                      const hasVariance = r.has_audit_row && Math.abs(r.opening_variance) > 0.005;
                      return (
                        <tr key={r.account_id} className={`border-b border-border/40 ${hasVariance ? "border-l-2 border-l-amber-500" : ""}`}>
                          <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{r.account_code}</td>
                          <td className="px-3 py-1.5 text-foreground pl-6">{r.account_name}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtBal(r.ledger_opening)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {hasVariance ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help underline decoration-dotted decoration-amber-500">{fmtBal(r.audit_opening)}</span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  Ledger {fmtBal(r.ledger_opening)} · Audit {fmtBal(r.audit_opening)} · Δ {fmtBal(r.opening_variance)}
                                </TooltipContent>
                              </Tooltip>
                            ) : fmtBal(r.audit_opening)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(r.period_debit)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(r.period_credit)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums font-medium">{fmtBal(r.closing)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-border font-semibold">
                      <td></td>
                      <td className="px-3 py-1.5 text-foreground text-xs">Total {g.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtBal(g.ledger_opening)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtBal(g.audit_opening)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(g.period_debit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(g.period_credit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtBal(g.closing)}</td>
                    </tr>
                    <tr className="h-2"><td colSpan={7}></td></tr>
                  </Fragment>
                );
              })}
              <tr className="border-t-2 border-foreground/30 font-bold">
                <td></td>
                <td className="px-3 py-2 text-foreground">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtBal(grand.ledger_opening)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtBal(grand.audit_opening)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtAmt(grand.period_debit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtAmt(grand.period_credit)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${isUnbalanced ? "text-destructive" : ""}`}>{fmtBal(grand.closing)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
