import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useJournalEntries } from "@/hooks/useData";
import { useBankImportRefs } from "@/hooks/useBankStatementImport";
import { useFiscalPeriods, usePeriodOpeningBalances } from "@/hooks/useFiscalPeriodBalances";
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
} from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { isDebitNormal, getNormalBalance, getTypeLabel, getStatementPlacement, isOpeningBalanceEquityAccount, isPeriodBasedAccount, typeColors } from "@/lib/accountTypes";
import { netAccountBalance } from "@/lib/accountBalances";
import { downloadDataExcel } from "@/lib/reportExcel";
import EditTransactionModal from "@/components/account-report/EditTransactionModal";

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

export default function AccountReport() {
  const { id: accountId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: accounts } = useAccounts();
  const { data: journalEntries, isLoading: entriesLoading } = useJournalEntries();
  const { data: bankRefs } = useBankImportRefs();
  const { data: periods } = useFiscalPeriods();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editEntry, setEditEntry] = useState<{ journalEntryId: string; lineId: string } | null>(null);

  const account = useMemo(
    () => (accounts || []).find((a: any) => a.id === accountId) as any,
    [accounts, accountId]
  );
  const isOBEAccount = useMemo(() => isOpeningBalanceEquityAccount(account), [account]);

  // Open the ledger showing this account's FULL history. The default window is
  // the last six months, but a ledger reached from the Chart of Accounts must
  // show every posted transaction — including imported prior-period bank
  // statements (e.g. a June-2025 import viewed in 2026), which the six-month
  // default would silently hide. Widen dateFrom to the account's earliest
  // posted entry whenever the account or the underlying data changes; the user
  // can still narrow the range afterwards.
  useEffect(() => {
    if (!journalEntries || !account) return;
    let earliest: string | null = null;
    for (const e of journalEntries as any[]) {
      if (e.status !== "posted" || (e as any).voided_at) continue;
      const touchesAccount = ((e.journal_lines as any[]) || []).some(
        (l: any) => l.account_id === account.id
      );
      if (touchesAccount && (!earliest || e.entry_date < earliest)) earliest = e.entry_date;
    }
    if (earliest && earliest < dateFrom) {
      setDateFrom(earliest.slice(0, 8) + "01"); // first day of that month
    }
    // Intentionally keyed on account + data only: re-widens when either changes,
    // but does not fight a manual date narrowing (deps unchanged between edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, journalEntries, account]);

  // Find matching fiscal period for opening balance
  const matchingPeriod = useMemo(() => {
    if (!periods) return null;
    return (periods as any[]).find(
      (p) => p.period_start <= dateFrom && p.period_end >= dateFrom
    ) || null;
  }, [periods, dateFrom]);

  const { data: openingBalances } = useQuery({
    queryKey: ["opening_balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("opening_balances").select("*");
      if (error) throw error;
      return data;
    },
  });

  // Parent account
  const parentAccount = useMemo(() => {
    if (!account?.parent_account_id || !accounts) return null;
    return (accounts as any[]).find((a) => a.id === account.parent_account_id);
  }, [account, accounts]);

  // Build transaction rows.
  // REPORTING LAYER RULE:
  //   - Balance Sheet accounts (Asset/Liability/Equity) → cumulative view with
  //     opening balance carried forward and a true running balance.
  //   - P&L accounts (Income/Expense/COGS) → period-only view; opening balance
  //     is suppressed and the running balance starts at 0 within the window.
  //   The underlying journal_lines are NEVER modified — this is presentation only.
  const { rows, openingBalance, totalDebit, totalCredit, closingBalance, isPeriodBased } = useMemo(() => {
    if (!account || !journalEntries) return { rows: [], openingBalance: 0, totalDebit: 0, totalCredit: 0, closingBalance: 0, isPeriodBased: false };

    const debitNormal = isDebitNormal(account.account_type);
    const periodBased = isPeriodBasedAccount(account.account_type);
    const postedEntries = (journalEntries as any[]).filter(
      (entry: any) => entry.status === "posted" && !entry.voided_at
    );

    // Express a {debit, credit} pair as a signed balance in the account's normal
    // direction (positive = normal side) using the shared calculator. AccountReport
    // shows the raw account-type direction, so isContra is false here — behaviour
    // is identical to the previous inline `debitNormal ? d - c : c - d`.
    const toSigned = (sides: { debit: number; credit: number }) => {
      const calc = netAccountBalance({
        accountType: account.account_type,
        isContra: false,
        opening: sides,
        movements: { debit: 0, credit: 0 },
      });
      return calc.type === (debitNormal ? "debit" : "credit") ? calc.balance : -calc.balance;
    };

    // For Balance Sheet accounts only: sum of all journal lines BEFORE dateFrom.
    // For P&L accounts: opening balance is conceptually zero (period-based).
    const openingSides = periodBased
      ? { debit: 0, credit: 0 }
      : postedEntries
          .filter((entry: any) => entry.entry_date < dateFrom)
          .flatMap((entry: any) => ((entry.journal_lines as any[]) || []).filter((line: any) => line.account_id === account.id))
          .reduce(
            (acc: { debit: number; credit: number }, line: any) => ({
              debit: acc.debit + (Number(line.debit) || 0),
              credit: acc.credit + (Number(line.credit) || 0),
            }),
            { debit: 0, credit: 0 }
          );

    const opening = toSigned(openingSides);

    const txRows: TransactionRow[] = postedEntries
      .filter((entry: any) => {
        if (entry.entry_date < dateFrom || entry.entry_date > dateTo) return false;
        return true;
      })
      .flatMap((entry: any) => {
        const lines = (entry.journal_lines as any[]) || [];
        return lines
          .filter((line) => line.account_id === account.id)
          .map((line) => {
            const contraLines = lines.filter((l: any) => l.account_id !== account.id);
            const contraAccount = contraLines.length === 1 && accounts
              ? (accounts as any[]).find((a) => a.id === contraLines[0].account_id)
              : null;

            return {
              date: entry.entry_date,
              entryType: entry.entry_type || "manual",
              journalNo: entry.id.slice(0, 8).toUpperCase(),
              journalEntryId: entry.id,
              reference: entry.reference || "",
              chequeNo: bankRefs?.cheque.get(entry.id) || "",
              name: contraAccount ? contraAccount.account_name : (contraLines.length > 1 ? "— Split —" : ""),
              payee: bankRefs?.payee.get(entry.id) || "",
              memo: entry.description || "",
              debit: Number(line.debit) || 0,
              credit: Number(line.credit) || 0,
              balance: 0,
              lineId: line.id,
            };
          });
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.journalNo.localeCompare(b.journalNo));

    // Running balance starts from opening (0 for period-based accounts).
    let bal = opening;
    txRows.forEach((row) => {
      bal += debitNormal ? row.debit - row.credit : row.credit - row.debit;
      row.balance = bal;
    });

    let filtered = txRows;
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.memo.toLowerCase().includes(s) ||
          r.reference.toLowerCase().includes(s) ||
          r.name.toLowerCase().includes(s) ||
          r.journalNo.toLowerCase().includes(s)
      );
    }
    if (typeFilter !== "all") {
      filtered = filtered.filter((r) => r.entryType === typeFilter);
    }

    const tDebit = txRows.reduce((s, r) => s + r.debit, 0);
    const tCredit = txRows.reduce((s, r) => s + r.credit, 0);

    // Closing balance = opening + window movements, through the shared calculator.
    // Equals the final running-balance `bal`; sourced from the helper so the three
    // screens share one balance authority.
    const closingBalance = toSigned({
      debit: openingSides.debit + tDebit,
      credit: openingSides.credit + tCredit,
    });

    return {
      rows: filtered,
      openingBalance: opening,
      totalDebit: tDebit,
      totalCredit: tCredit,
      closingBalance,
      isPeriodBased: periodBased,
    };
  }, [account, journalEntries, dateFrom, dateTo, search, typeFilter, matchingPeriod, openingBalances, accounts, isOBEAccount, bankRefs]);

  const entryTypes = useMemo(() => {
    if (!journalEntries) return [];
    const types = new Set<string>();
    (journalEntries as any[]).forEach((e) => {
      if (e.entry_type) types.add(e.entry_type);
    });
    return Array.from(types);
  }, [journalEntries]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
    queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
  };

  const handleExportCSV = () => {
    if (!account) return;
    const header = ["Date", "Type", "Journal No", "Reference", "Cheque No", "Name", "Payee", "Memo", "Debit", "Credit", "Balance"];
    const csvRows = rows.map((r) => [
      r.date,
      r.entryType,
      r.journalNo,
      r.reference,
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
  };

  const handleExportExcel = () => {
    if (!account) return;
    type ExportRow = {
      date: string; entryType: string; journalNo: string; reference: string;
      name: string; payee: string; chequeNo: string; memo: string;
      debit: number | null; credit: number | null; balance: number;
    };
    const exportRows: ExportRow[] = [
      // Balance Sheet accounts carry an opening balance into the window.
      ...(!isPeriodBased && openingBalance !== 0
        ? [{
            date: dateFrom, entryType: "Opening Balance", journalNo: "", reference: "",
            name: "", payee: "", chequeNo: "", memo: "", debit: null, credit: null, balance: openingBalance,
          }]
        : []),
      ...rows.map((r) => ({
        date: r.date,
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
        dateLine: `${dateFrom} → ${dateTo}`,
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
      <div className="flex items-center justify-between flex-wrap gap-3">
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
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0}>
            <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

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
                  {account.created_at ? format(new Date(account.created_at), "MMM d, yyyy") : "—"}
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
                  placeholder="Search memo, reference, name..."
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
            <table className="w-full text-sm">
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
                {/* Opening balance row — only for cumulative (Balance Sheet) accounts */}
                {!isPeriodBased && openingBalance !== 0 && (
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
                      <td className="px-4 py-2 text-right text-muted-foreground text-xs tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2 text-muted-foreground tabular-nums">{row.date}</td>
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
