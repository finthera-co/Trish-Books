import { Building2, Plus, MoreHorizontal, Search, UserPlus, Copy, Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTenants, useUpdateTenant, useSubscriptionPlans } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  // Success state
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: tenants, isLoading, refetch } = useTenants();
  const { data: plans } = useSubscriptionPlans();
  const updateTenant = useUpdateTenant();
  const { isSuperAdmin } = useAuth();

  const filtered = tenants?.filter((t) =>
    t.company_name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const resetForm = () => {
    setCompanyName("");
    setCountry("");
    setIndustry("");
    setPlanId("");
    setAdminEmail("");
    setAdminPassword("");
    setAdminFirstName("");
    setAdminLastName("");
    setShowPassword(false);
    setResult(null);
  };

  const handleCreate = async () => {
    if (!companyName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (adminPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await supabase.functions.invoke("provision-tenant", {
        body: {
          company_name: companyName,
          country,
          industry,
          subscription_plan_id: planId || undefined,
          admin_email: adminEmail,
          admin_password: adminPassword,
          admin_first_name: adminFirstName,
          admin_last_name: adminLastName,
        },
      });

      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error || res.error?.message || "Provisioning failed");
      }

      setResult({
        email: adminEmail,
        password: adminPassword,
        companyName,
        firstName: adminFirstName,
        lastName: adminLastName,
      });

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

  if (!isSuperAdmin) {
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
                {result
                  ? "Share the credentials below with the company administrator."
                  : "Create the company and its admin account in one step."}
              </DialogDescription>
            </DialogHeader>

            {result ? (
              /* ── Success: Show credentials ── */
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{result.companyName}</span>
                  </div>
                  <div className="border-t border-border pt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Admin Credentials</p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Name</p>
                        <p className="text-sm font-medium text-foreground">{result.firstName} {result.lastName}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Email</p>
                        <p className="text-sm font-mono text-foreground">{result.email}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(result.email, "email")}>
                        {copiedField === "email" ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Password</p>
                        <p className="text-sm font-mono text-foreground">{result.password}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(result.password, "password")}>
                        {copiedField === "password" ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-md bg-accent/50 border border-accent p-3">
                  <p className="text-xs text-muted-foreground">
                    ⚠️ Make sure to copy and securely share these credentials. The password cannot be retrieved after closing this dialog.
                  </p>
                </div>
                <Button className="w-full" onClick={() => { setOpen(false); resetForm(); }}>
                  Done
                </Button>
              </div>
            ) : (
              /* ── Form ── */
              <div className="space-y-5 pt-2">
                {/* Company Section */}
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

                {/* Admin Section */}
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
                        <input
                          type={showPassword ? "text" : "password"}
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          className="w-full text-sm border border-input rounded-lg px-3 py-2 pr-10 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="Min 6 characters"
                          minLength={6}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={!companyName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName || loading}
                  className="w-full"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Provisioning…
                    </span>
                  ) : (
                    "Provision Tenant & Create Admin"
                  )}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Tenants</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{tenants?.length || 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {tenants?.filter(t => t.status === "active").length || 0}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Suspended</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {tenants?.filter(t => t.status === "suspended").length || 0}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search tenants..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No tenants found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Company</th><th>Country</th><th>Industry</th><th>Plan</th><th>Status</th><th></th></tr>
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
                    }`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-accent">
                          <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleStatusChange(tenant.id, tenant.status === "active" ? "suspended" : "active")}>
                          {tenant.status === "active" ? "Suspend" : "Activate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
