import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Search, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SuperAdminUsers() {
  const { isSuperAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("all");

  const { data: tenants } = useQuery({
    queryKey: ["all_tenants_list"],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id, company_name").order("company_name");
      return data || [];
    },
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ["all_users_readonly", tenantFilter],
    queryFn: async () => {
      let query = supabase
        .from("users")
        .select("id, email, first_name, last_name, is_active, tenant_id, created_at, roles(role_name), tenants:tenant_id(company_name)")
        .order("created_at", { ascending: false });

      if (tenantFilter !== "all") query = query.eq("tenant_id", tenantFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  if (!isSuperAdmin) {
    return <div className="text-center py-12"><p className="text-muted-foreground">Access denied.</p></div>;
  }

  const filtered = users?.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">All Users</h1>
          <p className="page-description">Read-only view of all users across all companies</p>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-[200px] h-9 text-xs">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {tenants?.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.company_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No users found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id}>
                  <td className="font-medium text-foreground">{user.first_name} {user.last_name}</td>
                  <td className="text-muted-foreground text-sm">{user.email}</td>
                  <td className="text-sm">{(user.tenants as any)?.company_name || "—"}</td>
                  <td>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                      {(user.roles as any)?.role_name || "—"}
                    </span>
                  </td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      user.is_active !== false ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                    }`}>
                      {user.is_active !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
