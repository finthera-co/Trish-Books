import { useState, useMemo, Fragment, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Download, FileText, Printer, ChevronDown, ChevronRight, AlertTriangle, FileSpreadsheet, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ReportMasthead, useReportCompany } from "@/components/reports/ReportMasthead";
import { useAuth } from "@/contexts/AuthContext";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import { useTrialBalance, type TrialBalanceGroupBy, type TrialBalanceRow } from "@/hooks/useTrialBalance";
import { fetchGLAccountTree, fetchGLTransactions, type GLTransactionRow } from "@/hooks/useGeneralLedger";
import { buildGeneralLedgerRows, getVisibleLeafAccountIds, fmtAmt, fmtBal } from "@/lib/glReportModel";
import { computeGlFingerprint, formatGlFingerprintLine } from "@/lib/glReportExport";
import { exportTrialBalanceCsv, exportTrialBalancePdf } from "@/lib/trialBalanceExport";
import { downloadTrialBalanceWorkbook } from "@/lib/trialBalanceWorkbook";
import { describeStepError } from "@/lib/errorMessage";
import {
  buildTrialBalanceGroups, filterVarianceRows, computeVarianceStats,
  openingSplit, closingSplit, closingDifference, openingBasis,
  type TrialBalanceGroupBlock,
} from "@/lib/trialBalanceModel";

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

type GroupBlock = TrialBalanceGroupBlock;

/** Reader-facing names for the grouping, for the masthead's scope line. */
const GROUP_BY_LABELS: Record<TrialBalanceGroupBy, string> = {
  parent: "Parent Account",
  category: "Category",
  type: "Account Type",
};

export default function TrialBalance() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const { data: fiscalPeriods } = useFiscalPeriods();

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodPreset, setPeriodPreset] = useState("custom");
  const [groupBy, setGroupBy] = useState<TrialBalanceGroupBy>("parent");
  const [includeZero, setIncludeZero] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [isBuildingWorkbook, setIsBuildingWorkbook] = useState(false);

  const { data: rows, isLoading, error } = useTrialBalance(dateFrom, dateTo, { groupBy, includeZero, includeInactive });

  // Company identity — the same block the on-screen masthead renders, so the
  // workbook heading and the printed page can never disagree.
  const { data: company } = useReportCompany();

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
      company: {
        companyName: company?.company_name,
        address: company?.address,
        phone: company?.phone,
        taxId: company?.tax_id,
        registrationNumber: company?.registration_number,
      },
      preparedBy: [appUser?.first_name, appUser?.last_name].filter(Boolean).join(" "),
    }),
    [appUser?.tenant_id, appUser?.id, appUser?.first_name, appUser?.last_name, dateFrom, dateTo, groupBy, includeZero, includeInactive, rows?.length, company]
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
  const basis = useMemo(() => openingBasis(rows ?? []), [rows]);

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.key)));
  const expandAll = () => setCollapsed(new Set());

  const closingDiff = closingDifference(grand);
  const isUnbalanced = Math.abs(closingDiff) > 0.005;

  /** Every figure on a row traces back to the same place — the ledger behind it. */
  const openLedger = useCallback(
    (accountId: string) => {
      const params = new URLSearchParams({ tab: "general-ledger", account: accountId, from: dateFrom, to: dateTo });
      navigate(`/accounting/ledger?${params.toString()}`);
    },
    [navigate, dateFrom, dateTo]
  );

  /**
   * Trial Balance and General Ledger in one workbook. The ledger is fetched at
   * download time over the same range and the same account population the trial
   * balance was built from, so the two tabs always agree.
   */
  const downloadWorkbookWithLedger = useCallback(async () => {
    if (!rows?.length || !appUser?.tenant_id) return;
    setIsBuildingWorkbook(true);
    // Names the round trip in flight, so a failure says which one broke rather
    // than just "export failed".
    let step = "Loading the chart of accounts";
    try {
      const tree = await fetchGLAccountTree(dateFrom, dateTo, undefined, includeInactive);

      // includeZeroActivity is deliberately ON regardless of the Trial Balance's
      // own zero filter. The two filters are not equivalent: an account with a
      // recorded opening balance but no ledger history appears on the Trial
      // Balance (its audit opening is non-zero) yet the General Ledger prunes it
      // (its ledger-derived opening and activity are both zero). Pruning here
      // would leave that row without a ledger section to link to — and whether
      // it happened would depend on which tenant's data you exported. Carrying
      // every account guarantees every Trial Balance row resolves, for every
      // tenant, and a dormant account with zero totals is correct detail in an
      // audit pack rather than noise.
      const glOptions = { includeZeroActivity: true, includeOtherRows: true, showAccountCodes: true };
      const leafIds = [...getVisibleLeafAccountIds(tree, glOptions)].sort();

      step = "Loading ledger transactions";
      const txns = await fetchGLTransactions(dateFrom, dateTo, leafIds);
      const byAccount = new Map<string, GLTransactionRow[]>();
      for (const id of leafIds) byAccount.set(id, []);
      for (const t of txns) byAccount.get(t.account_id)?.push(t);

      step = "Building the workbook";
      const gl = buildGeneralLedgerRows(tree, byAccount, { ...glOptions, collapsed: new Set() });

      const glParams = {
        tenantId: appUser.tenant_id,
        dateFrom,
        dateTo,
        accountType: null,
        // Mirrors glOptions above — the fingerprint has to describe what was
        // actually exported, not what the Trial Balance's own filter said.
        includeZeroActivity: glOptions.includeZeroActivity,
        includeOtherRows: glOptions.includeOtherRows,
        includeInactive,
        grandDebit: gl.grandDebit,
        grandCredit: gl.grandCredit,
        rowCount: gl.rows.length,
      };

      const ok = downloadTrialBalanceWorkbook({
        company,
        meta: exportMeta,
        groups,
        grand,
        glRows: gl.rows,
        glFingerprintLine: formatGlFingerprintLine(glParams, computeGlFingerprint(glParams)),
      });
      if (!ok) toast.error("Nothing to download for the selected period.");
    } catch (e) {
      // Keep the raw object reachable: supabase-js rejects with a plain
      // PostgrestError, whose `details`/`hint` never reach the toast.
      console.error("Trial Balance workbook export failed", { step, error: e });
      toast.error(describeStepError(step, e, "Excel export failed"));
    } finally {
      setIsBuildingWorkbook(false);
    }
  }, [rows, appUser, dateFrom, dateTo, includeInactive, company, exportMeta, groups, grand]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Trial Balance</h1>
          <p className="page-description">Opening balances, period movement and closing balances — debit and credit, account by account</p>
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
            <Button size="sm" onClick={downloadWorkbookWithLedger} disabled={!rows?.length || isBuildingWorkbook}>
              {isBuildingWorkbook ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}
              Excel (with Ledger)
            </Button>
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
        <ReportMasthead
          title="Trial Balance"
          dateFrom={dateFrom}
          dateTo={dateTo}
          currency="LKR"
          scope={[
            { label: "Grouped by", value: GROUP_BY_LABELS[groupBy] },
            { label: "Zero-balance accounts", value: includeZero ? "Included" : "Excluded" },
            { label: "Inactive accounts", value: includeInactive ? "Included" : "Excluded" },
            varianceOnly && { label: "Filter", value: "Audit variances only" },
          ]}
          note={
            isUnbalanced
              ? `Debits and credits do not agree — difference ${fmtBal(closingDiff)}.`
              : null
          }
        />

        {!isLoading && !error && rows?.length ? <OpeningBasisNote basis={basis} dateFrom={dateFrom} /> : null}

        {isUnbalanced && !isLoading && (
          <div className="print:hidden mb-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-2.5 text-sm text-red-900 dark:text-red-200 font-medium">
            Out of balance: closing debits exceed credits by {fmtBal(closingDiff)}. Review the ledger for the source of the difference.
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
          <table className="w-full text-sm report-table report-table--grid">
            <thead>
              <tr className="border-b border-border">
                <th rowSpan={2} scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground align-bottom w-16">No</th>
                <th rowSpan={2} scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground align-bottom">Ledger Name</th>
                <th colSpan={2} scope="colgroup" className="px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/50">Opening Balance</th>
                <th colSpan={2} scope="colgroup" className="px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/50">Transactions</th>
                <th colSpan={2} scope="colgroup" className="px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/50">Closing Balance</th>
              </tr>
              <tr className="border-b-2 border-border">
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-32">Debit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-32">Credit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-32">Debit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-32">Credit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-32">Debit</th>
                <th scope="col" className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-32">Credit</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.key} group={g} isCollapsed={collapsed.has(g.key)} onToggle={() => toggleCollapse(g.key)} onOpenLedger={openLedger} />
              ))}
              <tr className="border-t-2 border-foreground/30 font-bold">
                <td></td>
                <td className="px-3 py-2 text-foreground">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtBal(grand.opening_debit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtBal(grand.opening_credit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtBal(grand.period_debit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtBal(grand.period_credit)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${isUnbalanced ? "text-destructive" : ""}`}>{fmtBal(grand.closing_debit)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${isUnbalanced ? "text-destructive" : ""}`}>{fmtBal(grand.closing_credit)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <p className="text-xs text-muted-foreground mt-3 print:hidden">
          Click any ledger code, name or closing balance to open that account in the General Ledger.
        </p>
      </div>
    </div>
  );
}

/**
 * What the opening column actually represents. QuickBooks and Xero derive the
 * opening from posted history and never require a stored opening-balance entry;
 * saying so explicitly stops a screen of zeros reading as a data-loading bug.
 */
function OpeningBasisNote({ basis, dateFrom }: { basis: ReturnType<typeof openingBasis>; dateFrom: string }) {
  if (basis === "audited") return null;
  const text =
    basis === "ledger-carry-forward"
      ? `No opening balances have been recorded for this period — openings are carried forward from entries posted before ${dateFrom}.`
      : `Every opening balance is zero: no entries are posted before ${dateFrom}, and no opening balances have been recorded. This period is the start of the ledger.`;
  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 flex items-start gap-2.5 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function GroupRows({
  group, isCollapsed, onToggle, onOpenLedger,
}: { group: GroupBlock; isCollapsed: boolean; onToggle: () => void; onOpenLedger: (accountId: string) => void }) {
  return (
    <Fragment>
      <tr className="bg-muted/40">
        <td className="px-3 py-2">
          <button onClick={onToggle} aria-expanded={!isCollapsed} className="p-0.5 rounded hover:bg-muted/60 print:hidden">
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </td>
        <td colSpan={7} className="px-3 py-2 font-semibold text-foreground text-xs uppercase tracking-wide">{group.label}</td>
      </tr>
      {!isCollapsed && group.rows.map((r) => <AccountRow key={r.account_id} row={r} onOpenLedger={onOpenLedger} />)}
      <tr className="border-t border-border font-semibold">
        <td></td>
        <td className="px-3 py-1.5 text-foreground text-xs">Total {group.label}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(group.opening_debit)}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(group.opening_credit)}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(group.period_debit)}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(group.period_credit)}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(group.closing_debit)}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(group.closing_credit)}</td>
      </tr>
      <tr className="h-2"><td colSpan={8}></td></tr>
    </Fragment>
  );
}

function AccountRow({ row, onOpenLedger }: { row: TrialBalanceRow; onOpenLedger: (accountId: string) => void }) {
  const open = openingSplit(row);
  const close = closingSplit(row);
  const hasVariance = row.has_audit_row && Math.abs(row.opening_variance) > 0.005;
  const drill = () => onOpenLedger(row.account_id);
  const linkClass = "text-left hover:text-primary hover:underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-ring/40 rounded";
  const title = `Open ${row.account_code} ${row.account_name} in the General Ledger`;

  const openingCell = (value: number) =>
    hasVariance ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-amber-500">{fmtAmt(value)}</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          Ledger {fmtBal(row.ledger_opening)} · Audit {fmtBal(row.audit_opening)} · Δ {fmtBal(row.opening_variance)}
        </TooltipContent>
      </Tooltip>
    ) : (
      fmtAmt(value)
    );

  return (
    <tr className={`border-b border-border/40 hover:bg-primary/5 ${hasVariance ? "border-l-2 border-l-amber-500" : ""}`}>
      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <button onClick={drill} title={title} className={linkClass}>{row.account_code}</button>
      </td>
      <td className="px-3 py-1.5 text-foreground pl-6">
        <button onClick={drill} title={title} className={linkClass}>{row.account_name}</button>
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{openingCell(open.debit)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{openingCell(open.credit)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(row.period_debit)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtAmt(row.period_credit)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-medium">
        <button onClick={drill} title={title} className={`${linkClass} w-full text-right`}>{fmtAmt(close.debit)}</button>
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-medium">
        <button onClick={drill} title={title} className={`${linkClass} w-full text-right`}>{fmtAmt(close.credit)}</button>
      </td>
    </tr>
  );
}
