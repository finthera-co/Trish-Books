import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useJournalEntries } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Download, Printer, Search, BookOpen, ArrowUpRight, ArrowDownRight, Filter } from "lucide-react";
import { format } from "date-fns";

interface LedgerRow {
  date: string;
  description: string;
  reference: string;
  entryId: string;
  debit: number;
  credit: number;
  balance: number;
  isReversal: boolean;
  isVoided: boolean;
}

const DEBIT_NORMAL_TYPES = ["Asset", "Expense", "COGS"];

const fmtAmount = (n: number): string => {
  if (n === 0) return "—";
  return `LKR ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtBalance = (n: number): string => {
  const abs = Math.abs(n);
  const formatted = `LKR ${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${formatted})` : formatted;
};

export default function Ledger() {
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: journalEntries, isLoading: entriesLoading } = useJournalEntries();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  // Fetch fiscal periods
  const { data: fiscalPeriods } = useQuery({
    queryKey: ["fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("*")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch opening balances
  const { data: openingBalances } = useQuery({
    queryKey: ["opening_balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("opening_balances").select("*");
      if (error) throw error;
      return data;
    },
  });

  const selectedAccount = accounts?.find(a => a.id === selectedAccountId) || accounts?.[0];
  const selectedPeriod = fiscalPeriods?.find(p => p.id === periodFilter);
  const isDebitNormal = selectedAccount ? DEBIT_NORMAL_TYPES.includes(selectedAccount.account_type) : true;

  // Effective date range (period overrides custom dates)
  const effectiveDateFrom = selectedPeriod ? selectedPeriod.period_start : dateFrom;
  const effectiveDateTo = selectedPeriod ? selectedPeriod.period_end : dateTo;

  // Build filtered + sorted ledger rows
  const ledger = useMemo(() => {
    if (!journalEntries || !selectedAccount) return [];

    return journalEntries
      .filter(entry => {
        if (entry.status === "voided" || (entry as any).voided_at) return false;
        if (entry.status !== "posted") return false;
        if (effectiveDateFrom && entry.entry_date < effectiveDateFrom) return false;
        if (effectiveDateTo && entry.entry_date > effectiveDateTo) return false;
        return true;
      })
      .flatMap(entry => {
        const lines = (entry.journal_lines as any[]) || [];
        return lines
          .filter(line => line.account_id === selectedAccount.id)
          .map(line => ({
            date: entry.entry_date,
            description: entry.description,
            reference: entry.reference || "",
            entryId: entry.id,
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            balance: 0,
            isReversal: !!(entry as any).reversal_of,
            isVoided: false,
          }));
      })
      .filter(row => {
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return row.description.toLowerCase().includes(s) || row.reference.toLowerCase().includes(s);
      })
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.reference.localeCompare(b.reference);
      });
  }, [journalEntries, selectedAccount, effectiveDateFrom, effectiveDateTo, searchTerm]);

  // Opening balance from fiscal period carry-forward
  const openingBalance = useMemo(() => {
    if (!selectedAccount || !selectedPeriod || !openingBalances) return 0;
    const ob = openingBalances.find(
      (o: any) => o.account_id === selectedAccount.id && o.fiscal_period_id === selectedPeriod.id
    );
    return ob ? Number((ob as any).balance) : 0;
  }, [selectedAccount, selectedPeriod, openingBalances]);

  // Calculate running balances
  const ledgerWithBalance = useMemo(() => {
    let bal = openingBalance;
    return ledger.map(row => {
      bal += isDebitNormal ? (row.debit - row.credit) : (row.credit - row.debit);
      return { ...row, balance: bal };
    });
  }, [ledger, openingBalance, isDebitNormal]);

  // Totals
  const totalDebit = ledger.reduce((s, r) => s + r.debit, 0);
  const totalCredit = ledger.reduce((s, r) => s + r.credit, 0);
  const closingBalance = ledgerWithBalance.length > 0
    ? ledgerWithBalance[ledgerWithBalance.length - 1].balance
    : openingBalance;
  const netMovement = closingBalance - openingBalance;
  const transactionCount = ledger.length;
  const isLoading = accountsLoading || entriesLoading;

  // Group accounts by type for the selector
  const accountsByType = useMemo(() => {
    if (!accounts) return [];
    const groups = new Map<string, typeof accounts>();
    accounts.forEach(a => {
      if (!groups.has(a.account_type)) groups.set(a.account_type, []);
      groups.get(a.account_type)!.push(a);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [accounts]);

  // CSV Export
  const handleExportCSV = useCallback(() => {
    if (!selectedAccount) return;
    const header = ["Date", "Description", "Reference", "Debit (LKR)", "Credit (LKR)", "Balance (LKR)"];
    const rows = [
      ...(openingBalance !== 0 ? [["", "Opening Balance (carried forward)", "", "", "", openingBalance.toFixed(2)]] : []),
      ...ledgerWithBalance.map(r => [
        r.date,
        r.description.replace(/"/g, '""'),
        r.reference,
        r.debit > 0 ? r.debit.toFixed(2) : "",
        r.credit > 0 ? r.credit.toFixed(2) : "",
        r.balance.toFixed(2),
      ]),
      ["", "TOTALS", "", totalDebit.toFixed(2), totalCredit.toFixed(2), closingBalance.toFixed(2)],
    ];
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${selectedAccount.account_code}-${selectedAccount.account_name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedAccount, ledgerWithBalance, openingBalance, totalDebit, totalCredit, closingBalance]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="page-description">
            Detailed transaction register with running balances per account
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={ledger.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* Account Selector */}
      <div className="stat-card print:shadow-none">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[250px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Account</label>
            <select
              value={selectedAccountId || selectedAccount?.id || ""}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
            >
              {accountsByType.map(([type, accs]) => (
                <optgroup key={type} label={type}>
                  {accs.map(a => (
                    <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="min-w-[200px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period</label>
            <select
              value={periodFilter}
              onChange={(e) => { setPeriodFilter(e.target.value); setDateFrom(""); setDateTo(""); }}
              className="w-full text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
            >
              <option value="all">All Periods</option>
              {fiscalPeriods?.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.status === "closed" ? "🔒" : ""}
                </option>
              ))}
            </select>
          </div>

          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="print:hidden">
            <Filter className="w-4 h-4 mr-1" /> Filters
          </Button>
        </div>

        {/* Advanced filters */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-end gap-4 print:hidden">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">From Date</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPeriodFilter("all"); }}
                className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">To Date</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPeriodFilter("all"); }}
                className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search description or reference..."
                  className="w-full text-sm border border-input rounded-lg pl-9 pr-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground" />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setSearchTerm(""); setPeriodFilter("all"); }}>
              Clear
            </Button>
          </div>
        )}

        {/* Account info bar */}
        {selectedAccount && (
          <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary font-semibold">
              <BookOpen className="w-3 h-3" />
              {selectedAccount.account_code}
            </span>
            <span className="font-medium text-foreground">{selectedAccount.account_name}</span>
            <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
              {selectedAccount.account_type}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              Normal {isDebitNormal ? "Debit" : "Credit"} Balance
            </span>
            {effectiveDateFrom && (
              <span className="text-muted-foreground">
                {effectiveDateFrom} → {effectiveDateTo || "present"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Opening Balance</p>
          <p className="text-lg font-bold text-foreground mt-1">{fmtBalance(openingBalance)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Debits</p>
          <p className="text-lg font-bold text-foreground mt-1">{fmtAmount(totalDebit) === "—" ? "LKR 0.00" : fmtAmount(totalDebit)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Credits</p>
          <p className="text-lg font-bold text-foreground mt-1">{fmtAmount(totalCredit) === "—" ? "LKR 0.00" : fmtAmount(totalCredit)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Net Movement</p>
          <div className="flex items-center gap-1.5 mt-1">
            {netMovement >= 0 ? (
              <ArrowUpRight className="w-4 h-4 text-success" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-destructive" />
            )}
            <p className={`text-lg font-bold ${netMovement >= 0 ? "text-success" : "text-destructive"}`}>
              {fmtBalance(netMovement)}
            </p>
          </div>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Closing Balance</p>
          <p className={`text-lg font-bold mt-1 ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
            {fmtBalance(closingBalance)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{transactionCount} transaction{transactionCount !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="stat-card print:shadow-none overflow-x-auto">
        {/* Print header */}
        <div className="hidden print:block text-center mb-4">
          <h2 className="text-lg font-bold">General Ledger</h2>
          <p className="text-sm text-muted-foreground">
            Account: {selectedAccount?.account_code} — {selectedAccount?.account_name}
            {effectiveDateFrom && ` | ${effectiveDateFrom} to ${effectiveDateTo || "present"}`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generated: {format(new Date(), "PPpp")}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : !accounts?.length ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No accounts found</p>
            <p className="text-sm text-muted-foreground mt-1">Create accounts in Chart of Accounts first.</p>
          </div>
        ) : ledgerWithBalance.length === 0 && openingBalance === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No transactions found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchTerm
                ? `No results matching "${searchTerm}"`
                : selectedPeriod
                  ? `No posted entries in ${selectedPeriod.name}`
                  : "Post journal entries to see activity here."}
            </p>
          </div>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr>
                <th className="w-28">Date</th>
                <th>Description</th>
                <th className="w-32">Reference</th>
                <th className="text-right w-36">Debit (LKR)</th>
                <th className="text-right w-36">Credit (LKR)</th>
                <th className="text-right w-40">Balance (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening balance row */}
              <tr className="bg-muted/30 border-b-2 border-border">
                <td className="text-muted-foreground text-xs">
                  {effectiveDateFrom || "—"}
                </td>
                <td colSpan={2} className="font-medium text-muted-foreground italic text-sm">
                  Opening Balance
                  {selectedPeriod && <span className="text-xs ml-1">(carried forward from prior period)</span>}
                </td>
                <td className="text-right font-mono text-muted-foreground">—</td>
                <td className="text-right font-mono text-muted-foreground">—</td>
                <td className="text-right font-mono font-semibold text-foreground">
                  {fmtBalance(openingBalance)}
                </td>
              </tr>

              {/* Transaction rows */}
              {ledgerWithBalance.map((row, i) => (
                <tr
                  key={`${row.entryId}-${i}`}
                  className={`
                    hover:bg-muted/20 transition-colors
                    ${row.isReversal ? "bg-destructive/5" : ""}
                  `}
                >
                  <td className="text-muted-foreground text-sm tabular-nums">{row.date}</td>
                  <td className="text-foreground text-sm">
                    <span className="font-medium">{row.description}</span>
                    {row.isReversal && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-destructive/10 text-destructive">
                        REVERSAL
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">{row.reference || "—"}</td>
                  <td className="text-right font-mono text-sm tabular-nums">
                    {row.debit > 0 ? (
                      <span className="text-foreground">{row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="text-right font-mono text-sm tabular-nums">
                    {row.credit > 0 ? (
                      <span className="text-foreground">{row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className={`text-right font-mono text-sm tabular-nums font-semibold ${
                    row.balance < 0 ? "text-destructive" : "text-foreground"
                  }`}>
                    {fmtBalance(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Footer totals */}
            <tfoot>
              <tr className="border-t-2 border-foreground/20">
                <td colSpan={3} className="font-bold text-foreground text-sm">
                  Period Totals
                </td>
                <td className="text-right font-mono font-bold text-sm tabular-nums text-foreground">
                  {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="text-right font-mono font-bold text-sm tabular-nums text-foreground">
                  {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                  —
                </td>
              </tr>
              <tr className="border-t border-foreground/10">
                <td colSpan={3} className="font-bold text-foreground text-sm">
                  Closing Balance
                </td>
                <td className="text-right" colSpan={2}></td>
                <td className={`text-right font-mono font-bold text-sm tabular-nums ${
                  closingBalance < 0 ? "text-destructive" : "text-foreground"
                }`}>
                  {fmtBalance(closingBalance)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* T-Account Summary */}
      {selectedAccount && ledger.length > 0 && (
        <div className="stat-card print:shadow-none">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            T-Account Summary — {selectedAccount.account_code} {selectedAccount.account_name}
          </h3>
          <div className="grid grid-cols-2 border-2 border-foreground/20 rounded-lg overflow-hidden">
            <div className="border-r border-foreground/20 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-center text-muted-foreground mb-3">Debit</p>
              <div className="space-y-1.5 text-sm">
                {openingBalance > 0 && isDebitNormal && (
                  <div className="flex justify-between text-muted-foreground italic">
                    <span>Opening bal.</span>
                    <span className="font-mono tabular-nums">{openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {ledger.filter(r => r.debit > 0).map((r, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-muted-foreground truncate mr-2">{r.description}</span>
                    <span className="font-mono tabular-nums text-foreground">{r.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
                <div className="border-t border-foreground/20 pt-1.5 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">
                    {(totalDebit + (openingBalance > 0 && isDebitNormal ? openingBalance : 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-center text-muted-foreground mb-3">Credit</p>
              <div className="space-y-1.5 text-sm">
                {openingBalance > 0 && !isDebitNormal && (
                  <div className="flex justify-between text-muted-foreground italic">
                    <span>Opening bal.</span>
                    <span className="font-mono tabular-nums">{openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {ledger.filter(r => r.credit > 0).map((r, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-muted-foreground truncate mr-2">{r.description}</span>
                    <span className="font-mono tabular-nums text-foreground">{r.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
                <div className="border-t border-foreground/20 pt-1.5 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">
                    {(totalCredit + (openingBalance > 0 && !isDebitNormal ? openingBalance : 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className={`mt-3 px-4 py-2 rounded-lg text-sm font-medium text-center ${
            closingBalance < 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
          }`}>
            Closing Balance: {fmtBalance(closingBalance)} ({isDebitNormal ? "Debit" : "Credit"} Normal)
          </div>
        </div>
      )}
    </div>
  );
}
