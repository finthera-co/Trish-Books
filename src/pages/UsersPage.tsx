import { Plus, Search, MoreHorizontal, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useUsers, useCreateUser, useRoles, useTenants } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

const roleColors: Record<string, string> = {
  "Super Admin": "bg-destructive/10 text-destructive",
  "Company Admin": "bg-primary/10 text-primary",
  Accountant: "bg-info/10 text-info",
  Staff: "bg-secondary text-secondary-foreground",
};

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [tenantId, setTenantId] = useState("");

  const { data: users, isLoading } = useUsers();
  const { data: roles } = useRoles();
  const { data: tenants } = useTenants();
  const createUser = useCreateUser();
  const { isCompanyAdmin, isSuperAdmin, appUser } = useAuth();
  const { canAddUser, currentUserCount, maxUsers, planName } = useSubscriptionLimits();

  const filtered = users?.filter(
    (u) => u.first_name.toLowerCase().includes(search.toLowerCase()) || 
           u.email.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async () => {
    if (!canAddUser) {
      toast.error(`User limit reached (${maxUsers} users on ${planName} plan). Upgrade to add more users.`);
      return;
    }
    await createUser.mutateAsync({
      email,
      first_name: firstName,
      last_name: lastName,
      role_id: roleId,
      tenant_id: isSuperAdmin ? tenantId : appUser?.tenant_id || "",
    });
    setOpen(false);
    setEmail("");
    setFirstName("");
    setLastName("");
    setRoleId("");
  };

  if (!isCompanyAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-description">Manage user accounts and roles</p>
        </div>
        <div className="flex items-center gap-3">
          {!isSuperAdmin && planName && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentUserCount}/{maxUsers} users
            </span>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canAddUser}>
                <Plus className="w-4 h-4" />
                {canAddUser ? "Add User" : "User Limit Reached"}
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">First Name</label>
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">Last Name</label>
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <div>
                <label className="text-sm font-medium">Role</label>
                <select value={roleId} onChange={(e) => setRoleId(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">Select role...</option>
                  {roles?.filter(r => !isSuperAdmin ? r.role_name !== "Super Admin" : true)
                    .map((r) => <option key={r.id} value={r.id}>{r.role_name}</option>)}
                </select>
              </div>
              {isSuperAdmin && (
                <div>
                  <label className="text-sm font-medium">Tenant</label>
                  <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                    <option value="">Select tenant...</option>
                    {tenants?.map((t) => <option key={t.id} value={t.id}>{t.company_name}</option>)}
                  </select>
                </div>
              )}
              <Button onClick={handleCreate} disabled={!email || !firstName || !lastName || !roleId || createUser.isPending} className="w-full">
                {createUser.isPending ? "Creating..." : "Create User"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No users found</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Role</th><th>Tenant</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div>
                      <p className="font-medium text-foreground">{user.first_name} {user.last_name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[(user.roles as any)?.role_name] || ""}`}>
                      {(user.roles as any)?.role_name || "None"}
                    </span>
                  </td>
                  <td className="text-muted-foreground">{(user.tenants as any)?.company_name || "-"}</td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    }`}>
                      {user.status}
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
