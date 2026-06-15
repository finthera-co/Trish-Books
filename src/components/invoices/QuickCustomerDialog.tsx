import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTaxes, useAccounts } from "@/hooks/useData";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  onCreated?: (customerId: string) => void;
}

const PAYMENT_TERMS = [
  { value: "due_on_receipt", label: "Due on Receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
  { value: "net_90", label: "Net 90" },
];

const CUSTOMER_TYPES = [
  { value: "business", label: "Business" },
  { value: "individual", label: "Individual" },
];

const CUSTOMER_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "on_hold", label: "On Hold" },
];

const CURRENCIES = [
  { value: "LKR", label: "LKR — Sri Lankan Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "INR", label: "INR — Indian Rupee" },
];

// Radix Select cannot use "" as an item value, so optional overrides use a sentinel.
const NONE = "__none__";

const EMPTY_FORM = {
  // identity
  name: "",
  legal_name: "",
  customer_code: "",
  customer_type: "business",
  status: "active",
  // contact
  email: "",
  phone: "",
  mobile: "",
  contact_person: "",
  website: "",
  // tax / statutory  (tin + withholds_tax map to existing columns)
  tin: "",
  vat_number: "",
  is_tax_exempt: false,
  withholds_tax: false,
  // billing address
  bill_line1: "",
  bill_line2: "",
  bill_city: "",
  bill_state: "",
  bill_postal: "",
  bill_country: "Sri Lanka",
  // shipping address
  ship_same_as_billing: true,
  ship_line1: "",
  ship_line2: "",
  ship_city: "",
  ship_state: "",
  ship_postal: "",
  ship_country: "Sri Lanka",
  // financial controls
  currency: "LKR",
  payment_terms: "net_30",
  credit_limit: "",
  credit_hold: false,
  default_tax_id: "",
  ar_account_id: "",
  revenue_account_id: "",
  // misc
  registration_date: "",
  notes: "",
};

type CustomerForm = typeof EMPTY_FORM;

export function QuickCustomerDialog({ onCreated }: Props) {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  const { data: taxes } = useTaxes();
  const { data: accounts } = useAccounts();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);

  const set = (patch: Partial<CustomerForm>) => setForm((f) => ({ ...f, ...patch }));
  const reset = () => setForm(EMPTY_FORM);

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Customer name is required");
    if (!appUser?.tenant_id) return;
    setSaving(true);
    try {
      const tenantId = appUser.tenant_id;

      // 1. Insert the customer row with the full field set
      const { data, error } = await supabase
        .from("customers")
        .insert({
          tenant_id: tenantId,
          name: form.name.trim(),
          legal_name: form.legal_name.trim() || null,
          customer_code: form.customer_code.trim() || null,
          customer_type: form.customer_type,
          status: form.status,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          mobile: form.mobile.trim() || null,
          contact_person: form.contact_person.trim() || null,
          website: form.website.trim() || null,
          tin: form.tin.trim() || null,
          vat_number: form.vat_number.trim() || null,
          is_tax_exempt: form.is_tax_exempt,
          withholds_tax: form.withholds_tax,
          // legacy single-line address kept in sync for older read paths
          address: [form.bill_line1, form.bill_line2, form.bill_city].filter(Boolean).join(", ") || null,
          currency: form.currency,
          payment_terms: form.payment_terms,
          credit_limit: form.credit_limit ? Number(form.credit_limit) : 0,
          // opening_balance intentionally omitted: it must be posted through the
          // AR subledger (see useCreateCustomerWithOB), which this quick dialog
          // does not do. Set it from the Customers page instead.
          credit_hold: form.credit_hold,
          default_tax_id: form.default_tax_id || null,
          ar_account_id: form.ar_account_id || null,
          revenue_account_id: form.revenue_account_id || null,
          registration_date: form.registration_date || null,
          notes: form.notes.trim() || null,
        } as any)
        .select()
        .single();
      if (error) throw error;

      // 2. If any billing detail was entered, write billing + shipping rows
      const billing = {
        customer_id: data.id,
        tenant_id: tenantId,
        address_type: "billing",
        address_line1: form.bill_line1.trim() || null,
        address_line2: form.bill_line2.trim() || null,
        city: form.bill_city.trim() || null,
        state_province: form.bill_state.trim() || null,
        postal_code: form.bill_postal.trim() || null,
        country: form.bill_country.trim() || null,
        is_primary: true,
      };
      if (billing.address_line1 || billing.city) {
        const shipping = form.ship_same_as_billing
          ? { ...billing, address_type: "shipping" }
          : {
              customer_id: data.id,
              tenant_id: tenantId,
              address_type: "shipping",
              address_line1: form.ship_line1.trim() || null,
              address_line2: form.ship_line2.trim() || null,
              city: form.ship_city.trim() || null,
              state_province: form.ship_state.trim() || null,
              postal_code: form.ship_postal.trim() || null,
              country: form.ship_country.trim() || null,
              is_primary: true,
            };
        await supabase.from("customer_addresses").insert([billing, shipping] as any);
      }

      toast.success("Customer created");
      // Invoice dropdown reads ["customers"]; Customers page reads ["customers_with_balance"]
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      onCreated?.(data.id);
      reset();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to create customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="shrink-0" title="Create new customer">
          <Plus className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>

        <Tabs defaultValue="general" className="mt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="address">Address</TabsTrigger>
            <TabsTrigger value="tax">Tax</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
          </TabsList>

          {/* ---------------- GENERAL ---------------- */}
          <TabsContent value="general" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Display Name *</Label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
              </div>
              <div>
                <Label>Customer Code</Label>
                <Input value={form.customer_code} onChange={(e) => set({ customer_code: e.target.value })} placeholder="e.g. CUST-0001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Legal Name</Label>
                <Input value={form.legal_name} onChange={(e) => set({ legal_name: e.target.value })} placeholder="Registered legal entity name" />
              </div>
              <div>
                <Label>Customer Type</Label>
                <Select value={form.customer_type} onValueChange={(v) => set({ customer_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Contact Person</Label>
                <Input value={form.contact_person} onChange={(e) => set({ contact_person: e.target.value })} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
              </div>
              <div>
                <Label>Registration Date</Label>
                <Input type="date" value={form.registration_date} onChange={(e) => set({ registration_date: e.target.value })} />
              </div>
            </div>
          </TabsContent>

          {/* ---------------- ADDRESS ---------------- */}
          <TabsContent value="address" className="space-y-4 pt-4">
            <p className="text-sm font-medium text-foreground">Billing Address</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Address Line 1</Label><Input value={form.bill_line1} onChange={(e) => set({ bill_line1: e.target.value })} /></div>
              <div><Label>Address Line 2</Label><Input value={form.bill_line2} onChange={(e) => set({ bill_line2: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>City</Label><Input value={form.bill_city} onChange={(e) => set({ bill_city: e.target.value })} /></div>
              <div><Label>State / Province</Label><Input value={form.bill_state} onChange={(e) => set({ bill_state: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Postal Code</Label><Input value={form.bill_postal} onChange={(e) => set({ bill_postal: e.target.value })} /></div>
              <div><Label>Country</Label><Input value={form.bill_country} onChange={(e) => set({ bill_country: e.target.value })} /></div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Switch checked={form.ship_same_as_billing} onCheckedChange={(v) => set({ ship_same_as_billing: v })} />
              <Label className="cursor-pointer">Shipping address same as billing</Label>
            </div>

            {!form.ship_same_as_billing && (
              <>
                <p className="text-sm font-medium text-foreground pt-2">Shipping Address</p>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Address Line 1</Label><Input value={form.ship_line1} onChange={(e) => set({ ship_line1: e.target.value })} /></div>
                  <div><Label>Address Line 2</Label><Input value={form.ship_line2} onChange={(e) => set({ ship_line2: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>City</Label><Input value={form.ship_city} onChange={(e) => set({ ship_city: e.target.value })} /></div>
                  <div><Label>State / Province</Label><Input value={form.ship_state} onChange={(e) => set({ ship_state: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Postal Code</Label><Input value={form.ship_postal} onChange={(e) => set({ ship_postal: e.target.value })} /></div>
                  <div><Label>Country</Label><Input value={form.ship_country} onChange={(e) => set({ ship_country: e.target.value })} /></div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ---------------- TAX ---------------- */}
          <TabsContent value="tax" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>TIN</Label>
                <Input value={form.tin} onChange={(e) => set({ tin: e.target.value })} />
              </div>
              <div>
                <Label>VAT Registration No.</Label>
                <Input value={form.vat_number} onChange={(e) => set({ vat_number: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Default Tax Rate</Label>
              <Select value={form.default_tax_id || NONE} onValueChange={(v) => set({ default_tax_id: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(taxes || []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.tax_name} ({t.tax_rate}%)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={form.is_tax_exempt} onCheckedChange={(v) => set({ is_tax_exempt: v })} />
              <Label className="cursor-pointer">Tax exempt</Label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="cursor-pointer">Withholds tax on payments</Label>
                <p className="text-xs text-muted-foreground">Customer deducts WHT when paying us</p>
              </div>
              <Switch checked={form.withholds_tax} onCheckedChange={(v) => set({ withholds_tax: v })} />
            </div>
          </TabsContent>

          {/* ---------------- FINANCIAL ---------------- */}
          <TabsContent value="financial" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => set({ currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Terms</Label>
                <Select value={form.payment_terms} onValueChange={(v) => set({ payment_terms: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Credit Limit</Label>
              <Input type="number" step="0.01" value={form.credit_limit} onChange={(e) => set({ credit_limit: e.target.value })} placeholder="0.00" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.credit_hold} onCheckedChange={(v) => set({ credit_hold: v })} />
              <Label className="cursor-pointer">Place customer on credit hold</Label>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <Label>AR Account Override</Label>
                <Select value={form.ar_account_id || NONE} onValueChange={(v) => set({ ar_account_id: v === NONE ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Use default AR" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Use default AR</SelectItem>
                    {(accounts || []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Revenue Account Override</Label>
                <Select value={form.revenue_account_id || NONE} onValueChange={(v) => set({ revenue_account_id: v === NONE ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Use default revenue" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Use default revenue</SelectItem>
                    {(accounts || []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} />
            </div>
          </TabsContent>
        </Tabs>

        <Button className="w-full mt-4" onClick={handleSave} disabled={saving || !form.name.trim()}>
          {saving ? "Creating..." : "Create Customer"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
