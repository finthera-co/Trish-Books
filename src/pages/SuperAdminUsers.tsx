import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Search, MoreHorizontal, UserX, UserCheck, Trash2, Pencil, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateUser } from "@/hooks/useData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function SuperAdminUsers() {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [editUser, setEditUser] = useState<any>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const updateUser = useUpdateUser();

  const { data: tenants } = useQuery({
    queryKey: ["all_tenants_list"],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id, company_name").order("company_name");
      return data || [];
    },
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ["all_users_admin", tenantFilter, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("users")
        .select("id, email, first_name, last_name, tenant_id, created_at, status, login_count, last_login_at, roles(role_name), tenants:tenant_id(company_name)")
        .order("created_at", { ascending: false });

      if (tenantFilter !== "all") query = query.eq("tenant_id", tenantFilter);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const suspendUser = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("users").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["all_users_admin"] });
      toast.success(`User ${status === "suspended" ? "suspended" : "reactivated"}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("users").update({ status: "deleted" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all_users_admin"] });
      toast.success("User deleted (soft)");
      setDeleteUser(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openEdit = (user: any) => {
    setEditUser(user);
    setEditFirstName(user.first_name || "");
    setEditLastName(user.last_name || "");
    setEditEmail(user.email || "");
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    await updateUser.mutateAsync({
      user_id: editUser.id,
      email: editEmail.trim(),
      first_name: editFirstName.trim(),
      last_name: editLastName.trim(),
      previous_email: editUser.email,
    });
    setEditUser(null);
  };

  const emailIsChanging = !!editUser && editEmail.trim().toLowerCase() !== (editUser.email || "").toLowerCase();

  if (!isSuperAdmin) {
    return <div className="text-center py-12"><p className="text-muted-foreground">Access denied.</p></div>;
  }

  const filtered = users?.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const statusColors: Record<string, string> = {
    active: "bg-primary/10 text-primary",
    suspended: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    deleted: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">All Users</h1>
          <p className="page-description">Manage all users across all companies</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Users</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{users?.length || 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {users?.filter(u => (u as any).status === "active").length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Suspended</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {users?.filter(u => (u as any).status === "suspended").length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Recent Logins (7d)</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {users?.filter(u => {
              const la = (u as any).last_login_at;
              if (!la) return false;
              return new Date(la) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            }).length || 0}
          </p>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
          </div>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue placeholder="All Companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {tenants?.map(t => <SelectItem key={t.id} value={t.id}>{t.company_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
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
                <th>Last Login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => {
                const status = (user as any).status || "active";
                const roleName = (user.roles as any)?.role_name || "—";
                const isSuperAdminUser = roleName === "Super Admin";
                return (
                  <tr key={user.id}>
                    <td className="font-medium text-foreground">{user.first_name} {user.last_name}</td>
                    <td className="text-muted-foreground text-sm">{user.email}</td>
                    <td className="text-sm">{(user.tenants as any)?.company_name || "—"}</td>
                    <td>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{roleName}</span>
                    </td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[status] || statusColors.active}`}>{status}</span>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {(user as any).last_login_at ? format(new Date((user as any).last_login_at), "MMM d, HH:mm") : "Never"}
                    </td>
                    <td>
                      {!isSuperAdminUser && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => openEdit(user)}>
                              <Pencil className="w-3.5 h-3.5 mr-2" /> Edit Name & Login Email
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {status === "active" ? (
                              <DropdownMenuItem onClick={() => suspendUser.mutate({ id: user.id, status: "suspended" })}>
                                <UserX className="w-3.5 h-3.5 mr-2" /> Suspend
                              </DropdownMenuItem>
                            ) : status === "suspended" ? (
                              <DropdownMenuItem onClick={() => suspendUser.mutate({ id: user.id, status: "active" })}>
                                <UserCheck className="w-3.5 h-3.5 mr-2" /> Reactivate
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteUser(user)}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Name & Login Email */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Edit User
            </DialogTitle>
            <DialogDescription>
              {editUser && `Update the name and sign-in email for this ${(editUser.roles as any)?.role_name || "user"}${(editUser.tenants as any)?.company_name ? ` at ${(editUser.tenants as any).company_name}` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">First Name <span className="text-destructive">*</span></label>
                  <input type="text" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Last Name <span className="text-destructive">*</span></label>
                  <input type="text" value={editLastName} onChange={(e) => setEditLastName(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Login Email <span className="text-destructive">*</span></label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                <p className="text-xs text-muted-foreground mt-1">This is the address the user signs in with.</p>
              </div>
              {emailIsChanging && (
                <div className="flex gap-2 rounded-md border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-3">
                  <AlertTriangle className="w-4 h-4 text-[hsl(var(--warning))] shrink-0 mt-0.5" />
                  <div className="text-xs text-foreground">
                    <p className="font-medium">Login email will change</p>
                    <p className="text-muted-foreground mt-0.5">
                      {editUser.email} → {editEmail.trim()}. Their password stays the same, but they must use the new
                      email to sign in. Any open session on the old address stays valid until it expires.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditUser(null)} className="flex-1">Cancel</Button>
                <Button
                  onClick={handleUpdate}
                  disabled={!editEmail.trim() || !editFirstName.trim() || !editLastName.trim() || updateUser.isPending}
                  className="flex-1"
                >
                  {updateUser.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(v) => !v && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark "{deleteUser?.first_name} {deleteUser?.last_name}" as deleted. This is a soft delete — the record is preserved for audit purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteUser && deleteUserMutation.mutate(deleteUser.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
