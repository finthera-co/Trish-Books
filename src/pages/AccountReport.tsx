import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useJournalEntries } from "@/hooks/useData";
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
import { isDebitNormal, getNormalBalance, getTypeLabel, getStatementPlacement, isOpeningBalanceEquityAccount, typeColors } from "@/lib/accountTypes";
import EditTransactionModal from "@/components/account-report/EditTransactionModal";

interface TransactionRow {
  date: string;
  entryType: string;
  journalNo: string;
  journalEntryId: string;
  reference: string;
  name: string;
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

  // Build transaction rows
  const { rows, openingBalance, totalDebit, totalCredit, closingBalance } = useMemo(() => {
    if (!account || !journalEntries) return { rows: [], openingBalance: 0, totalDebit: 0, totalCredit: 0, closingBalance: 0 };

    const debitNormal = isDebitNormal(account.account_type);
    const postedEntries = (journalEntries as any[]).filter(
      (entry: any) => entry.status === "posted" && !entry.voided_at
    );

    // Opening balance from fiscal period or account
    const ob = matchingPeriod && openingBalances
      ? openingBalances.find((o: any) => o.account_id === account.id && o.fiscal_period_id === matchingPeriod.id)
      : null;
    const historicalOpening = postedEntries
      .filter((entry: any) => entry.entry_date < dateFrom)
      .flatMap((entry: any) => ((entry.journal_lines as any[]) || []).filter((line: any) => line.account_id === account.id))
      .reduce((sum: number, line: any) => {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        return sum + (debitNormal ? debit - credit : credit - debit);
      }, 0);

    const opening = isOBEAccount
      ? historicalOpening
      : ob
        ? Number((ob as any).balance)
        : Number(account.opening_balance) || 0;

    const txRows: TransactionRow[] = postedEntries
      .filter((entry: any) => {
        if (!isOBEAccount && entry.entry_type === "opening_balance") return false; // already represented by the opening balance header row for regular accounts
        if (entry.entry_date < dateFrom || entry.entry_date > dateTo) return false;
        return true;
      })
      .flatMap((entry: any) => {
        const lines = (entry.journal_lines as any[]) || [];
        return lines
          .filter((line) => line.account_id === account.id)
          .map((line) => {
            // Find contra account
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
              name: contraAccount ? contraAccount.account_name : (contraLines.length > 1 ? "— Split —" : ""),
              memo: entry.description || "",
              debit: Number(line.debit) || 0,
              credit: Number(line.credit) || 0,
              balance: 0,
              lineId: line.id,
            };
          });
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.journalNo.localeCompare(b.journalNo));

    // Calculate running balances
    let bal = opening;
    txRows.forEach((row) => {
      bal += debitNormal ? row.debit - row.credit : row.credit - row.debit;
      row.balance = bal;
    });

    // Apply filters
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

    return {
      rows: filtered,
      openingBalance: opening,
      totalDebit: tDebit,
      totalCredit: tCredit,
      closingBalance: bal,
    };
  }, [account, journalEntries, dateFrom, dateTo, search, typeFilter, matchingPeriod, openingBalances, accounts, isOBEAccount]);

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
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
  };

  const handleExportCSV = () => {
    if (!account) return;
    const header = ["Date", "Type", "Journal No", "Reference", "Name", "Memo", "Debit", "Credit", "Balance"];
    const csvRows = rows.map((r) => [
      r.date,
      r.entryType,
      r.journalNo,
      r.reference,
      r.name,
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
            <FileSpreadsheet className="w-4 h-4 mr-1" /> Export CSV
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
                <div className="flex justify-between items-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Opening Balance</p>
                  <p className="text-sm font-mono font-semibold text-foreground">{formatCurrency(openingBalance)}</p>
                </div>
                <div className="border-t border-border" />
                <div className="flex justify-between items-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Current Balance</p>
                  <p className={`text-lg font-mono font-bold ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                    {formatCurrency(closingBalance)}
                  </p>
                </div>
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
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Journal No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Reference</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-32">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Memo</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-28">Debit</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-28">Credit</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-32">Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance row */}
                {openingBalance !== 0 && (
                  <tr className="bg-muted/10 border-b">
                    <td className="px-4 py-2 text-muted-foreground">{dateFrom}</td>
                    <td colSpan={5} className="px-4 py-2 italic text-muted-foreground">Opening Balance</td>
                    <td className="text-right px-4 py-2 font-mono text-muted-foreground">—</td>
                    <td className="text-right px-4 py-2 font-mono text-muted-foreground">—</td>
                    <td className="text-right px-4 py-2 font-mono font-semibold text-foreground">
                      {formatCurrency(openingBalance)}
                    </td>
                  </tr>
                )}

                {entriesLoading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin inline-block" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-muted-foreground">
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
                      <td className="px-4 py-2 text-foreground text-xs">{row.name || "—"}</td>
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
                    <td colSpan={6} className="px-4 py-3 font-semibold text-xs text-foreground">Totals / Closing</td>
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
