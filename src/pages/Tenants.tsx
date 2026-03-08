import { Building2, Plus, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTenants, useCreateTenant, useUpdateTenant, useSubscriptionPlans } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Tenants() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [planId, setPlanId] = useState("");
  
  const { data: tenants, isLoading } = useTenants();
  const { data: plans } = useSubscriptionPlans();
  const createTenant = useCreateTenant();
  const updateTenant = useUpdateTenant();
  const { isSuperAdmin } = useAuth();

  const filtered = tenants?.filter((t) =>
    t.company_name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async () => {
    await createTenant.mutateAsync({ 
      company_name: companyName, 
      country, 
      subscription_plan_id: planId || undefined 
    });
    setOpen(false);
    setCompanyName("");
    setCountry("");
    setPlanId("");
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
          <p className="page-description">Manage companies and their subscriptions</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Add Tenant</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Tenant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Company Name</label>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <div>
                <label className="text-sm font-medium">Country</label>
                <input type="text" value={country} onChange={(e) => setCountry(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <div>
                <label className="text-sm font-medium">Subscription Plan</label>
                <select value={planId} onChange={(e) => setPlanId(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">Select plan...</option>
                  {plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <Button onClick={handleCreate} disabled={!companyName || createTenant.isPending} className="w-full">
                {createTenant.isPending ? "Creating..." : "Create Tenant"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

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
              <tr><th>Company</th><th>Country</th><th>Plan</th><th>Status</th><th></th></tr>
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
                  <td>{tenant.country || "-"}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {(tenant.subscription_plans as any)?.name || "None"}
                    </span>
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      tenant.status === "active" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
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
