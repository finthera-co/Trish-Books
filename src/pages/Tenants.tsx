import { Building2, Plus, MoreHorizontal, Search, UserPlus, Copy, Check, Eye, EyeOff, Pencil, Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTenants, useUpdateTenant, useSubscriptionPlans } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDate } from "@/lib/format";
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

interface ProvisionResult {
  email: string;
  password: string;
  companyName: string;
  firstName: string;
  lastName: string;
}

export default function Tenants() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  // Form fields
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [planId, setPlanId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Edit dialog
  const [editTenant, setEditTenant] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editPlanId, setEditPlanId] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Archive dialog
  const [deleteTenant, setDeleteTenant] = useState<any>(null);

  // Permanent delete dialog
  const [purgeTenant, setPurgeTenant] = useState<any>(null);
  const [purgeConfirm, setPurgeConfirm] = useState("");
  const [purgeLoading, setPurgeLoading] = useState(false);

  // Success state
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: tenants, isLoading, refetch } = useTenants();
  const { data: plans } = useSubscriptionPlans();
  const updateTenant = useUpdateTenant();
  const { isSuperAdmin } = useAuth();

  const filtered = tenants?.filter((t) => {
    const matchesSearch = t.company_name.toLowerCase().includes(search.toLowerCase());
    const isDeleted = !!(t as any).deleted_at;
    if (showDeleted) return matchesSearch && isDeleted;
    return matchesSearch && !isDeleted;
  }) || [];

  const deletedCount = tenants?.filter(t => !!(t as any).deleted_at).length || 0;

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const resetForm = () => {
    setCompanyName(""); setCountry(""); setIndustry(""); setPlanId("");
    setAdminEmail(""); setAdminPassword(""); setAdminFirstName(""); setAdminLastName("");
    setShowPassword(false); setResult(null);
  };

  const handleCreate = async () => {
    if (!companyName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (adminPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const data = await invokeEdgeFunction<{ success?: boolean; error?: string }>(
        "provision-tenant",
        {
          company_name: companyName, country, industry,
          subscription_plan_id: planId || undefined,
          admin_email: adminEmail, admin_password: adminPassword,
          admin_first_name: adminFirstName, admin_last_name: adminLastName,
        },
      );

      if (!data?.success) throw new Error(data?.error || "Provisioning failed");

      setResult({ email: adminEmail, password: adminPassword, companyName, firstName: adminFirstName, lastName: adminLastName });
      toast.success(`Tenant "${companyName}" provisioned successfully`);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const handleStatusChange = (id: string, status: string) => {
    updateTenant.mutate({ id, status });
  };

  const openEditDialog = (tenant: any) => {
    setEditTenant(tenant);
    setEditName(tenant.company_name);
    setEditCountry(tenant.country || "");
    setEditIndustry(tenant.industry || "");
    setEditPlanId(tenant.subscription_plan_id || "");
  };

  const handleEditSave = async () => {
    if (!editTenant || !editName.trim()) return;
    setEditLoading(true);
    try {
      const { error } = await supabase.from("tenants").update({
        company_name: editName.trim(),
        country: editCountry || null,
        industry: editIndustry || null,
        subscription_plan_id: editPlanId || null,
      }).eq("id", editTenant.id);
      if (error) throw error;
      toast.success("Company updated");
      setEditTenant(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
    setEditLoading(false);
  };

  const handleSoftDelete = async () => {
    if (!deleteTenant) return;
    try {
      const { error } = await supabase.from("tenants").update({
        deleted_at: new Date().toISOString(),
        status: "suspended",
      }).eq("id", deleteTenant.id);
      if (error) throw error;
      toast.success(`"${deleteTenant.company_name}" archived`);
      setDeleteTenant(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const closePurgeDialog = () => {
    setPurgeTenant(null);
    setPurgeConfirm("");
  };

  const handlePermanentDelete = async () => {
    if (!purgeTenant || purgeConfirm !== purgeTenant.company_name) return;
    setPurgeLoading(true);
    try {
      const data = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        purge?: { total_rows_deleted?: number };
        cleanup?: {
          auth_users_deleted?: number;
          storage_objects_deleted?: number;
          errors?: string[];
        };
      }>("delete-tenant", { tenant_id: purgeTenant.id, confirmation: purgeConfirm });
      if (!data?.success) throw new Error(data?.error || "Permanent deletion failed");

      const rows = data.purge?.total_rows_deleted ?? 0;
      const cleanup = data.cleanup;
      toast.success(
        `"${purgeTenant.company_name}" permanently deleted — ${rows.toLocaleString()} records, ` +
        `${cleanup?.auth_users_deleted ?? 0} login(s), ${cleanup?.storage_objects_deleted ?? 0} file(s) erased`
      );
      // Data is gone either way; surface anything the external cleanup couldn't finish.
      if (cleanup?.errors?.length) {
        toast.warning(`Cleanup issues: ${cleanup.errors.join("; ")}`);
      }
      closePurgeDialog();
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
    setPurgeLoading(false);
  };

  const handleRestore = async (tenant: any) => {
    try {
      const { error } = await supabase.from("tenants").update({
        deleted_at: null,
        status: "active",
      }).eq("id", tenant.id);
      if (error) throw error;
      toast.success(`"${tenant.company_name}" restored`);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!isSuperAdmin) {
    return <div className="text-center py-12"><p className="text-muted-foreground">You don't have permission to view this page.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant Management</h1>
          <p className="page-description">Provision companies and create their admin accounts</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" /> Provision Tenant</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{result ? "Tenant Provisioned" : "Provision New Tenant"}</DialogTitle>
              <DialogDescription>
                {result ? "Share the credentials below with the company administrator." : "Create the company and its admin account in one step."}
              </DialogDescription>
            </DialogHeader>

            {result ? (
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{result.companyName}</span>
                  </div>
                  <div className="border-t border-border pt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Admin Credentials</p>
                    <div className="flex items-center justify-between">
                      <div><p className="text-xs text-muted-foreground">Name</p><p className="text-sm font-medium text-foreground">{result.firstName} {result.lastName}</p></div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-mono text-foreground">{result.email}</p></div>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(result.email, "email")}>
                        {copiedField === "email" ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><p className="text-xs text-muted-foreground">Password</p><p className="text-sm font-mono text-foreground">{result.password}</p></div>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(result.password, "password")}>
                        {copiedField === "password" ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-md bg-accent/50 border border-accent p-3">
                  <p className="text-xs text-muted-foreground">⚠️ Make sure to copy and securely share these credentials. The password cannot be retrieved after closing this dialog.</p>
                </div>
                <Button className="w-full" onClick={() => { setOpen(false); resetForm(); }}>Done</Button>
              </div>
            ) : (
              <div className="space-y-5 pt-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Company Details</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-foreground">Company Name <span className="text-destructive">*</span></label>
                      <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                        className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                        placeholder="Acme Holdings Pvt Ltd" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-foreground">Country</label>
                        <input type="text" value={country} onChange={(e) => setCountry(e.target.value)}
                          className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="Sri Lanka" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Industry</label>
                        <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)}
                          className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="Technology" />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Subscription Plan</label>
                      <select value={planId} onChange={(e) => setPlanId(e.target.value)}
                        className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors">
                        <option value="">Select plan...</option>
                        {plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5" /> Company Admin Account
                  </p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-foreground">First Name <span className="text-destructive">*</span></label>
                        <input type="text" value={adminFirstName} onChange={(e) => setAdminFirstName(e.target.value)}
                          className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="John" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Last Name <span className="text-destructive">*</span></label>
                        <input type="text" value={adminLastName} onChange={(e) => setAdminLastName(e.target.value)}
                          className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="Silva" />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Email <span className="text-destructive">*</span></label>
                      <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
                        className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                        placeholder="admin@acme.com" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Password <span className="text-destructive">*</span></label>
                      <div className="relative mt-1">
                        <input type={showPassword ? "text" : "password"} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
                          className="w-full text-sm border border-input rounded-lg px-3 py-2 pr-10 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="Min 8 characters" minLength={8} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <Button onClick={handleCreate}
                  disabled={!companyName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName || loading}
                  className="w-full">
                  {loading ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Provisioning…</span> : "Provision Tenant & Create Admin"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Tenants</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{tenants?.filter(t => !(t as any).deleted_at).length || 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {tenants?.filter(t => t.status === "active" && !(t as any).deleted_at).length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Suspended</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {tenants?.filter(t => t.status === "suspended" && !(t as any).deleted_at).length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Archived</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{deletedCount}</p>
        </div>
      </div>

      {/* Table */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search tenants..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
          {deletedCount > 0 && (
            <Button variant={showDeleted ? "secondary" : "ghost"} size="sm" onClick={() => setShowDeleted(!showDeleted)}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Archived ({deletedCount})
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">{showDeleted ? "No archived tenants" : "No tenants found"}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Company</th><th>Country</th><th>Industry</th><th>Plan</th><th>Status</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-primary" />
                      </div>
                      <span className="font-medium text-foreground">{tenant.company_name}</span>
                    </div>
                  </td>
                  <td>{tenant.country || "—"}</td>
                  <td>{tenant.industry || "—"}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {(tenant.subscription_plans as any)?.name || "None"}
                    </span>
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      tenant.status === "active" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                    }`}>{tenant.status}</span>
                  </td>
                  <td className="text-xs text-muted-foreground">{formatDate(tenant.created_at)}</td>
                  <td>
                    {showDeleted ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleRestore(tenant)}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => { setPurgeTenant(tenant); setPurgeConfirm(""); }}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Forever
                        </Button>
                      </div>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => openEditDialog(tenant)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" /> Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleStatusChange(tenant.id, tenant.status === "active" ? "suspended" : "active")}>
                            {tenant.status === "active" ? "Suspend" : "Activate"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTenant(tenant)}>
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Archive Company
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTenant} onOpenChange={(v) => !v && setEditTenant(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Company Details</DialogTitle>
            <DialogDescription>Update company information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium text-foreground">Company Name</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Country</label>
                <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Industry</label>
                <input type="text" value={editIndustry} onChange={(e) => setEditIndustry(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Subscription Plan</label>
              <select value={editPlanId} onChange={(e) => setEditPlanId(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors">
                <option value="">No plan</option>
                {plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <Button onClick={handleEditSave} disabled={!editName.trim() || editLoading} className="w-full">
              {editLoading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTenant} onOpenChange={(v) => !v && setDeleteTenant(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Company</AlertDialogTitle>
            <AlertDialogDescription>
              This will suspend and archive "{deleteTenant?.company_name}". The company can be restored later from the Archived view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSoftDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Archive Company
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent Delete Confirmation */}
      <Dialog open={!!purgeTenant} onOpenChange={(v) => { if (!v && !purgeLoading) closePurgeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Delete Company Permanently
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. There is no backup and no restore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">
                Everything belonging to "{purgeTenant?.company_name}" will be erased:
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>All accounting data — chart of accounts, journals, ledgers, invoices, bills, payments</li>
                <li>Customers, suppliers, inventory, fixed assets, budgets and reconciliations</li>
                <li>Employees, payroll history, attendance and leave records</li>
                <li>Every user login for this company, including its admins</li>
                <li>Uploaded files — invoice attachments, logos and employee photos</li>
              </ul>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                Type <span className="font-mono text-destructive">{purgeTenant?.company_name}</span> to confirm
              </label>
              <input
                type="text"
                value={purgeConfirm}
                onChange={(e) => setPurgeConfirm(e.target.value)}
                autoComplete="off"
                placeholder={purgeTenant?.company_name}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/20 focus:border-destructive transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={closePurgeDialog} disabled={purgeLoading}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={purgeLoading || purgeConfirm !== purgeTenant?.company_name}
                onClick={handlePermanentDelete}
              >
                {purgeLoading ? "Erasing…" : "Delete Forever"}
              </Button>
            </div>
            {purgeLoading && (
              <p className="text-xs text-muted-foreground text-center">
                Erasing all records — this can take a minute for a company with a lot of history. Don't close this tab.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
