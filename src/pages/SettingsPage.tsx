import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Upload, Loader2, X, AlertTriangle } from "lucide-react";
import { MfaCard } from "@/components/security/MfaCard";
import { StorageUsageCard } from "@/components/settings/StorageUsageCard";
import { useCompanyProfile, useUpdateCompanyProfile } from "@/hooks/useCompanyProfile";

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
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [financialYearEnd, setFinancialYearEnd] = useState(3);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Initialize form when tenant loads
  useEffect(() => {
    if (tenant) {
      setCompanyName(tenant.company_name);
      setCountry(tenant.country || "");
      setRegistrationNumber(tenant.registration_number || "");
      setTaxId(tenant.tax_id || "");
      setAddress(tenant.address || "");
      setPhone(tenant.phone || "");
      setLogoUrl(tenant.logo_url || "");
      setFinancialYearEnd(tenant.financial_year_end ?? 3);
    }
  }, [tenant]);

  // Company profile: presentation/statutory data additive to the tenant fields
  // above (trading name, VAT/SVAT, address remainder, bank details, invoice text).
  const { data: profile } = useCompanyProfile();
  const updateProfile = useUpdateCompanyProfile();

  const [tradingName, setTradingName] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [vatRegistrationNo, setVatRegistrationNo] = useState("");
  const [svatRegistrationNo, setSvatRegistrationNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankSwift, setBankSwift] = useState("");
  const [defaultBranchCode, setDefaultBranchCode] = useState("");
  const [invoiceTerms, setInvoiceTerms] = useState("");
  const [invoiceFooterNote, setInvoiceFooterNote] = useState("");

  useEffect(() => {
    if (profile) {
      setTradingName(profile.trading_name || "");
      setAddressLine2(profile.address_line2 || "");
      setCity(profile.city || "");
      setPostalCode(profile.postal_code || "");
      setEmail(profile.email || "");
      setWebsite(profile.website || "");
      setIsVatRegistered(!!profile.is_vat_registered);
      setVatRegistrationNo(profile.vat_registration_no || "");
      setSvatRegistrationNo(profile.svat_registration_no || "");
      setBankName(profile.bank_name || "");
      setBankBranch(profile.bank_branch || "");
      setBankAccountName(profile.bank_account_name || "");
      setBankAccountNo(profile.bank_account_no || "");
      setBankSwift(profile.bank_swift || "");
      setDefaultBranchCode(profile.default_branch_code || "");
      setInvoiceTerms(profile.invoice_terms || "");
      setInvoiceFooterNote(profile.invoice_footer_note || "");
    }
  }, [profile]);

  const handleSaveProfile = () => {
    updateProfile.mutate({
      trading_name: tradingName.trim() || null,
      address_line2: addressLine2.trim() || null,
      city: city.trim() || null,
      postal_code: postalCode.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      is_vat_registered: isVatRegistered,
      vat_registration_no: isVatRegistered ? (vatRegistrationNo.trim() || null) : null,
      svat_registration_no: isVatRegistered ? (svatRegistrationNo.trim() || null) : null,
      bank_name: bankName.trim() || null,
      bank_branch: bankBranch.trim() || null,
      bank_account_name: bankAccountName.trim() || null,
      bank_account_no: bankAccountNo.trim() || null,
      bank_swift: bankSwift.trim() || null,
      default_branch_code: defaultBranchCode.trim() || null,
      invoice_terms: invoiceTerms.trim() || null,
      invoice_footer_note: invoiceFooterNote.trim() || "Thank you for your business",
    });
  };

  const missingSupplierDetails =
    !(companyName || tenant?.company_name) || !address.trim() || !phone.trim() || !bankAccountNo.trim();

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

    const { data, error } = await supabase
      .from("tenants")
      .update({
        company_name: companyName || tenant?.company_name,
        country: country || tenant?.country,
        registration_number: registrationNumber.trim() || null,
        tax_id: taxId.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        logo_url: logoUrl || null,
        financial_year_end: financialYearEnd,
      })
      .eq("id", appUser.tenant_id)
      .select("id");

    if (error) {
      toast.error(error.message);
    } else if (!data || data.length === 0) {
      // RLS matched no rows — the update silently did nothing.
      toast.error("You don't have permission to update company settings.");
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

      {missingSupplierDetails && (
        <div className="max-w-2xl flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-sm">Your invoices are missing supplier details required to be paid. Complete your company profile.</p>
        </div>
      )}

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
              <label className="text-sm text-muted-foreground">Tax Registration Number (TIN)</label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="123456789"
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
              <p className={`mt-1 text-xs ${taxId.trim() && !/^\d{9}$/.test(taxId.trim()) ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {taxId.trim() && !/^\d{9}$/.test(taxId.trim())
                  ? "TIN should be 9 digits (IRD VAT tax invoice requirement)."
                  : "Supplier TIN — 9 digits. Printed on the statutory tax invoice."}
              </p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Financial Year End</label>
              <select
                value={financialYearEnd}
                onChange={(e) => setFinancialYearEnd(Number(e.target.value))}
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              >
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
                  .map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Determines the "As At" / "For the Year Ended" date shown on financial statements.</p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="Registered business address"
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Telephone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+94 ..."
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
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
          <h3 className="text-sm font-medium text-foreground mb-4">Company Identity</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Trading Name</label>
              <input
                type="text"
                value={tradingName}
                onChange={(e) => setTradingName(e.target.value)}
                placeholder="Brand name, if different from the legal name above"
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">The registered name shown on invoices and statutory documents is set above (Company Name). This is the brand name shown in the invoice logo lockup, if it differs.</p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Address & Contact</h3>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-2">Address line 1, country and telephone are set in Company Information above. These fill out the rest.</p>
            <div>
              <label className="text-sm text-muted-foreground">Address Line 2</label>
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Postal Code</label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Website</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://"
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Tax Registration</h3>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-2">TIN is set in Company Information above.</p>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-muted-foreground cursor-pointer">VAT Registered</label>
                <p className="text-xs text-muted-foreground">Enables the VAT/SVAT registration fields below.</p>
              </div>
              <Switch checked={isVatRegistered} onCheckedChange={setIsVatRegistered} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">VAT Registration No.</label>
                <input
                  type="text"
                  value={vatRegistrationNo}
                  onChange={(e) => setVatRegistrationNo(e.target.value)}
                  disabled={!isVatRegistered}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">SVAT Registration No.</label>
                <input
                  type="text"
                  value={svatRegistrationNo}
                  onChange={(e) => setSvatRegistrationNo(e.target.value)}
                  disabled={!isVatRegistered}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Bank Details</h3>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-2">Printed in the Payment Details panel at the foot of every invoice PDF, so customers can remit payment. Blank fields are left off.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Bank Name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Branch</label>
                <input
                  type="text"
                  value={bankBranch}
                  onChange={(e) => setBankBranch(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Account Holder Name</label>
              <input
                type="text"
                value={bankAccountName}
                onChange={(e) => setBankAccountName(e.target.value)}
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Account Number</label>
                <input
                  type="text"
                  value={bankAccountNo}
                  onChange={(e) => setBankAccountNo(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">SWIFT</label>
                <input
                  type="text"
                  value={bankSwift}
                  onChange={(e) => setBankSwift(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Invoice Defaults</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Branch / Entity Code (QQQQ)</label>
              <input
                type="text"
                value={defaultBranchCode}
                // A serial may not contain whitespace, so never let one in.
                onChange={(e) => setDefaultBranchCode(e.target.value.replace(/\s/g, ""))}
                maxLength={15}
                placeholder="MAIN"
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The QQQQ segment of your invoice serials (YYMMM_QQQQ_XXXXX). Pre-filled on every new
                invoice; falls back to MAIN when blank.
              </p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Invoice Terms</label>
              <textarea
                value={invoiceTerms}
                onChange={(e) => setInvoiceTerms(e.target.value)}
                rows={3}
                placeholder="Payment is due within 30 days of the invoice date."
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Footer Note</label>
              <input
                type="text"
                value={invoiceFooterNote}
                onChange={(e) => setInvoiceFooterNote(e.target.value)}
                placeholder="Thank you for your business"
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <Button onClick={handleSaveProfile} disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Saving..." : "Save Changes"}
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

        <MfaCard />
        <StorageUsageCard />
      </div>
    </div>
  );
}
