import { Search } from "lucide-react";
import { useState } from "react";

const mockLogs = [
  { id: 1, action: "Transaction Created", user: "John Smith", details: "Journal Entry JE-001 created", timestamp: "2026-03-07 14:32:00", ip: "192.168.1.45" },
  { id: 2, action: "User Login", user: "Sarah Johnson", details: "Successful login", timestamp: "2026-03-07 09:15:00", ip: "192.168.1.22" },
  { id: 3, action: "Invoice Updated", user: "Mike Williams", details: "INV-003 status changed to Overdue", timestamp: "2026-03-06 16:45:00", ip: "192.168.1.33" },
  { id: 4, action: "Expense Approved", user: "Admin", details: "EXP-001 approved", timestamp: "2026-03-06 11:20:00", ip: "192.168.1.10" },
  { id: 5, action: "Account Modified", user: "Sarah Johnson", details: "Account 5200 name updated", timestamp: "2026-03-05 15:50:00", ip: "192.168.1.22" },
  { id: 6, action: "Data Export", user: "Admin", details: "Trial Balance report exported", timestamp: "2026-03-05 10:30:00", ip: "192.168.1.10" },
];

const actionColors: Record<string, string> = {
  "Transaction Created": "bg-success/10 text-success",
  "User Login": "bg-info/10 text-info",
  "Invoice Updated": "bg-warning/10 text-warning",
  "Expense Approved": "bg-success/10 text-success",
  "Account Modified": "bg-primary/10 text-primary",
  "Data Export": "bg-secondary text-secondary-foreground",
};

export default function AuditLogs() {
  const [search, setSearch] = useState("");
  const filtered = mockLogs.filter((l) => l.action.toLowerCase().includes(search.toLowerCase()) || l.user.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-description">Track all system activities and changes</p>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search logs..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        <table className="data-table">
          <thead><tr><th>Timestamp</th><th>Action</th><th>User</th><th>Details</th><th>IP Address</th></tr></thead>
          <tbody>
            {filtered.map((log) => (
              <tr key={log.id}>
                <td className="font-mono text-xs text-muted-foreground">{log.timestamp}</td>
                <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || ""}`}>{log.action}</span></td>
                <td className="text-foreground">{log.user}</td>
                <td className="text-muted-foreground">{log.details}</td>
                <td className="font-mono text-xs text-muted-foreground">{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
