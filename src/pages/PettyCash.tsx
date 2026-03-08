import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const mockTransactions = [
  { id: 1, date: "2026-03-07", description: "Taxi fare", type: "Expense", amount: -25, balance: 475 },
  { id: 2, date: "2026-03-06", description: "Office snacks", type: "Expense", amount: -45, balance: 500 },
  { id: 3, date: "2026-03-05", description: "Top-up", type: "Top-up", amount: 200, balance: 545 },
  { id: 4, date: "2026-03-04", description: "Courier fee", type: "Expense", amount: -30, balance: 345 },
  { id: 5, date: "2026-03-03", description: "Initial issue", type: "Issue", amount: 375, balance: 375 },
];

const typeColors: Record<string, string> = {
  Expense: "bg-destructive/10 text-destructive",
  "Top-up": "bg-success/10 text-success",
  Issue: "bg-info/10 text-info",
};

export default function PettyCash() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash</h1>
          <p className="page-description">Manage petty cash accounts and transactions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">Reconcile</Button>
          <Button><Plus className="w-4 h-4" />New Transaction</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Current Balance</p><p className="text-xl font-semibold text-foreground mt-1">$475.00</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Issued</p><p className="text-xl font-semibold text-info mt-1">$575.00</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Spent</p><p className="text-xl font-semibold text-destructive mt-1">$100.00</p></div>
      </div>

      <div className="stat-card">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Description</th><th>Type</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
          <tbody>
            {mockTransactions.map((t) => (
              <tr key={t.id}>
                <td className="text-muted-foreground">{t.date}</td>
                <td>{t.description}</td>
                <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[t.type]}`}>{t.type}</span></td>
                <td className={`text-right font-medium ${t.amount >= 0 ? "text-success" : "text-destructive"}`}>{t.amount >= 0 ? "+" : ""}${Math.abs(t.amount)}</td>
                <td className="text-right font-medium text-foreground">${t.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
