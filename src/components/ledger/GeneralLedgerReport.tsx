import { useState, useMemo, Fragment } from "react";
import { useAccounts, useJournalEntries } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Download, Printer, BookOpen, Filter } from "lucide-react";
import { format } from "date-fns";
import { isDebitNormal as checkDebitNormal, ACCOUNT_TYPES, getTypeLabel } from "@/lib/accountTypes";

const fmtAmount = (n: number): string => {
  if (n === 0) return "—";
  return `LKR ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtBalance = (n: number): string => {
  const abs = Math.abs(n);
  const formatted = `LKR ${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${formatted})` : formatted;
};

interface AccountLedger {
  account: { id: string; code: string; name: string; type: string };
  openingBalance: number;
  rows: { date: string; description: string; reference: string; debit: number; credit: number; balance: number }[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

export default function GeneralLedgerReport() {
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: journalEntries, isLoading: entriesLoading } = useJournalEntries();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());




  const accountLedgers: AccountLedger[] = useMemo(() => {
    if (!accounts || !journalEntries) return [];

    const filteredAccounts = typeFilter === "all"
      ? accounts
      : accounts.filter(a => a.account_type === typeFilter);

    const sorted = [...filteredAccounts].sort((a, b) => a.account_code.localeCompare(b.account_code));

    const postedEntries = (journalEntries as any[]).filter(
      (entry: any) => entry.status === "posted" && !(entry as any).voided_at
    );

    return sorted.map(account => {
      const isDebitNormal = checkDebitNormal(account.account_type);

      // Opening balance = sum of all journal lines for this account BEFORE dateFrom
      // This is the single source of truth — no separate opening_balances table lookup
      const openingBalance = postedEntries
        .filter((entry: any) => entry.entry_date < dateFrom)
        .flatMap((entry: any) => ((entry.journal_lines as any[]) || []).filter((line: any) => line.account_id === account.id))
        .reduce((sum: number, line: any) => {
          const debit = Number(line.debit) || 0;
          const credit = Number(line.credit) || 0;
          return sum + (isDebitNormal ? debit - credit : credit - debit);
        }, 0);

      const rows = postedEntries
        .filter(entry => {
          if (entry.status !== "posted" || (entry as any).voided_at) return false;
          if (entry.entry_date < dateFrom || entry.entry_date > dateTo) return false;
          return true;
        })
        .flatMap(entry => {
          const lines = (entry.journal_lines as any[]) || [];
          return lines
            .filter(line => line.account_id === account.id)
            .map(line => ({
              date: entry.entry_date,
              description: entry.description,
              reference: entry.reference || "",
              debit: Number(line.debit) || 0,
              credit: Number(line.credit) || 0,
              balance: 0,
            }));
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      // Calculate running balances
      let bal = openingBalance;
      rows.forEach(row => {
        bal += isDebitNormal ? (row.debit - row.credit) : (row.credit - row.debit);
        row.balance = bal;
      });

      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

      return {
        account: { id: account.id, code: account.account_code, name: account.account_name, type: account.account_type },
        openingBalance,
        rows,
        totalDebit,
        totalCredit,
        closingBalance: bal,
      };
    }).filter(al => al.rows.length > 0 || al.openingBalance !== 0);
  }, [accounts, journalEntries, dateFrom, dateTo, typeFilter, matchingPeriod, openingBalances]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const collapseAll = () => setCollapsed(new Set(accountLedgers.map(al => al.account.id)));
  const expandAll = () => setCollapsed(new Set());

  const grandTotalDebit = accountLedgers.reduce((s, al) => s + al.totalDebit, 0);
  const grandTotalCredit = accountLedgers.reduce((s, al) => s + al.totalCredit, 0);

  const handleExportCSV = () => {
    const header = ["Account Code", "Account Name", "Date", "Description", "Reference", "Debit", "Credit", "Balance"];
    const rows: string[][] = [];
    accountLedgers.forEach(al => {
      if (al.openingBalance !== 0) {
        rows.push([al.account.code, al.account.name, "", "Opening Balance", "", "", "", al.openingBalance.toFixed(2)]);
      }
      al.rows.forEach(r => {
        rows.push([al.account.code, al.account.name, r.date, r.description.replace(/"/g, '""'), r.reference, r.debit > 0 ? r.debit.toFixed(2) : "", r.credit > 0 ? r.credit.toFixed(2) : "", r.balance.toFixed(2)]);
      });
      rows.push([al.account.code, al.account.name, "", "Closing Balance", "", al.totalDebit.toFixed(2), al.totalCredit.toFixed(2), al.closingBalance.toFixed(2)]);
      rows.push([]);
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `general-ledger-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLoading = accountsLoading || entriesLoading;

  // Group by account type for display
  const groupedByType = useMemo(() => {
    const typeOrder = [...ACCOUNT_TYPES] as string[];
    const groups = new Map<string, AccountLedger[]>();
    accountLedgers.forEach(al => {
      if (!groups.has(al.account.type)) groups.set(al.account.type, []);
      groups.get(al.account.type)!.push(al);
    });
    return typeOrder.filter(t => groups.has(t)).map(t => ({ type: t, ledgers: groups.get(t)! }));
  }, [accountLedgers]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="stat-card print:shadow-none">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div className="min-w-[180px]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Account Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="w-full text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
              <option value="all">All Types</option>
              {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
            <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={accountLedgers.length === 0}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Accounts with Activity</p>
          <p className="text-xl font-bold text-foreground mt-1">{accountLedgers.length}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Transactions</p>
          <p className="text-xl font-bold text-foreground mt-1">{accountLedgers.reduce((s, al) => s + al.rows.length, 0)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Debits</p>
          <p className="text-xl font-bold text-foreground mt-1">{fmtAmount(grandTotalDebit)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Credits</p>
          <p className="text-xl font-bold text-foreground mt-1">{fmtAmount(grandTotalCredit)}</p>
        </div>
      </div>

      {/* Report Body */}
      <div className="stat-card print:shadow-none">
        <div className="text-center mb-6 print:mb-4">
          <h2 className="text-lg font-bold text-foreground">General Ledger Report</h2>
          <p className="text-sm text-muted-foreground">
            {format(new Date(dateFrom), "MMM d, yyyy")} — {format(new Date(dateTo), "MMM d, yyyy")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Generated: {format(new Date(), "PPpp")}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : accountLedgers.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No transactions found for this period</p>
          </div>
        ) : (
          <div className="space-y-1">
            {groupedByType.map(group => (
              <Fragment key={group.type}>
                <div className="bg-muted/60 px-4 py-2 rounded-md">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{group.type}</span>
                </div>
                {group.ledgers.map(al => {
                  const isCollapsed = collapsed.has(al.account.id);
                  return (
                    <div key={al.account.id} className="border border-border rounded-lg overflow-hidden mb-3">
                      {/* Account header */}
                      <button
                        onClick={() => toggleCollapse(al.account.id)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <BookOpen className="w-4 h-4 text-primary" />
                          <span className="font-mono text-xs text-muted-foreground">{al.account.code}</span>
                          <span className="font-semibold text-foreground text-sm">{al.account.name}</span>
                          <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px] font-medium">
                            {getTypeLabel(al.account.type)}
                          </span>
                          <span className="text-xs text-muted-foreground">{al.rows.length} txn{al.rows.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-mono font-semibold text-foreground">{fmtBalance(al.closingBalance)}</span>
                          <span className={`text-xs transition-transform ${isCollapsed ? "" : "rotate-180"}`}>▼</span>
                        </div>
                      </button>

                      {/* Transaction table */}
                      {!isCollapsed && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-border bg-muted/20">
                              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-28">Date</th>
                              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Description</th>
                              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-28">Reference</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground w-32">Debit</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground w-32">Credit</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground w-36">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {al.openingBalance !== 0 && (
                              <tr className="bg-muted/10 border-b border-border">
                                <td className="px-4 py-1.5 text-muted-foreground text-xs">{dateFrom}</td>
                                <td colSpan={2} className="px-4 py-1.5 italic text-muted-foreground">Opening Balance</td>
                                <td className="text-right px-4 py-1.5 font-mono text-muted-foreground">—</td>
                                <td className="text-right px-4 py-1.5 font-mono text-muted-foreground">—</td>
                                <td className="text-right px-4 py-1.5 font-mono font-semibold text-foreground">{fmtBalance(al.openingBalance)}</td>
                              </tr>
                            )}
                            {al.rows.map((row, i) => (
                              <tr key={i} className="border-b border-border/50 hover:bg-muted/10">
                                <td className="px-4 py-1.5 text-muted-foreground tabular-nums">{row.date}</td>
                                <td className="px-4 py-1.5 text-foreground">{row.description}</td>
                                <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">{row.reference || "—"}</td>
                                <td className="text-right px-4 py-1.5 font-mono tabular-nums">
                                  {row.debit > 0 ? row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className="text-right px-4 py-1.5 font-mono tabular-nums">
                                  {row.credit > 0 ? row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className={`text-right px-4 py-1.5 font-mono tabular-nums font-semibold ${row.balance < 0 ? "text-destructive" : "text-foreground"}`}>
                                  {fmtBalance(row.balance)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-border bg-muted/20">
                              <td colSpan={3} className="px-4 py-2 font-semibold text-foreground text-xs">Totals / Closing</td>
                              <td className="text-right px-4 py-2 font-mono font-bold text-foreground tabular-nums">
                                {al.totalDebit > 0 ? al.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                              </td>
                              <td className="text-right px-4 py-2 font-mono font-bold text-foreground tabular-nums">
                                {al.totalCredit > 0 ? al.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                              </td>
                              <td className={`text-right px-4 py-2 font-mono font-bold tabular-nums ${al.closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                                {fmtBalance(al.closingBalance)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
