import { Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const mockInvoices = [
  { id: "INV-001", customer: "Acme Corp", amount: 8500, status: "Paid", date: "2026-03-06", due: "2026-04-06" },
  { id: "INV-002", customer: "Beta Industries", amount: 3200, status: "Sent", date: "2026-03-04", due: "2026-04-04" },
  { id: "INV-003", customer: "Gamma LLC", amount: 12400, status: "Overdue", date: "2026-02-15", due: "2026-03-01" },
  { id: "INV-004", customer: "Delta Services", amount: 5600, status: "Draft", date: "2026-03-08", due: "2026-04-08" },
  { id: "INV-005", customer: "Epsilon Co", amount: 1800, status: "Sent", date: "2026-03-02", due: "2026-04-02" },
];

const statusColors: Record<string, string> = {
  Paid: "bg-success/10 text-success",
  Sent: "bg-info/10 text-info",
  Overdue: "bg-destructive/10 text-destructive",
  Draft: "bg-muted text-muted-foreground",
};

export default function Invoices() {
  const [search, setSearch] = useState("");
  const filtered = mockInvoices.filter((i) => i.customer.toLowerCase().includes(search.toLowerCase()) || i.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-description">Create and manage customer invoices</p>
        </div>
        <Button><Plus className="w-4 h-4" />New Invoice</Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Outstanding</p><p className="text-xl font-semibold text-foreground mt-1">$17,400</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Paid This Month</p><p className="text-xl font-semibold text-success mt-1">$8,500</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Overdue</p><p className="text-xl font-semibold text-destructive mt-1">$12,400</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Drafts</p><p className="text-xl font-semibold text-muted-foreground mt-1">$5,600</p></div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        <table className="data-table">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due Date</th><th>Status</th><th className="text-right">Amount</th><th></th></tr></thead>
          <tbody>
            {filtered.map((inv) => (
              <tr key={inv.id}>
                <td className="font-medium text-foreground">{inv.id}</td>
                <td>{inv.customer}</td>
                <td className="text-muted-foreground">{inv.date}</td>
                <td className="text-muted-foreground">{inv.due}</td>
                <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status}</span></td>
                <td className="text-right font-medium text-foreground">${inv.amount.toLocaleString()}</td>
                <td><button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
