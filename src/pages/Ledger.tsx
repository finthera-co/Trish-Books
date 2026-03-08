import { useState } from "react";

const accounts = ["Cash & Bank", "Accounts Receivable", "Accounts Payable", "Sales Revenue", "Operating Expenses"];

const mockLedger = [
  { date: "2026-03-01", description: "Opening Balance", reference: "-", debit: 45000, credit: 0, balance: 45000 },
  { date: "2026-03-03", description: "Client Payment - Beta Inc", reference: "REC-1100", debit: 6200, credit: 0, balance: 51200 },
  { date: "2026-03-04", description: "Utility Payment", reference: "UTIL-089", debit: 0, credit: 340, balance: 50860 },
  { date: "2026-03-05", description: "Equipment Purchase", reference: "PO-5567", debit: 0, credit: 5200, balance: 45660 },
  { date: "2026-03-06", description: "Client Payment - Acme Corp", reference: "REC-1122", debit: 8500, credit: 0, balance: 54160 },
  { date: "2026-03-07", description: "Office Supplies", reference: "INV-2345", debit: 0, credit: 1250, balance: 52910 },
];

export default function Ledger() {
  const [selectedAccount, setSelectedAccount] = useState(accounts[0]);

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
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          className="text-sm border rounded-md px-3 py-2 bg-card text-foreground"
        >
          {accounts.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Opening Balance</p>
          <p className="text-xl font-semibold text-foreground mt-1">$45,000</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Net Movement</p>
          <p className="text-xl font-semibold text-success mt-1">+$7,910</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Closing Balance</p>
          <p className="text-xl font-semibold text-foreground mt-1">$52,910</p>
        </div>
      </div>

      <div className="stat-card">
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
            {mockLedger.map((row, i) => (
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
      </div>
    </div>
  );
}
