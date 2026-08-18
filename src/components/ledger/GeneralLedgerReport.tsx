import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Download, FileText, Printer, BookOpen, ChevronRight, ChevronDown,
  AlertTriangle, XCircle, Loader2, Rows3, Lock, Filter,
} from "lucide-react";
import { ACCOUNT_TYPES } from "@/lib/accountTypes";
import { ReportMasthead, useReportCompany } from "@/components/reports/ReportMasthead";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import {
  useGLAccountTree, useGLIntegrity, useGLPeriodInfo, fetchGLTransactions,
  type GLTransactionRow,
} from "@/hooks/useGeneralLedger";
import {
  buildGeneralLedgerRows, getVisibleLeafAccountIds, fmtAmt, fmtBal, GL_REPORT_CURRENCY,
  type GLReportRow,
} from "@/lib/glReportModel";
import {
  exportGeneralLedgerCsv, exportGeneralLedgerPdf, computeGlFingerprint, formatGlFingerprintLine, logGlExport,
} from "@/lib/glReportExport";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/errorMessage";
import { formatDate } from "@/lib/format";

const ROW_HEIGHT = 36;
const RENDER_ALL_WARN_THRESHOLD = 20_000;

function glDate(iso: string): string {
  try {
    return formatDate(iso);
  } catch {
    return iso;
  }
}

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

interface RowCells {
  label: string;
  type: string;
  date: string;
  num: string;
  adj: string;
  name: string;
  memo: string;
  split: string;
  debit: string;
  credit: string;
  balance: string;
  loading: boolean;
}

function cellsFor(row: GLReportRow): RowCells {
  if (row.kind === "txn") {
    if (row.isLoadingTxns || !row.txn) {
      return { label: "", type: "", date: "", num: "", adj: "", name: "", memo: "", split: "", debit: "", credit: "", balance: "", loading: true };
    }
    const t: GLTransactionRow = row.txn;
    return {
      label: "", type: t.txn_type, date: glDate(t.entry_date), num: t.num,
      adj: t.is_adjusting ? "√" : "", name: t.entity_name, memo: t.memo, split: t.split_text,
      debit: fmtAmt(t.debit), credit: fmtAmt(t.credit), balance: fmtBal(t.running_balance), loading: false,
    };
  }
  return {
    label: row.label ?? "", type: "", date: "", num: "", adj: "", name: "", memo: "", split: "",
    debit: fmtAmt(row.debit), credit: fmtAmt(row.credit), balance: fmtBal(row.balance), loading: false,
  };
}

function rowClassName(kind: GLReportRow["kind"]): string {
  switch (kind) {
    case "account-header":
      return "font-semibold";
    case "account-total":
      return "font-semibold border-t border-border";
    case "grand-total":
      return "font-bold border-t-2 border-border";
    default:
      return "border-b border-border/40 hover:bg-muted/20";
  }
}

const COL_HEADERS = ["", "Type", "Date", "Num", "Adj", "Name", "Memo", "Split", "Debit", "Credit", "Balance"];
const DEFAULT_COL_WIDTHS = [280, 130, 110, 110, 60, 160, 200, 160, 140, 140, 150];
const MIN_COL_WIDTH = 48;
const COL_GAP = 4;

export interface GeneralLedgerReportProps {
  /** Drill-through target from the Trial Balance: show only this account's subtree. */
  focusAccountId?: string | null;
  /** Label for the focus chip — the caller already knows the account's name. */
  focusAccountLabel?: string | null;
  onClearFocus?: () => void;
  /** Date range to open with, when the caller arrives from another report. */
  initialDateFrom?: string;
  initialDateTo?: string;
}

export default function GeneralLedgerReport({
  focusAccountId = null,
  focusAccountLabel = null,
  onClearFocus,
  initialDateFrom,
  initialDateTo,
}: GeneralLedgerReportProps = {}) {
  const { appUser } = useAuth();
  const { canView } = useMyPermissions();
  const { data: fiscalPeriods } = useFiscalPeriods();
  const { data: company } = useReportCompany();

  const [dateFrom, setDateFrom] = useState(() => initialDateFrom || defaultDateFrom());
  const [dateTo, setDateTo] = useState(() => initialDateTo || new Date().toISOString().slice(0, 10));
  const [periodPreset, setPeriodPreset] = useState<string>("custom");
  const [accountType, setAccountType] = useState<string>("all");
  const [includeZeroActivity, setIncludeZeroActivity] = useState(true);
  const [includeOtherRows, setIncludeOtherRows] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [showAccountCodes, setShowAccountCodes] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [forceRenderAll, setForceRenderAll] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState<"csv" | "pdf" | null>(null);
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<number[]>(DEFAULT_COL_WIDTHS);

  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const handleResizeMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { index, startX: e.clientX, startWidth: colWidths[index] };
    const onMove = (ev: MouseEvent) => {
      const drag = resizingRef.current;
      if (!drag) return;
      const next = Math.max(MIN_COL_WIDTH, drag.startWidth + (ev.clientX - drag.startX));
      setColWidths((prev) => {
        if (prev[drag.index] === next) return prev;
        const copy = [...prev];
        copy[drag.index] = next;
        return copy;
      });
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  const gridTemplateColumns = useMemo(() => colWidths.map((w) => `${w}px`).join(" "), [colWidths]);
  const totalColWidth = useMemo(
    () => colWidths.reduce((sum, w) => sum + w, 0) + COL_GAP * (colWidths.length - 1),
    [colWidths]
  );

  useEffect(() => {
    const before = () => setIsPrinting(true);
    const after = () => setIsPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const canViewReport = canView("reports");

  const treeQuery = useGLAccountTree(dateFrom, dateTo, accountType === "all" ? undefined : accountType, includeInactive);
  const integrityQuery = useGLIntegrity(dateFrom, dateTo);
  const periodInfo = useGLPeriodInfo(dateFrom);

  // Arriving from the Trial Balance a second time (different account, different
  // period) remounts nothing, so the range has to follow the caller's params.
  useEffect(() => {
    if (initialDateFrom) setDateFrom(initialDateFrom);
    if (initialDateTo) setDateTo(initialDateTo);
    if (initialDateFrom || initialDateTo) setPeriodPreset("custom");
  }, [initialDateFrom, initialDateTo]);

  const buildOptions = useMemo(
    () => ({ includeZeroActivity, includeOtherRows, showAccountCodes, collapsed, focusAccountId }),
    [includeZeroActivity, includeOtherRows, showAccountCodes, collapsed, focusAccountId]
  );

  const visibleAccountIds = useMemo(() => {
    if (!treeQuery.data) return [];
    return getVisibleLeafAccountIds(treeQuery.data, buildOptions);
  }, [treeQuery.data, buildOptions]);

  const sortedVisibleIds = useMemo(() => [...visibleAccountIds].sort(), [visibleAccountIds]);

  const txnsQuery = useQuery({
    queryKey: ["gl_txns_screen", appUser?.tenant_id, dateFrom, dateTo, sortedVisibleIds.join(",")],
    enabled: Boolean(dateFrom && dateTo) && sortedVisibleIds.length > 0,
    queryFn: () => fetchGLTransactions(dateFrom, dateTo, sortedVisibleIds),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const txnsByAccount = useMemo(() => {
    const map = new Map<string, GLTransactionRow[]>();
    if (sortedVisibleIds.length === 0) return map;
    if (txnsQuery.data === undefined) return map; // still loading -> every visible leaf shows a spinner
    for (const id of sortedVisibleIds) map.set(id, []);
    for (const row of txnsQuery.data) {
      const arr = map.get(row.account_id) ?? [];
      arr.push(row);
      map.set(row.account_id, arr);
    }
    return map;
  }, [sortedVisibleIds, txnsQuery.data]);

  const { rows, grandDebit, grandCredit, imbalance } = useMemo(() => {
    if (!treeQuery.data) {
      return { rows: [] as GLReportRow[], grandOpening: 0, grandDebit: 0, grandCredit: 0, grandBalance: 0, imbalance: 0 };
    }
    return buildGeneralLedgerRows(treeQuery.data, txnsByAccount, buildOptions);
  }, [treeQuery.data, txnsByAccount, buildOptions]);

  // A deliberately narrowed report (one account, one account type, actives only)
  // has no reason to balance — flagging it as an imbalance would cry wolf on
  // every drill-through. Only a whole-ledger view can be out of balance.
  const isScopedView = accountType !== "all" || focusAccountId != null || !includeInactive;
  const reportImbalance = isScopedView ? 0 : imbalance;

  const fingerprint = useMemo(() => {
    if (!appUser?.tenant_id) return null;
    const params = {
      tenantId: appUser.tenant_id,
      dateFrom,
      dateTo,
      accountType: accountType === "all" ? null : accountType,
      includeZeroActivity,
      includeOtherRows,
      includeInactive,
      grandDebit,
      grandCredit,
      rowCount: rows.length,
    };
    const hash = computeGlFingerprint(params);
    return { hash, line: formatGlFingerprintLine(params, hash) };
  }, [appUser?.tenant_id, dateFrom, dateTo, accountType, includeZeroActivity, includeOtherRows, includeInactive, grandDebit, grandCredit, rows.length]);

  const toggleCollapse = useCallback((nodeKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    if (!treeQuery.data) return;
    setCollapsed(new Set(treeQuery.data.filter((n) => n.has_children).map((n) => n.node_key)));
  }, [treeQuery.data]);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  const onPeriodPresetChange = (val: string) => {
    setPeriodPreset(val);
    if (val === "custom") return;
    const period = fiscalPeriods?.find((p: any) => p.id === val);
    if (period) {
      setDateFrom(period.period_start);
      setDateTo(period.period_end);
    }
  };

  // Print bypasses virtualisation entirely — a windowed printout is a truncated
  // financial statement. The escape hatch below serves the same full render for
  // Ctrl+F search and screen readers.
  const renderFull = isPrinting || forceRenderAll;

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: renderFull ? 0 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const warningLines = useMemo(() => {
    const lines: string[] = [];
    for (const issue of integrityQuery.data ?? []) {
      lines.push(`[${issue.severity.toUpperCase()}] ${issue.code}: ${issue.detail}${issue.amount != null ? ` (${issue.amount.toFixed(2)})` : ""}`);
    }
    if (Math.abs(reportImbalance) > 0.005) lines.push(`[ERROR] IMBALANCE: Dr/Cr differ by ${reportImbalance.toFixed(2)}`);
    return lines;
  }, [integrityQuery.data, reportImbalance]);

  const runExport = useCallback(
    async (kind: "csv" | "pdf") => {
      if (!treeQuery.data || !appUser?.tenant_id) return;
      setIsExporting(kind);
      try {
        // Exports cover every in-scope account regardless of on-screen collapse —
        // collapse is a navigation aid, not a data filter.
        const fullIds = getVisibleLeafAccountIds(treeQuery.data, { includeZeroActivity, includeOtherRows, focusAccountId });
        const sortedFullIds = [...fullIds].sort();
        const allTxns = await fetchGLTransactions(dateFrom, dateTo, sortedFullIds);
        const fullTxnsByAccount = new Map<string, GLTransactionRow[]>();
        for (const id of sortedFullIds) fullTxnsByAccount.set(id, []);
        for (const t of allTxns) {
          const arr = fullTxnsByAccount.get(t.account_id) ?? [];
          arr.push(t);
          fullTxnsByAccount.set(t.account_id, arr);
        }
        const full = buildGeneralLedgerRows(treeQuery.data, fullTxnsByAccount, {
          includeZeroActivity,
          includeOtherRows,
          showAccountCodes,
          focusAccountId,
          collapsed: new Set(),
        });

        const params = {
          tenantId: appUser.tenant_id,
          dateFrom,
          dateTo,
          accountType: accountType === "all" ? null : accountType,
          includeZeroActivity,
          includeOtherRows,
          includeInactive,
          grandDebit: full.grandDebit,
          grandCredit: full.grandCredit,
          rowCount: full.rows.length,
        };
        const hash = computeGlFingerprint(params);
        const line = formatGlFingerprintLine(params, hash);

        if (kind === "csv") {
          exportGeneralLedgerCsv(full.rows, { dateFrom, dateTo, fingerprintLine: line, warnings: warningLines });
        } else {
          await exportGeneralLedgerPdf(full.rows, {
            dateFrom,
            dateTo,
            fingerprintLine: line,
            currency: GL_REPORT_CURRENCY,
            company: {
              companyName: company?.company_name,
              address: company?.address,
              phone: company?.phone,
              taxId: company?.tax_id,
              registrationNumber: company?.registration_number,
            },
            subtitle: focusAccountId ? focusAccountLabel : null,
            // Mirrors the on-screen masthead's scope line — the export covers
            // every in-scope account regardless of on-screen collapse.
            scopeLine:
              `Account type ${accountType === "all" ? "All types" : accountType}  ·  ` +
              `Zero-activity accounts ${includeZeroActivity ? "included" : "excluded"}  ·  ` +
              `Inactive accounts ${includeInactive ? "included" : "excluded"}`,
            preparedBy: [appUser.first_name, appUser.last_name].filter(Boolean).join(" "),
          });
        }

        await logGlExport({
          tenantId: appUser.tenant_id,
          userId: appUser.id,
          format: kind,
          dateFrom,
          dateTo,
          fingerprint: hash,
          rowCount: full.rows.length,
          grandDebit: full.grandDebit,
          grandCredit: full.grandCredit,
        });
      } catch (e) {
        // supabase-js rejects with a plain PostgrestError, not an Error — the
        // old `instanceof Error` check threw the actual diagnosis away.
        console.error("General Ledger export failed", e);
        toast.error(describeError(e, "Export failed"));
      } finally {
        setIsExporting(null);
      }
    },
    [treeQuery.data, appUser, dateFrom, dateTo, accountType, includeZeroActivity, includeOtherRows, includeInactive, showAccountCodes, focusAccountId, focusAccountLabel, company, warningLines]
  );

  if (!canViewReport) {
    return (
      <div className="stat-card text-center py-16">
        <Lock className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">You don't have permission to view the General Ledger.</p>
      </div>
    );
  }

  const closedPeriodNotice =
    periodInfo.period && periodInfo.period.status === "closed"
      ? `Range includes closed period "${periodInfo.period.name}" (closed ${periodInfo.period.closed_at ? glDate(periodInfo.period.closed_at) : "—"})`
      : null;

  const isLoading = treeQuery.isLoading;
  const showRenderAllWarning = !renderFull && rows.length > RENDER_ALL_WARN_THRESHOLD;

  return (
    <div className="space-y-4">
      {/* ── Controls (hidden when printing) ── */}
      <div className="stat-card print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">From</label>
            <input
              type="date" value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPeriodPreset("custom"); }}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">To</label>
            <input
              type="date" value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPeriodPreset("custom"); }}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period</label>
            <Select value={periodPreset} onValueChange={onPeriodPresetChange}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom range</SelectItem>
                {fiscalPeriods?.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}{p.status === "closed" ? " (closed)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Account Type</label>
            <Select value={accountType} onValueChange={setAccountType}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
            <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
            <Button variant="outline" size="sm" onClick={() => runExport("csv")} disabled={isLoading || isExporting !== null}>
              {isExporting === "csv" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />} CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => runExport("pdf")} disabled={isLoading || isExporting !== null}>
              {isExporting === "pdf" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />} PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={includeZeroActivity} onChange={(e) => setIncludeZeroActivity(e.target.checked)} />
            Show zero-activity accounts
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={includeOtherRows} onChange={(e) => setIncludeOtherRows(e.target.checked)} />
            Show "- Other" rows
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Include inactive accounts
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showAccountCodes} onChange={(e) => setShowAccountCodes(e.target.checked)} />
            Show account codes
          </label>
        </div>
      </div>

      {focusAccountId && (
        <div className="print:border print:border-border rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex items-center gap-3 text-sm">
          <Filter className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-foreground">
            Showing only <strong>{focusAccountLabel || "the selected ledger"}</strong> and its sub-accounts, from the Trial Balance.
          </span>
          {onClearFocus && (
            <Button variant="outline" size="sm" className="ml-auto print:hidden" onClick={onClearFocus}>
              <XCircle className="w-3.5 h-3.5 mr-1" /> Show all accounts
            </Button>
          )}
        </div>
      )}

      {/* ── Banner stack ── */}
      {!dismissedBanners.has("integrity") && (integrityQuery.data?.some((i) => i.severity === "error")) && (
        <Banner tone="error" icon={XCircle} onDismiss={() => setDismissedBanners((s) => new Set(s).add("integrity"))}>
          <strong>Ledger integrity errors detected.</strong> {integrityQuery.data!.filter((i) => i.severity === "error").length} error(s) in this range —
          the figures below may not be trustworthy until resolved.
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {integrityQuery.data!.filter((i) => i.severity === "error").slice(0, 5).map((i, idx) => <li key={idx}>{i.detail}</li>)}
          </ul>
        </Banner>
      )}
      {!dismissedBanners.has("imbalance") && Math.abs(reportImbalance) > 0.005 && (
        <Banner tone="error" icon={XCircle} onDismiss={() => setDismissedBanners((s) => new Set(s).add("imbalance"))}>
          <strong>Report does not balance.</strong> Debits and credits differ by {GL_REPORT_CURRENCY} {Math.abs(reportImbalance).toFixed(2)}.
        </Banner>
      )}
      {!dismissedBanners.has("closed-period") && closedPeriodNotice && (
        <Banner tone="warning" icon={AlertTriangle} onDismiss={() => setDismissedBanners((s) => new Set(s).add("closed-period"))}>
          {closedPeriodNotice}
        </Banner>
      )}

      {/* ── Report header ── */}
      <div className="stat-card print:shadow-none">
        <ReportMasthead
          title="General Ledger"
          subtitle={focusAccountId ? focusAccountLabel : null}
          dateFrom={dateFrom}
          dateTo={dateTo}
          currency={GL_REPORT_CURRENCY}
          scope={[
            { label: "Account type", value: accountType === "all" ? "All types" : accountType },
            { label: "Zero-activity accounts", value: includeZeroActivity ? "Included" : "Excluded" },
            { label: "Inactive accounts", value: includeInactive ? "Included" : "Excluded" },
            focusAccountId && { label: "Scope", value: "Selected ledger and its sub-accounts" },
          ]}
          note={
            Math.abs(reportImbalance) > 0.005
              ? `Debits and credits do not agree — difference ${GL_REPORT_CURRENCY} ${Math.abs(reportImbalance).toFixed(2)}.`
              : null
          }
          documentId={fingerprint?.line}
        />

        {showRenderAllWarning && (
          <div className="print:hidden mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {rows.length.toLocaleString()} rows — virtualised for performance. Rendering every row lets Ctrl+F and screen readers see everything, but may be slow.
            </span>
            <Button variant="outline" size="sm" onClick={() => setForceRenderAll((v) => !v)}>
              <Rows3 className="w-3.5 h-3.5 mr-1" /> {forceRenderAll ? "Virtualise again" : "Render all rows"}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : treeQuery.error ? (
          <div className="text-center py-16 text-destructive">
            <XCircle className="w-10 h-10 mx-auto mb-3" />
            <p className="font-medium">Failed to load the General Ledger.</p>
            <p className="text-sm mt-1">{(treeQuery.error as Error).message}</p>
          </div>
        ) : rows.length <= 1 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No accounts match the current filters</p>
          </div>
        ) : renderFull ? (
          <FullTable rows={rows} collapsed={collapsed} onToggle={toggleCollapse} colWidths={colWidths} />
        ) : (
          <div
            ref={parentRef}
            className="overflow-auto border border-border rounded-lg"
            style={{ height: "70vh" }}
            role="table"
            aria-label="General Ledger transactions"
          >
            <div style={{ width: totalColWidth, minWidth: "100%" }}>
              <div
                role="row"
                className="grid sticky top-0 z-10 bg-muted/60 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns, columnGap: COL_GAP }}
              >
                {COL_HEADERS.map((h, i) => (
                  <div key={i} role="columnheader" className={`relative px-3.5 py-2.5 ${i >= 8 ? "text-right" : "text-left"}`}>
                    <span className="truncate block">{h}</span>
                    <div
                      onMouseDown={(e) => handleResizeMouseDown(i, e)}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${h || "label"} column`}
                      className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-primary/40 active:bg-primary/60"
                    />
                  </div>
                ))}
              </div>
              <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const row = rows[vi.index];
                  return (
                    <GridRow
                      key={row.key}
                      row={row}
                      collapsed={collapsed}
                      onToggle={toggleCollapse}
                      gridTemplateColumns={gridTemplateColumns}
                      style={{ position: "absolute", top: 0, left: 0, width: totalColWidth, height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ tone, icon: Icon, children, onDismiss }: { tone: "error" | "warning"; icon: any; children: React.ReactNode; onDismiss: () => void }) {
  const classes =
    tone === "error"
      ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800 text-red-900 dark:text-red-200"
      : "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 text-amber-900 dark:text-amber-200";
  return (
    <div className={`print:hidden rounded-lg border px-4 py-3 flex items-start gap-3 text-sm ${classes}`}>
      <Icon className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-current/60 hover:text-current">
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

function GridRow({
  row, collapsed, onToggle, style, gridTemplateColumns,
}: {
  row: GLReportRow; collapsed: Set<string>; onToggle: (k: string) => void;
  style: React.CSSProperties; gridTemplateColumns: string;
}) {
  const c = cellsFor(row);
  const isHeader = row.kind === "account-header";
  const isCollapsible = isHeader && !!row.nodeKey;
  const isCollapsed = row.nodeKey ? collapsed.has(row.nodeKey) : false;

  return (
    <div
      role="row"
      aria-level={row.kind !== "txn" ? row.depth || undefined : undefined}
      aria-expanded={isCollapsible ? !isCollapsed : undefined}
      className={`grid text-sm ${rowClassName(row.kind)}`}
      style={{ ...style, gridTemplateColumns, columnGap: COL_GAP }}
    >
      <div role="cell" className="px-3.5 py-2 flex items-center gap-1.5 truncate" style={{ paddingLeft: row.kind !== "txn" ? row.depth * 16 + 14 : 14 }}>
        {isCollapsible && (
          <button
            onClick={() => onToggle(row.nodeKey!)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            className="p-0.5 -ml-1 rounded hover:bg-muted/60 flex-shrink-0"
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
        <span className="truncate">{c.label}</span>
      </div>
      <div role="cell" className="px-3.5 py-2 truncate">{c.type}</div>
      <div role="cell" className="px-3.5 py-2 truncate tabular-nums">{c.date}</div>
      <div role="cell" className="px-3.5 py-2 truncate font-mono text-xs">{c.num}</div>
      <div role="cell" className="px-3.5 py-2 text-center" aria-label={c.adj ? "Adjusting entry" : undefined}>{c.adj}</div>
      <div role="cell" className="px-3.5 py-2 truncate">{c.name}</div>
      <div role="cell" className="px-3.5 py-2 truncate">{c.memo}</div>
      <div role="cell" className="px-3.5 py-2 truncate" title={c.split}>{c.split}</div>
      <div role="cell" className="px-3.5 py-2 text-right font-mono tabular-nums">{c.debit}</div>
      <div role="cell" className="px-3.5 py-2 text-right font-mono tabular-nums">{c.credit}</div>
      <div role="cell" className="px-3.5 py-2 text-right font-mono tabular-nums">
        {c.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : c.balance}
      </div>
    </div>
  );
}

/** Full, non-virtualised semantic <table> — used for print and the render-all escape hatch. */
function FullTable({
  rows, collapsed, onToggle, colWidths,
}: { rows: GLReportRow[]; collapsed: Set<string>; onToggle: (k: string) => void; colWidths: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-separate report-table report-table--grid" style={{ borderSpacing: `${COL_GAP}px 0` }} aria-label="General Ledger transactions">
        <colgroup>
          {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr className="border-b-2 border-border bg-muted/30">
            {COL_HEADERS.map((h, i) => (
              <th key={i} scope="col" className={`px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap ${i >= 8 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const c = cellsFor(row);
            const isHeader = row.kind === "account-header";
            const isCollapsible = isHeader && !!row.nodeKey;
            const isCollapsed = row.nodeKey ? collapsed.has(row.nodeKey) : false;
            return (
              <tr key={row.key} className={rowClassName(row.kind)} aria-level={row.kind !== "txn" ? row.depth || undefined : undefined}>
                <td className="px-3.5 py-2 truncate" style={{ paddingLeft: (row.kind !== "txn" ? row.depth * 16 : 0) + 14 }}>
                  <span className="inline-flex items-center gap-1.5">
                    {isCollapsible && (
                      <button onClick={() => onToggle(row.nodeKey!)} aria-expanded={!isCollapsed} aria-label={isCollapsed ? "Expand" : "Collapse"} className="p-0.5 -ml-1 rounded hover:bg-muted/60 print:hidden">
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {c.label}
                  </span>
                </td>
                <td className="px-3.5 py-2 truncate">{c.type}</td>
                <td className="px-3.5 py-2 tabular-nums truncate">{c.date}</td>
                <td className="px-3.5 py-2 font-mono text-xs truncate">{c.num}</td>
                <td className="px-3.5 py-2 text-center" aria-label={c.adj ? "Adjusting entry" : undefined}>{c.adj}</td>
                <td className="px-3.5 py-2 truncate">{c.name}</td>
                <td className="px-3.5 py-2 truncate">{c.memo}</td>
                <td className="px-3.5 py-2 truncate" title={c.split}>{c.split}</td>
                <td className="px-3.5 py-2 text-right font-mono tabular-nums">{c.debit}</td>
                <td className="px-3.5 py-2 text-right font-mono tabular-nums">{c.credit}</td>
                <td className="px-3.5 py-2 text-right font-mono tabular-nums">{c.loading ? "…" : c.balance}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
