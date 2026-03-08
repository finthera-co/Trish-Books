import { Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const mockExpenses = [
  { id: "EXP-001", description: "Office Supplies", category: "Operations", amount: 1250, date: "2026-03-07", status: "Approved", submitter: "John Smith" },
  { id: "EXP-002", description: "Client Dinner", category: "Entertainment", amount: 320, date: "2026-03-06", status: "Pending", submitter: "Sarah Johnson" },
  { id: "EXP-003", description: "Flight to NYC", category: "Travel", amount: 890, date: "2026-03-05", status: "Approved", submitter: "Mike Williams" },
  { id: "EXP-004", description: "Software License", category: "Technology", amount: 899, date: "2026-03-04", status: "Rejected", submitter: "Emily Brown" },
  { id: "EXP-005", description: "Parking Fee", category: "Transport", amount: 45, date: "2026-03-03", status: "Pending", submitter: "John Smith" },
];

const statusColors: Record<string, string> = {
  Approved: "bg-success/10 text-success",
  Pending: "bg-warning/10 text-warning",
  Rejected: "bg-destructive/10 text-destructive",
};

export default function Expenses() {
  const [search, setSearch] = useState("");
  const filtered = mockExpenses.filter((e) => e.description.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-description">Track and approve expense submissions</p>
        </div>
        <Button><Plus className="w-4 h-4" />Submit Expense</Button>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search expenses..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        <table className="data-table">
          <thead><tr><th>ID</th><th>Description</th><th>Category</th><th>Submitted By</th><th>Date</th><th>Status</th><th className="text-right">Amount</th><th></th></tr></thead>
          <tbody>
            {filtered.map((exp) => (
              <tr key={exp.id}>
                <td className="font-medium text-foreground">{exp.id}</td>
                <td>{exp.description}</td>
                <td><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">{exp.category}</span></td>
                <td className="text-muted-foreground">{exp.submitter}</td>
                <td className="text-muted-foreground">{exp.date}</td>
                <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[exp.status]}`}>{exp.status}</span></td>
                <td className="text-right font-medium text-foreground">${exp.amount.toLocaleString()}</td>
                <td><button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
