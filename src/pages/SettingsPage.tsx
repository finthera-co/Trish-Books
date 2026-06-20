import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Upload, Loader2, X } from "lucide-react";

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
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Initialize form when tenant loads
  useEffect(() => {
    if (tenant) {
      setCompanyName(tenant.company_name);
      setCountry(tenant.country || "");
      setRegistrationNumber(tenant.registration_number || "");
      setLogoUrl(tenant.logo_url || "");
    }
  }, [tenant]);

  const handleUploadLogo = async (file: File) => {
    if (!appUser?.tenant_id) return toast.error("No tenant");
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 2 * 1024 * 1024) return toast.error("Logo must be under 2 MB");
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${appUser.tenant_id}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("invoice-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("invoice-assets").getPublicUrl(path);
      setLogoUrl(pub.publicUrl);
      toast.success("Logo uploaded — remember to save changes");
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message || "unknown error"));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    if (!appUser?.tenant_id) return;
    setSaving(true);

    const { error } = await supabase
      .from("tenants")
      .update({
        company_name: companyName || tenant?.company_name,
        country: country || tenant?.country,
        registration_number: registrationNumber.trim() || null,
        logo_url: logoUrl || null,
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
            <div>
              <label className="text-sm text-muted-foreground">Business Registration No.</label>
              <input
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="PV 12345678"
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">Printed centered at the foot of every invoice.</p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Company Logo</label>
              <div className="mt-1 flex items-start gap-4">
                <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">No logo</span>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={uploadingLogo}
                      onClick={() => logoInputRef.current?.click()}>
                      {uploadingLogo ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
                      {uploadingLogo ? "Uploading…" : logoUrl ? "Replace" : "Upload logo"}
                    </Button>
                    {logoUrl && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setLogoUrl("")}>
                        <X className="w-4 h-4 mr-1.5" /> Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    Recommended: a PNG with a transparent background, about <strong>300 × 120 px</strong> (landscape)
                    or <strong>240 × 240 px</strong> (square), under 2 MB. The logo keeps its aspect ratio when
                    placed on the invoice, so upload a sharp, high-resolution image — small or stretched files
                    look blurry in print.
                  </p>
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadLogo(f); e.target.value = ""; }} />
                </div>
              </div>
            </div>
            <Button onClick={handleSave} disabled={saving || uploadingLogo}>
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
