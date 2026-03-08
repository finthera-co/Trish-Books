import { useState } from "react";
import { useAccounts, useJournalEntries } from "@/hooks/useData";

export default function Ledger() {
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: journalEntries, isLoading: entriesLoading } = useJournalEntries();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const selectedAccount = accounts?.find(a => a.id === selectedAccountId) || accounts?.[0];

  // Build ledger from journal entries
  const ledger = journalEntries?.flatMap(entry => {
    const lines = (entry.journal_lines as any[]) || [];
    return lines
      .filter(line => line.account_id === selectedAccount?.id)
      .map(line => ({
        date: entry.entry_date,
        description: entry.description,
        reference: entry.reference || "-",
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
      }));
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) || [];

  // Calculate running balance
  let balance = 0;
  const ledgerWithBalance = ledger.map(row => {
    balance += row.debit - row.credit;
    return { ...row, balance };
  });

  const openingBalance = 0;
  const closingBalance = balance;
  const netMovement = closingBalance - openingBalance;

  const isLoading = accountsLoading || entriesLoading;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="page-description">View account transactions and balances</p>
        </div>
      </div>

      <div className="flex gap-3">
        <select
          value={selectedAccountId || selectedAccount?.id || ""}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="text-sm border rounded-md px-3 py-2 bg-card text-foreground"
        >
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Opening Balance</p>
          <p className="text-xl font-semibold text-foreground mt-1">LKR {openingBalance.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Net Movement</p>
          <p className={`text-xl font-semibold mt-1 ${netMovement >= 0 ? "text-success" : "text-destructive"}`}>
            {netMovement >= 0 ? "+" : ""}${netMovement.toLocaleString()}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Closing Balance</p>
          <p className="text-xl font-semibold text-foreground mt-1">${closingBalance.toLocaleString()}</p>
        </div>
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !accounts?.length ? (
          <p className="text-center py-8 text-muted-foreground">No accounts found. Create accounts in Chart of Accounts first.</p>
        ) : ledgerWithBalance.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No transactions for this account</p>
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
              {ledgerWithBalance.map((row, i) => (
                <tr key={i}>
                  <td className="text-muted-foreground">{row.date}</td>
                  <td>{row.description}</td>
                  <td className="font-mono text-xs text-muted-foreground">{row.reference}</td>
                  <td className="text-right">{row.debit ? `$${row.debit.toLocaleString()}` : "-"}</td>
                  <td className="text-right">{row.credit ? `$${row.credit.toLocaleString()}` : "-"}</td>
                  <td className="text-right font-medium text-foreground">${row.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
