import { Search } from "lucide-react";
import { useState } from "react";
import { useAuditLogs } from "@/hooks/useData";

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
  const { data: logs, isLoading } = useAuditLogs();

  const filtered = logs?.filter((l) =>
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    ((l.users as any)?.first_name || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

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
        
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No audit logs found</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Timestamp</th><th>Action</th><th>User</th><th>Details</th><th>IP Address</th></tr></thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id}>
                  <td className="font-mono text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || "bg-muted text-muted-foreground"}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="text-foreground">
                    {(log.users as any)?.first_name} {(log.users as any)?.last_name}
                  </td>
                  <td className="text-muted-foreground text-sm">
                    {log.table_name && `Table: ${log.table_name}`}
                    {log.record_id && ` | ID: ${log.record_id.slice(0, 8)}...`}
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">{log.ip_address || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
