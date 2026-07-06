import { Plus, Search, Shield, ShieldCheck, Eye, Clock, UserCog, ChevronDown, ChevronRight, Settings2, Users2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useUsers, useCreateUser, useRoles, useTenants } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useUserPermissions, useUpsertPermissions, PERMISSION_MODULES, PERMISSION_LEVELS, getDefaultPermissionsForRole, type PermissionLevel } from "@/hooks/usePermissions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const ROLE_META: Record<string, { icon: typeof Shield; color: string; description: string }> = {
  "Super Admin": { icon: ShieldCheck, color: "bg-destructive/10 text-destructive", description: "Full platform access" },
  "Primary Admin": { icon: ShieldCheck, color: "bg-chart-1/15 text-chart-1", description: "Company owner" },
  "Company Admin": { icon: Shield, color: "bg-primary/10 text-primary", description: "Full company access" },
  "Accountant": { icon: UserCog, color: "bg-chart-2/15 text-chart-2", description: "Financial modules" },
  "Standard User": { icon: Users2, color: "bg-chart-3/15 text-chart-3", description: "Custom permissions" },
  "Staff": { icon: Users2, color: "bg-secondary text-secondary-foreground", description: "Basic access" },
  "Reports Only": { icon: Eye, color: "bg-chart-4/15 text-chart-4", description: "View-only reports" },
  "Time Tracking": { icon: Clock, color: "bg-chart-5/15 text-chart-5", description: "Timesheets only" },
};

const PERM_LEVEL_COLORS: Record<string, string> = {
  full_access: "bg-primary/10 text-primary",
  create_edit: "bg-chart-2/15 text-chart-2",
  view_only: "bg-chart-4/15 text-chart-4",
  no_access: "bg-muted text-muted-foreground",
};

function PermissionEditor({ userId, roleName }: { userId: string; roleName: string }) {
  const { data: existingPerms, isLoading } = useUserPermissions(userId);
  const upsert = useUpsertPermissions();
  const [perms, setPerms] = useState<Record<string, PermissionLevel> | null>(null);

  const isAdminRole = ["Super Admin", "Primary Admin", "Company Admin"].includes(roleName);

  // Build full permission map: start with defaults, overlay existing DB values
  const defaults = Object.fromEntries(getDefaultPermissionsForRole(roleName).map(p => [p.module_name, p.permission_level]));
  const saved = existingPerms
    ? Object.fromEntries(existingPerms.map(p => [p.module_name, p.permission_level]))
    : {};
  const currentPerms = perms ?? { ...defaults, ...saved };

  if (isLoading) return <div className="py-4 text-center text-sm text-muted-foreground">Loading permissions...</div>;

  if (isAdminRole) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
        <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">Full Access Granted</p>
        <p className="text-xs text-muted-foreground mt-1">Admin roles automatically have full access to all modules.</p>
      </div>
    );
  }

  const handleSave = () => {
    const permissions = Object.entries(currentPerms).map(([module_name, permission_level]) => ({
      module_name,
      permission_level,
    }));
    upsert.mutate({ userId, permissions });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr,auto] gap-2 px-4 py-2 bg-muted/50 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Module</span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Access Level</span>
        </div>
        {PERMISSION_MODULES.map((mod) => (
          <div key={mod.key} className="grid grid-cols-[1fr,auto] gap-2 items-center px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
            <span className="text-sm font-medium text-foreground">{mod.label}</span>
            <select
              value={currentPerms[mod.key] || "no_access"}
              onChange={(e) => setPerms({ ...currentPerms, [mod.key]: e.target.value as PermissionLevel })}
              className="text-xs border border-input rounded-md px-2 py-1.5 bg-background text-foreground min-w-[140px]"
            >
              {PERMISSION_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <Button onClick={handleSave} disabled={upsert.isPending} size="sm" className="w-full">
        {upsert.isPending ? "Saving..." : "Save Permissions"}
      </Button>
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [permDialogUser, setPermDialogUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tenantMode, setTenantMode] = useState<"existing" | "new">("existing");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newIndustry, setNewIndustry] = useState("");

  const { data: users, isLoading } = useUsers();
  const { data: roles } = useRoles();
  const { data: tenants } = useTenants();
  const createUser = useCreateUser();
  const { isCompanyAdmin, isSuperAdmin, appUser } = useAuth();
  const { canAddUser, currentUserCount, maxUsers, planName } = useSubscriptionLimits();

  const filtered = users?.filter(
    (u) => u.first_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      ((u.roles as any)?.role_name || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

  // Sort: admins first
  const roleOrder = ["Super Admin", "Primary Admin", "Company Admin", "Accountant", "Standard User", "Staff", "Reports Only", "Time Tracking"];
  const sorted = [...filtered].sort((a, b) => {
    const aRole = (a.roles as any)?.role_name || "Staff";
    const bRole = (b.roles as any)?.role_name || "Staff";
    return roleOrder.indexOf(aRole) - roleOrder.indexOf(bRole);
  });

  const handleCreate = async () => {
    if (!canAddUser) {
      toast.error(`User limit reached (${maxUsers} users on ${planName} plan).`);
      return;
    }

    let resolvedTenantId = isSuperAdmin ? tenantId : appUser?.tenant_id || "";

    // If Super Admin chose to create a new tenant
    if (isSuperAdmin && tenantMode === "new") {
      if (!newCompanyName.trim()) {
        toast.error("Company name is required for new tenant");
        return;
      }
      try {
        const { data, error } = await supabase
          .from("tenants")
          .insert({ company_name: newCompanyName, country: newCountry || null, industry: newIndustry || null })
          .select("id")
          .single();
        if (error) throw error;
        resolvedTenantId = data.id;
      } catch (err: any) {
        toast.error(`Failed to create tenant: ${err.message}`);
        return;
      }
    }

    if (isSuperAdmin && !resolvedTenantId) {
      toast.error("Please select or create a tenant");
      return;
    }

    await createUser.mutateAsync({
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      role_id: roleId,
      tenant_id: resolvedTenantId,
    });
    setOpen(false);
    setEmail(""); setPassword(""); setFirstName(""); setLastName(""); setRoleId("");
    setTenantId(""); setTenantMode("existing"); setNewCompanyName(""); setNewCountry(""); setNewIndustry("");
  };

  const getSelectedRoleName = () => roles?.find(r => r.id === roleId)?.role_name || "";

  if (!isCompanyAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-description">Manage user accounts, roles, and module permissions</p>
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
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>Add a user and assign their role. You can configure module permissions after creation.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">First Name <span className="text-destructive">*</span></label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">Last Name <span className="text-destructive">*</span></label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                      className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Email <span className="text-destructive">*</span></label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                  </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Password <span className="text-destructive">*</span></label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters" minLength={8}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Role <span className="text-destructive">*</span></label>
                  <select value={roleId} onChange={(e) => setRoleId(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground">
                    <option value="">Select role...</option>
                    {roles?.filter(r => !isSuperAdmin ? !["Super Admin"].includes(r.role_name) : true)
                      .map((r) => {
                        const meta = ROLE_META[r.role_name];
                        return <option key={r.id} value={r.id}>{r.role_name}{meta ? ` — ${meta.description}` : ""}</option>;
                      })}
                  </select>
                </div>
                {getSelectedRoleName() && (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Role Description</p>
                    <p className="text-sm text-foreground">{ROLE_META[getSelectedRoleName()]?.description || "Standard role"}</p>
                    {["Standard User", "Staff", "Accountant"].includes(getSelectedRoleName()) && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Settings2 className="w-3 h-3" />
                        Module permissions can be configured after creation
                      </p>
                    )}
                  </div>
                )}
                {isSuperAdmin && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-foreground">Tenant <span className="text-destructive">*</span></label>
                      <div className="flex rounded-md border border-input overflow-hidden ml-auto">
                        <button type="button" onClick={() => { setTenantMode("existing"); setNewCompanyName(""); setNewCountry(""); setNewIndustry(""); }}
                          className={`text-xs px-3 py-1 transition-colors ${tenantMode === "existing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                          Existing
                        </button>
                        <button type="button" onClick={() => { setTenantMode("new"); setTenantId(""); }}
                          className={`text-xs px-3 py-1 transition-colors ${tenantMode === "new" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                          <Building2 className="w-3 h-3 inline mr-1" />New Tenant
                        </button>
                      </div>
                    </div>
                    {tenantMode === "existing" ? (
                      <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}
                        className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground">
                        <option value="">Select tenant...</option>
                        {tenants?.map((t) => <option key={t.id} value={t.id}>{t.company_name}</option>)}
                      </select>
                    ) : (
                      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Company Name <span className="text-destructive">*</span></label>
                          <input type="text" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}
                            placeholder="Acme Holdings Pvt Ltd"
                            className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Country</label>
                            <input type="text" value={newCountry} onChange={(e) => setNewCountry(e.target.value)}
                              placeholder="Sri Lanka"
                              className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Industry</label>
                            <input type="text" value={newIndustry} onChange={(e) => setNewIndustry(e.target.value)}
                              placeholder="Technology"
                              className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <Button onClick={handleCreate} disabled={
                  !email || !firstName || !lastName || !roleId || password.length < 8 || createUser.isPending ||
                  (isSuperAdmin && tenantMode === "existing" && !tenantId) ||
                  (isSuperAdmin && tenantMode === "new" && !newCompanyName.trim())
                } className="w-full">
                  {createUser.isPending ? "Creating..." : "Create User"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Users</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{users?.length || 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Admins</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {users?.filter(u => ["Super Admin", "Primary Admin", "Company Admin"].includes((u.roles as any)?.role_name)).length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {users?.filter(u => u.status === "active").length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Inactive</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {users?.filter(u => u.status !== "active").length || 0}
          </p>
        </div>
      </div>

      {/* User List */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search users by name, email, or role..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No users found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Company</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((user) => {
                const roleName = (user.roles as any)?.role_name || "None";
                const meta = ROLE_META[roleName] || ROLE_META["Staff"];
                const Icon = meta.icon;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                          {user.first_name?.[0]}{user.last_name?.[0]}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{user.first_name} {user.last_name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge variant="secondary" className={`${meta.color} gap-1`}>
                        <Icon className="w-3 h-3" />
                        {roleName}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground text-sm">{(user.tenants as any)?.company_name || "—"}</td>
                    <td>
                      <Badge variant="secondary" className={user.status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>
                        {user.status}
                      </Badge>
                    </td>
                    <td className="text-right">
                      {["Standard User", "Staff", "Accountant", "Reports Only", "Time Tracking"].includes(roleName) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPermDialogUser(user)}
                          className="text-xs gap-1"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                          Permissions
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Permission Configuration Dialog */}
      <Dialog open={!!permDialogUser} onOpenChange={(v) => !v && setPermDialogUser(null)}>
    <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Configure Permissions
            </DialogTitle>
            <DialogDescription>
              {permDialogUser && `Set module-level access for ${permDialogUser.first_name} ${permDialogUser.last_name}`}
            </DialogDescription>
          </DialogHeader>
          {permDialogUser && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  {permDialogUser.first_name?.[0]}{permDialogUser.last_name?.[0]}
                </div>
                <div>
                  <p className="font-medium text-foreground">{permDialogUser.first_name} {permDialogUser.last_name}</p>
                  <p className="text-xs text-muted-foreground">{permDialogUser.email} · {(permDialogUser.roles as any)?.role_name}</p>
                </div>
              </div>
              <PermissionEditor userId={permDialogUser.id} roleName={(permDialogUser.roles as any)?.role_name || "Staff"} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
