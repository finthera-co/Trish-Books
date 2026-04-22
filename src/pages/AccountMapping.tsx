import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAccountSettings, useUpsertAccountSettings } from "@/hooks/useAccountSettings";
import AccountSelector from "@/components/shared/AccountSelector";
import { Settings, Save } from "lucide-react";

export default function AccountMapping() {
  const { data: settings, isLoading } = useAccountSettings();
  const upsert = useUpsertAccountSettings();

  const [form, setForm] = useState({
    ar_account_id: "",
    sales_account_id: "",
    tax_payable_account_id: "",
    ap_account_id: "",
    bank_account_id: "",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        ar_account_id: settings.ar_account_id || "",
        sales_account_id: settings.sales_account_id || "",
        tax_payable_account_id: settings.tax_payable_account_id || "",
        ap_account_id: settings.ap_account_id || "",
        bank_account_id: settings.bank_account_id || "",
      });
    }
  }, [settings]);

  const handleSave = () => {
    upsert.mutate({
      ar_account_id: form.ar_account_id || null,
      sales_account_id: form.sales_account_id || null,
      tax_payable_account_id: form.tax_payable_account_id || null,
      ap_account_id: form.ap_account_id || null,
      bank_account_id: form.bank_account_id || null,
    });
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const fields: { key: keyof typeof form; label: string; types: string[]; hint: string }[] = [
    { key: "ar_account_id", label: "Accounts Receivable", types: ["Asset"], hint: "Default AR control account for invoices" },
    { key: "sales_account_id", label: "Default Sales Revenue", types: ["Revenue", "Income"], hint: "Used when an invoice line has no specific account" },
    { key: "tax_payable_account_id", label: "Tax Payable", types: ["Liability"], hint: "Required when invoices have tax" },
    { key: "ap_account_id", label: "Accounts Payable", types: ["Liability"], hint: "Default AP control for bills" },
    { key: "bank_account_id", label: "Default Bank", types: ["Asset"], hint: "Default cash/bank for payments received" },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Account Mapping</h1>
          <p className="text-sm text-muted-foreground">Default GL accounts used by automated posting (invoices, bills, payments).</p>
        </div>
      </div>

      <Card className="p-6 space-y-5">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label className="text-sm font-medium">{f.label}</Label>
            <AccountSelector
              value={form[f.key]}
              onChange={(v) => setForm({ ...form, [f.key]: v })}
              types={f.types}
              placeholder="Search account…"
            />
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={upsert.isPending}>
            <Save className="w-4 h-4" />
            {upsert.isPending ? "Saving…" : "Save Mapping"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
