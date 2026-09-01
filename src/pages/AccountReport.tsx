import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useAccounts,
  useAccountLedgerPage,
  useAccountLedgerTotals,
  useAccountLedgerFacets,
  useAccountOpeningBalance,
  useAccountEarliestEntryDate,
  fetchAccountLedgerAll,
  type AccountLedgerPageRow,
} from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Download,
  Printer,
  RefreshCw,
  FileSpreadsheet,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { isDebitNormal, getNormalBalance, getTypeLabel, getStatementPlacement, isOpeningBalanceEquityAccount, isPeriodBasedAccount, typeColors } from "@/lib/accountTypes";
import { netAccountBalance } from "@/lib/accountBalances";
import { downloadDataExcel } from "@/lib/reportExcel";
import { resolveLineMemo } from "@/lib/journalValidation";
import { ReportMasthead } from "@/components/reports/ReportMasthead";
import EditTransactionModal from "@/components/account-report/EditTransactionModal";
import { formatDate } from "@/lib/format";
import { usePageTitle } from "@/hooks/usePageTitle";

interface TransactionRow {
  date: string;
  entryType: string;
  journalNo: string;
  journalEntryId: string;
  reference: string;
  chequeNo: string;
  name: string;
  payee: string;
  memo: string;
  debit: number;
  credit: number;
  balance: number;
  lineId: string;
}

const PAGE_SIZE = 50;

/**
 * One account_ledger_page row → one grid row.
 *
 * The running balance comes from the server's cumulative sums over the whole
 * date window in ledger order, so it does not depend on which rows this page
 * happens to hold or on what the search filtered out.
 */
function toTransactionRow(
  line: AccountLedgerPageRow,
  openingSides: { debit: number; credit: number },
  toSigned: (sides: { debit: number; credit: number }) => number,
): TransactionRow {
  const contraLines = line.contra_lines || [];
  const contraAccount = contraLines.length === 1 ? contraLines[0] : null;
  const cheque = (line.cheque || "").trim();
  // Bank imports store the cheque in reference too; show it only in the
  // dedicated Cheque column, not duplicated in Reference.
  const reference = line.reference && line.reference.trim() !== cheque ? line.reference : "";

  return {
    date: line.entry_date,
    entryType: line.entry_type || "manual",
    journalNo: line.entry_id.slice(0, 8).toUpperCase(),
    journalEntryId: line.entry_id,
    reference,
    chequeNo: cheque,
    name: contraAccount ? (contraAccount.account_name || "") : (contraLines.length > 1 ? "— Split —" : ""),
    payee: (line.payee || "").trim(),
    // The line's own narration when it has one, else the entry's — the same
    // rule the General Ledger applies.
    memo: resolveLineMemo(line.line_memo, line.description),
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0,
    balance: toSigned({
      debit: openingSides.debit + Number(line.cum_debit ?? 0),
      credit: openingSides.credit + Number(line.cum_credit ?? 0),
    }),
    lineId: line.line_id,
  };
}

export default function AccountReport() {
  const { id: accountId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: accounts } = useAccounts();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [editEntry, setEditEntry] = useState<{ journalEntryId: string; lineId: string } | null>(null);

  // Keystrokes shouldn't immediately re-run the search/type filter.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any change to what is being listed puts the reader back on page 1 —
  // otherwise a narrowed filter can leave them stranded past the last page.
  useEffect(() => {
    setPage(0);
  }, [accountId, dateFrom, dateTo, debouncedSearch, typeFilter]);

  const account = useMemo(
    () => (accounts || []).find((a: any) => a.id === accountId) as any,
    [accounts, accountId]
  );
  const isOBEAccount = useMemo(() => isOpeningBalanceEquityAccount(account), [account]);

  usePageTitle(account ? `${account.account_code} ${account.account_name}` : null);

  // One page of the register at a time. account_ledger_page resolves the
  // search, the type filter, the running balance and the row count
  // server-side. The whole-window fetch this replaced rendered every line as a
  // <tr> — on an imported bank account (30k+ lines) that was a 20MB download,
  // and before max_rows was raised PostgREST silently cut it off at 1000 rows,
  // so the register showed a fraction of the account with totals to match.
  const { data: ledgerPage, isLoading: entriesLoading } = useAccountLedgerPage({
    accountId,
    dateFrom,
    dateTo,
    search: debouncedSearch,
    entryType: typeFilter,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: windowTotals } = useAccountLedgerTotals(accountId, dateFrom, dateTo);
  const { data: facets } = useAccountLedgerFacets(accountId, dateFrom, dateTo);
  const { data: openingBalanceData } = useAccountOpeningBalance(accountId, dateFrom);
  const { data: earliestEntryDate } = useAccountEarliestEntryDate(accountId);

  // Open the ledger showing this account's FULL history. The default window is
  // the last six months, but a ledger reached from the Chart of Accounts must
  // show every posted transaction — including imported prior-period bank
  // statements (e.g. a June-2025 import viewed in 2026), which the six-month
  // default would silently hide. Widen dateFrom to the account's earliest
  // posted entry whenever the account or the underlying data changes; the user
  // can still narrow the range afterwards.
  useEffect(() => {
    if (!earliestEntryDate || !account) return;
    if (earliestEntryDate < dateFrom) {
      setDateFrom(earliestEntryDate.slice(0, 8) + "01"); // first day of that month
    }
    // Intentionally keyed on account + data only: re-widens when either changes,
    // but does not fight a manual date narrowing (deps unchanged between edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, earliestEntryDate, account]);

  // Parent account
  const parentAccount = useMemo(() => {
    if (!account?.parent_account_id || !accounts) return null;
    return (accounts as any[]).find((a) => a.id === account.parent_account_id);
  }, [account, accounts]);

  // REPORTING LAYER RULE:
  //   - Balance Sheet accounts (Asset/Liability/Equity) → cumulative view with
  //     opening balance carried forward and a true running balance.
  //   - P&L accounts (Income/Expense/COGS) → period-only view; opening balance
  //     is suppressed and the running balance starts at 0 within the window.
  //   The underlying journal_lines are NEVER modified — this is presentation only.
  const isPeriodBased = account ? isPeriodBasedAccount(account.account_type) : false;

  const { toSigned, openingSides, openingBalance } = useMemo(() => {
    const zero = { debit: 0, credit: 0 };
    if (!account) {
      return { toSigned: () => 0, openingSides: zero, openingBalance: 0 };
    }

    const debitNormal = isDebitNormal(account.account_type);

    // Express a {debit, credit} pair as a signed balance in the account's normal
    // direction (positive = normal side) using the shared calculator. AccountReport
    // shows the raw account-type direction, so isContra is false here — behaviour
    // is identical to the previous inline `debitNormal ? d - c : c - d`.
    const signed = (sides: { debit: number; credit: number }) => {
      const calc = netAccountBalance({
        accountType: account.account_type,
        isContra: false,
        opening: sides,
        movements: { debit: 0, credit: 0 },
      });
      return calc.type === (debitNormal ? "debit" : "credit") ? calc.balance : -calc.balance;
    };

    // For Balance Sheet accounts only: sum of all journal lines BEFORE dateFrom,
    // computed server-side by account_opening_balance. For P&L accounts: opening
    // balance is conceptually zero (period-based).
    const sides = isPeriodBasedAccount(account.account_type)
      ? zero
      : { debit: openingBalanceData?.debit ?? 0, credit: openingBalanceData?.credit ?? 0 };

    return { toSigned: signed, openingSides: sides, openingBalance: signed(sides) };
  }, [account, openingBalanceData]);

  // The page's rows. Filtering, ordering and the cumulative sums behind the
  // running balance all happened server-side; each row's balance is opening +
  // its cumulative movement, which is why it stays correct on page 600.
  const rows = useMemo<TransactionRow[]>(
    () => (ledgerPage?.rows ?? []).map((line) => toTransactionRow(line, openingSides, toSigned)),
    [ledgerPage, openingSides, toSigned]
  );

  // Totals span the whole date window, not the page and not the search — same
  // as before, when they were summed from every row the client had loaded.
  const totalDebit = windowTotals?.totalDebit ?? 0;
  const totalCredit = windowTotals?.totalCredit ?? 0;
  const closingBalance = toSigned({
    debit: openingSides.debit + totalDebit,
    credit: openingSides.credit + totalCredit,
  });

  const matchingRows = ledgerPage?.filteredRows ?? 0;
  const totalPages = Math.max(1, Math.ceil(matchingRows / PAGE_SIZE));
  const firstRowIndex = page * PAGE_SIZE;

  const entryTypes = facets?.entryTypes ?? [];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
    queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  // The grid holds one page; an export is expected to hold everything that
  // matches the current filters, so it fetches the full set on demand.
  const fetchExportRows = async (): Promise<TransactionRow[]> => {
    const lines = await fetchAccountLedgerAll({
      accountId,
      dateFrom,
      dateTo,
      search: debouncedSearch,
      entryType: typeFilter,
    });
    return lines.map((line) => toTransactionRow(line, openingSides, toSigned));
  };

  const handleExportCSV = async () => {
    if (!account) return;
    setExporting(true);
    try {
      const exportRows = await fetchExportRows();
      const header = ["Date", "Type", "Journal No", "Reference", "Cheque No", "Name", "Payee", "Memo", "Debit", "Credit", "Balance"];
      const csvRows = exportRows.map((r) => [
        formatDate(r.date),
        r.entryType,
        r.journalNo,
        r.reference,
        r.chequeNo,
        r.name,
        `"${(r.payee || "").replace(/"/g, '""')}"`,
        `"${r.memo.replace(/"/g, '""')}"`,
        r.debit > 0 ? r.debit.toFixed(2) : "",
        r.credit > 0 ? r.credit.toFixed(2) : "",
        r.balance.toFixed(2),
      ]);
      const csv = [header, ...csvRows].map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${account.account_code}-${account.account_name}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = async () => {
    if (!account) return;
    type ExportRow = {
      date: string; entryType: string; journalNo: string; reference: string;
      name: string; payee: string; chequeNo: string; memo: string;
      debit: number | null; credit: number | null; balance: number;
    };
    setExporting(true);
    try {
      const allRows = await fetchExportRows();
      const exportRows: ExportRow[] = [
        // Balance Sheet accounts carry an opening balance into the window.
        ...(!isPeriodBased && openingBalance !== 0
          ? [{
              date: formatDate(dateFrom), entryType: "Opening Balance", journalNo: "", reference: "",
              name: "", payee: "", chequeNo: "", memo: "", debit: null, credit: null, balance: openingBalance,
            }]
          : []),
        ...allRows.map((r) => ({
          date: formatDate(r.date),
          entryType: r.entryType,
          journalNo: r.journalNo,
          reference: r.reference,
          chequeNo: r.chequeNo,
          name: r.name,
          payee: r.payee,
          memo: r.memo,
          debit: r.debit > 0 ? r.debit : null,
          credit: r.credit > 0 ? r.credit : null,
          balance: r.balance,
        })),
      ];

      downloadDataExcel<ExportRow>(
        {
          title: `Account Report — ${account.account_code} ${account.account_name}`,
          subtitle: getTypeLabel(account.account_type),
          dateLine: `${formatDate(dateFrom)} → ${formatDate(dateTo)}`,
          sheetName: `${account.account_code} Report`,
          fileName: `${account.account_code} ${account.account_name} Report.xlsx`,
        },
        [
          { header: "Date", value: (r) => r.date },
          { header: "Type", value: (r) => r.entryType },
          { header: "Journal No", value: (r) => r.journalNo },
          { header: "Reference", value: (r) => r.reference },
          { header: "Cheque No", value: (r) => r.chequeNo },
          { header: "Name", value: (r) => r.name },
          { header: "Payee", value: (r) => r.payee },
          { header: "Memo", value: (r) => r.memo },
          { header: "Debit", numeric: true, value: (r) => r.debit },
          { header: "Credit", numeric: true, value: (r) => r.credit },
          { header: "Balance", numeric: true, value: (r) => r.balance },
        ],
        exportRows,
        ["", "TOTALS", "", "", "", "", totalDebit, totalCredit, closingBalance],
      );
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  if (!account) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold text-foreground">Account Report</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={matchingRows === 0 || exporting}>
            <Download className="w-4 h-4 mr-1" /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={matchingRows === 0 || exporting}>
            <FileSpreadsheet className="w-4 h-4 mr-1" /> {exporting ? "Exporting…" : "Export Excel"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* Statement heading — the same block every other report carries, so a
          printed account ledger stands on its own as a document. */}
      <ReportMasthead
        title="Account Ledger"
        subtitle={`${account.account_code} · ${account.account_name}`}
        dateFrom={dateFrom}
        dateTo={dateTo}
        currency="LKR"
        scope={[
          { label: "Account type", value: getTypeLabel(account.account_type) },
          { label: "Normal balance", value: getNormalBalance(account.account_type) },
          { label: "Statement", value: getStatementPlacement(account.account_type) },
          typeFilter !== "all" && { label: "Transaction type", value: typeFilter.replace(/_/g, " ") },
          debouncedSearch && { label: "Search", value: `"${debouncedSearch}"` },
        ]}
        note={
          isPeriodBased
            ? "Income and expense accounts are period-based; no opening balance is carried into this window."
            : null
        }
      />

      {/* Account Details Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            {/* Left Column */}
            <div className="space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Account Name</p>
                <p className="text-lg font-bold text-foreground">{account.account_name}</p>
              </div>
              <div className="flex gap-6">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Account Code</p>
                  <p className="text-sm font-mono font-semibold text-foreground">{account.account_code}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Account Type</p>
                  <Badge className={`${typeColors[account.account_type] || "bg-muted text-muted-foreground"} text-xs`}>
                    {getTypeLabel(account.account_type)}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Category</p>
                  <p className="text-sm text-foreground">{(account as any).account_categories?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Detail Type</p>
                  <p className="text-sm text-foreground">{account.account_subtype || "—"}</p>
                </div>
              </div>
            </div>

            {/* Middle Column */}
            <div className="space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Parent Account</p>
                <p className="text-sm text-foreground">
                  {parentAccount ? `${parentAccount.account_code} — ${parentAccount.account_name}` : "— None —"}
                </p>
              </div>
              <div className="flex gap-6">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Normal Balance</p>
                  <p className="text-sm text-foreground">{getNormalBalance(account.account_type)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Statement</p>
                  <p className="text-sm text-foreground">{getStatementPlacement(account.account_type)}</p>
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Created</p>
                <p className="text-sm text-muted-foreground">
                  {account.created_at ? formatDate(account.created_at) : "—"}
                </p>
              </div>
            </div>

            {/* Right Column — Balances */}
            <div className="space-y-3">
              <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                {!isPeriodBased && (
                  <>
                    <div className="flex justify-between items-center">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Opening Balance</p>
                      <p className="text-sm font-mono font-semibold text-foreground">{formatCurrency(openingBalance)}</p>
                    </div>
                    <div className="border-t border-border" />
                  </>
                )}
                <div className="flex justify-between items-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                    {isPeriodBased ? "Period Total" : "Current Balance"}
                  </p>
                  <p className={`text-lg font-mono font-bold ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                    {formatCurrency(closingBalance)}
                  </p>
                </div>
                {isPeriodBased && (
                  <p className="text-[10px] text-muted-foreground italic">
                    Income & Expense accounts reset each fiscal year. Showing activity within the selected period only.
                  </p>
                )}
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Currency</p>
                  <p className="text-sm font-semibold text-foreground">LKR</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Status</p>
                  <Badge variant={account.is_active ? "default" : "secondary"} className="text-xs">
                    {account.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 block">
                <Calendar className="w-3 h-3 inline mr-1" />From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 block">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 block">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {entryTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 block">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search memo, reference, name, cheque, amount..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm report-table report-table--grid">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-12">#</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Journal No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Reference</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Cheque No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-32">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-32">Payee</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Memo</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-28">Debit</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-28">Credit</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-32">Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance row — only for cumulative (Balance Sheet)
                    accounts, and only on the first page, where the window
                    actually starts. */}
                {!isPeriodBased && openingBalance !== 0 && page === 0 && (
                  <tr className="bg-muted/10 border-b">
                    <td className="px-4 py-2 text-right text-muted-foreground/50 text-xs tabular-nums">—</td>
                    <td className="px-4 py-2 text-muted-foreground">{dateFrom}</td>
                    <td colSpan={7} className="px-4 py-2 italic text-muted-foreground">Opening Balance</td>
                    <td className="text-right px-4 py-2 font-mono text-muted-foreground">—</td>
                    <td className="text-right px-4 py-2 font-mono text-muted-foreground">—</td>
                    <td className="text-right px-4 py-2 font-mono font-semibold text-foreground">
                      {formatCurrency(openingBalance)}
                    </td>
                  </tr>
                )}

                {entriesLoading ? (
                  <tr>
                    <td colSpan={12} className="text-center py-12">
                      <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin inline-block" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center py-12 text-muted-foreground">
                      No transactions found for this period
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr
                      key={`${row.lineId}-${i}`}
                      className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setEditEntry({ journalEntryId: row.journalEntryId, lineId: row.lineId })}
                    >
                      <td className="px-4 py-2 text-right text-muted-foreground text-xs tabular-nums">{firstRowIndex + i + 1}</td>
                      <td className="px-4 py-2 text-muted-foreground tabular-nums">{formatDate(row.date)}</td>
                      <td className="px-4 py-2">
                        <span className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded capitalize">
                          {row.entryType.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-primary cursor-pointer hover:underline"
                        onClick={(e) => { e.stopPropagation(); navigate(`/accounting/journals/${row.journalEntryId}`); }}>
                        {row.journalNo}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.reference || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-foreground">{row.chequeNo || "—"}</td>
                      <td className="px-4 py-2 text-foreground text-xs">{row.name || "—"}</td>
                      <td className="px-4 py-2 text-foreground text-xs">{row.payee || "—"}</td>
                      <td className="px-4 py-2 text-foreground">{row.memo}</td>
                      <td className="text-right px-4 py-2 font-mono tabular-nums">
                        {row.debit > 0 ? formatCurrency(row.debit) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="text-right px-4 py-2 font-mono tabular-nums">
                        {row.credit > 0 ? formatCurrency(row.credit) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className={`text-right px-4 py-2 font-mono tabular-nums font-semibold ${row.balance < 0 ? "text-destructive" : "text-foreground"}`}>
                        {formatCurrency(row.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-foreground/20 bg-muted/20">
                    <td colSpan={9} className="px-4 py-3 font-semibold text-xs text-foreground">{isPeriodBased ? "Period Total" : "Totals / Closing"}</td>
                    <td className="text-right px-4 py-3 font-mono font-bold text-foreground tabular-nums">
                      {totalDebit > 0 ? formatCurrency(totalDebit) : "—"}
                    </td>
                    <td className="text-right px-4 py-3 font-mono font-bold text-foreground tabular-nums">
                      {totalCredit > 0 ? formatCurrency(totalCredit) : "—"}
                    </td>
                    <td className={`text-right px-4 py-3 font-mono font-bold tabular-nums ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                      {formatCurrency(closingBalance)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination — the register is paged server-side, so this walks
              account_ledger_page rather than a fully loaded array. */}
          {matchingRows > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2 border-t px-4 py-3 print:hidden">
              <p className="text-xs text-muted-foreground">
                Showing {firstRowIndex + 1}–{Math.min(firstRowIndex + rows.length, matchingRows)} of{" "}
                {matchingRows.toLocaleString()} transactions
              </p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(0)}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  Page {page + 1} of {totalPages.toLocaleString()}
                </span>
                <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Transaction Modal */}
      {editEntry && (
        <EditTransactionModal
          open={!!editEntry}
          onOpenChange={(open) => !open && setEditEntry(null)}
          journalEntryId={editEntry.journalEntryId}
          highlightLineId={editEntry.lineId}
          onSaved={handleRefresh}
        />
      )}
    </div>
  );
}
