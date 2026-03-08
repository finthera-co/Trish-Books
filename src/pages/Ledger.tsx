import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useJournalEntries } from "@/hooks/useData";

export default function Ledger() {
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: journalEntries, isLoading: entriesLoading } = useJournalEntries();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [periodFilter, setPeriodFilter] = useState<string>("all");

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
      const { data, error } = await supabase
        .from("opening_balances")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  const selectedAccount = accounts?.find(a => a.id === selectedAccountId) || accounts?.[0];
  const selectedPeriod = fiscalPeriods?.find(p => p.id === periodFilter);

  // Determine normal balance direction
  const isDebitNormal = selectedAccount
    ? ["Asset", "Expense", "COGS"].includes(selectedAccount.account_type)
    : true;

  // Build ledger from journal entries, filtering voided entries
  const ledger = useMemo(() => {
    if (!journalEntries || !selectedAccount) return [];

    return journalEntries
      .filter(entry => {
        // Skip voided entries
        if (entry.status === "voided" || (entry as any).voided_at) return false;
        // Only posted entries
        if (entry.status !== "posted") return false;
        // Period filter
        if (selectedPeriod) {
          if (entry.entry_date < selectedPeriod.period_start || entry.entry_date > selectedPeriod.period_end) return false;
        }
        return true;
      })
      .flatMap(entry => {
        const lines = (entry.journal_lines as any[]) || [];
        return lines
          .filter(line => line.account_id === selectedAccount.id)
          .map(line => ({
            date: entry.entry_date,
            description: entry.description,
            reference: entry.reference || "-",
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            isReversal: !!(entry as any).reversal_of,
          }));
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [journalEntries, selectedAccount, selectedPeriod]);

  // Get opening balance for selected account + period
  const openingBalance = useMemo(() => {
    if (!selectedAccount || !selectedPeriod || !openingBalances) return 0;
    const ob = openingBalances.find(
      (o: any) => o.account_id === selectedAccount.id && o.fiscal_period_id === selectedPeriod.id
    );
    return ob ? Number((ob as any).balance) : 0;
  }, [selectedAccount, selectedPeriod, openingBalances]);

  // Calculate running balance
  let balance = openingBalance;
  const ledgerWithBalance = ledger.map(row => {
    if (isDebitNormal) {
      balance += row.debit - row.credit;
    } else {
      balance += row.credit - row.debit;
    }
    return { ...row, balance };
  });

  const closingBalance = balance;
  const netMovement = closingBalance - openingBalance;
  const isLoading = accountsLoading || entriesLoading;

  const fmt = (n: number) => {
    const abs = Math.abs(n);
    const formatted = `LKR ${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return n < 0 ? `(${formatted})` : formatted;
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="page-description">View account transactions and running balances</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={selectedAccountId || selectedAccount?.id || ""}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="text-sm border rounded-md px-3 py-2 bg-card text-foreground"
        >
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>
          ))}
        </select>

        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          className="text-sm border rounded-md px-3 py-2 bg-card text-foreground"
        >
          <option value="all">All Periods</option>
          {fiscalPeriods?.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.period_start} to {p.period_end}) {p.status === "closed" ? "🔒" : ""}
            </option>
          ))}
        </select>

        {selectedAccount && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
            {isDebitNormal ? "Normal Debit Balance" : "Normal Credit Balance"} · {selectedAccount.account_type}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Opening Balance</p>
          <p className="text-xl font-semibold text-foreground mt-1">{fmt(openingBalance)}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Net Movement</p>
          <p className={`text-xl font-semibold mt-1 ${netMovement >= 0 ? "text-success" : "text-destructive"}`}>
            {netMovement >= 0 ? "+" : ""}{fmt(netMovement)}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Closing Balance</p>
          <p className="text-xl font-semibold text-foreground mt-1">{fmt(closingBalance)}</p>
        </div>
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !accounts?.length ? (
          <p className="text-center py-8 text-muted-foreground">No accounts found. Create accounts in Chart of Accounts first.</p>
        ) : ledgerWithBalance.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No transactions for this account{selectedPeriod ? " in the selected period" : ""}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {openingBalance !== 0 && (
                <tr className="bg-muted/30">
                  <td colSpan={5} className="font-medium text-muted-foreground italic">Opening Balance (carried forward)</td>
                  <td className="text-right font-medium text-foreground">{fmt(openingBalance)}</td>
                </tr>
              )}
              {ledgerWithBalance.map((row, i) => (
                <tr key={i} className={row.isReversal ? "bg-destructive/5" : ""}>
                  <td className="text-muted-foreground">{row.date}</td>
                  <td>
                    {row.description}
                    {row.isReversal && <span className="ml-1 text-xs text-destructive">(reversal)</span>}
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">{row.reference}</td>
                  <td className="text-right">{row.debit ? `LKR ${row.debit.toLocaleString()}` : "—"}</td>
                  <td className="text-right">{row.credit ? `LKR ${row.credit.toLocaleString()}` : "—"}</td>
                  <td className="text-right font-medium text-foreground">{fmt(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-foreground/20">
                <td colSpan={3} className="text-foreground">Closing Balance</td>
                <td className="text-right font-mono">
                  LKR {ledger.reduce((s, r) => s + r.debit, 0).toLocaleString()}
                </td>
                <td className="text-right font-mono">
                  LKR {ledger.reduce((s, r) => s + r.credit, 0).toLocaleString()}
                </td>
                <td className="text-right font-mono text-foreground">{fmt(closingBalance)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
