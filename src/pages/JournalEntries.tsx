import { Plus, Search, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const mockEntries = [
  { id: "JE-001", date: "2026-03-07", description: "Office Supplies Purchase", reference: "INV-2345", debit: 1250, credit: 1250, status: "Posted" },
  { id: "JE-002", date: "2026-03-06", description: "Client Payment Received", reference: "REC-1122", debit: 8500, credit: 8500, status: "Posted" },
  { id: "JE-003", date: "2026-03-05", description: "Salary Payment - March", reference: "PAY-0301", debit: 14000, credit: 14000, status: "Draft" },
  { id: "JE-004", date: "2026-03-04", description: "Utility Bill Payment", reference: "UTIL-089", debit: 340, credit: 340, status: "Posted" },
  { id: "JE-005", date: "2026-03-03", description: "Equipment Purchase", reference: "PO-5567", debit: 5200, credit: 5200, status: "Pending" },
];

export default function JournalEntries() {
  const [search, setSearch] = useState("");
  const filtered = mockEntries.filter((e) =>
    e.description.toLowerCase().includes(search.toLowerCase()) || e.reference.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-description">Record and manage double-entry transactions</p>
        </div>
        <Button>
          <Plus className="w-4 h-4" />
          New Entry
        </Button>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search entries..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>Description</th>
              <th>Reference</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id}>
                <td className="font-medium text-foreground">{entry.id}</td>
                <td className="text-muted-foreground">{entry.date}</td>
                <td>{entry.description}</td>
                <td className="font-mono text-xs text-muted-foreground">{entry.reference}</td>
                <td className="text-right font-medium">${entry.debit.toLocaleString()}</td>
                <td className="text-right font-medium">${entry.credit.toLocaleString()}</td>
                <td>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    entry.status === "Posted" ? "bg-success/10 text-success" :
                    entry.status === "Draft" ? "bg-muted text-muted-foreground" :
                    "bg-warning/10 text-warning"
                  }`}>{entry.status}</span>
                </td>
                <td>
                  <button className="p-1 rounded hover:bg-accent">
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
