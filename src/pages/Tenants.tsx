import { Building2, Plus, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const mockTenants = [
  { id: 1, name: "Acme Corporation", email: "admin@acme.com", country: "United States", plan: "Business", status: "Active", users: 8 },
  { id: 2, name: "GlobalTech Ltd", email: "admin@globaltech.co", country: "United Kingdom", plan: "Starter", status: "Active", users: 3 },
  { id: 3, name: "Nairobi Solutions", email: "admin@nairobisol.ke", country: "Kenya", plan: "Business", status: "Suspended", users: 6 },
  { id: 4, name: "Berlin Digital GmbH", email: "admin@berlindig.de", country: "Germany", plan: "Starter", status: "Active", users: 2 },
];

export default function Tenants() {
  const [search, setSearch] = useState("");

  const filtered = mockTenants.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant Management</h1>
          <p className="page-description">Manage companies and their subscriptions</p>
        </div>
        <Button>
          <Plus className="w-4 h-4" />
          Add Tenant
        </Button>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Country</th>
              <th>Plan</th>
              <th>Users</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tenant) => (
              <tr key={tenant.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{tenant.name}</p>
                      <p className="text-xs text-muted-foreground">{tenant.email}</p>
                    </div>
                  </div>
                </td>
                <td>{tenant.country}</td>
                <td>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                    {tenant.plan}
                  </span>
                </td>
                <td>{tenant.users}</td>
                <td>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      tenant.status === "Active"
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {tenant.status}
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
