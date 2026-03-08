import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  
  // Get tenant info
  const { data: tenant } = useQuery({
    queryKey: ["tenant", appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return null;
      const { data } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", appUser.tenant_id)
        .single();
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });

  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [saving, setSaving] = useState(false);

  // Initialize form when tenant loads
  useEffect(() => {
    if (tenant) {
      setCompanyName(tenant.company_name);
      setCountry(tenant.country || "");
    }
  }, [tenant]);

  const handleSave = async () => {
    if (!appUser?.tenant_id) return;
    setSaving(true);
    
    const { error } = await supabase
      .from("tenants")
      .update({ 
        company_name: companyName || tenant?.company_name, 
        country: country || tenant?.country 
      })
      .eq("id", appUser.tenant_id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["tenant"] });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Manage your account and preferences</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-2xl">
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Company Information</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Company Name</label>
              <input 
                type="text" 
                value={companyName || tenant?.company_name || ""} 
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" 
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Country</label>
              <input 
                type="text" 
                value={country || tenant?.country || ""} 
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" 
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Your Account</h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground">Name</label>
              <p className="font-medium text-foreground">{appUser?.first_name} {appUser?.last_name}</p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Email</label>
              <p className="font-medium text-foreground">{appUser?.email}</p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Role</label>
              <p className="font-medium text-foreground">{appUser?.role_name}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
