import { Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const mockUsers = [
  { id: 1, name: "John Smith", email: "john@acme.com", role: "Admin", tenant: "Acme Corporation", status: "Active" },
  { id: 2, name: "Sarah Johnson", email: "sarah@acme.com", role: "Accountant", tenant: "Acme Corporation", status: "Active" },
  { id: 3, name: "Mike Williams", email: "mike@globaltech.co", role: "Employee", tenant: "GlobalTech Ltd", status: "Active" },
  { id: 4, name: "Emily Brown", email: "emily@nairobisol.ke", role: "Admin", tenant: "Nairobi Solutions", status: "Inactive" },
];

const roleColors: Record<string, string> = {
  Admin: "bg-primary/10 text-primary",
  Accountant: "bg-info/10 text-info",
  Employee: "bg-secondary text-secondary-foreground",
};

export default function UsersPage() {
  const [search, setSearch] = useState("");

  const filtered = mockUsers.filter(
    (u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-description">Manage user accounts and roles</p>
        </div>
        <Button>
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Tenant</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id}>
                <td>
                  <div>
                    <p className="font-medium text-foreground">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </td>
                <td>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[user.role] || ""}`}>
                    {user.role}
                  </span>
                </td>
                <td className="text-muted-foreground">{user.tenant}</td>
                <td>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    user.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td>
                  <button className="p-1 rounded hover:bg-accent">
                    <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
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
