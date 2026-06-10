import { useState, useEffect } from "react";
import {
  useAccountSettings,
  useUpsertAccountSettings,
  useAccountSettingsCompleteness,
  type AccountSettings,
} from "@/hooks/useAccountSettings";
import AccountSelector from "@/components/shared/AccountSelector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Settings,
  Save,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── Dr/Cr badge helpers ──────────────────────────────────────────────────────

const Dr = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
    Dr
  </span>
);
const Cr = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
    Cr
  </span>
);
const DrCr = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
    Dr/Cr
  </span>
);

// ── Field row ────────────────────────────────────────────────────────────────

interface FieldRowProps {
  fieldKey: keyof AccountSettings;
  label: string;
  badge: React.ReactNode;
  types: string[];
  hint: string;
  form: Partial<AccountSettings>;
  set: (key: keyof AccountSettings) => (val: string) => void;
}

function FieldRow({ fieldKey, label, badge, types, hint, form, set }: FieldRowProps) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          {badge}
        </div>
        <AccountSelector
          value={(form[fieldKey] as string | null) ?? ""}
          onChange={set(fieldKey)}
          types={types}
          placeholder="Search account…"
        />
        <p className="text-xs text-muted-foreground italic">{hint}</p>
      </div>
    </div>
  );
}

// ── Sample journal collapsible ────────────────────────────────────────────────

interface JournalRow {
  account: string;
  dr?: string;
  cr?: string;
  indent?: boolean;
}

interface SampleJournalProps {
  tabKey: string;
  title: string;
  rows: JournalRow[];
  previewOpen: Record<string, boolean>;
  setPreviewOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

function SampleJournal({ tabKey, title, rows, previewOpen, setPreviewOpen }: SampleJournalProps) {
  const open = previewOpen[tabKey] ?? false;
  return (
    <Collapsible
      open={open}
      onOpenChange={(v) => setPreviewOpen((p) => ({ ...p, [tabKey]: v }))}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground w-full justify-between mt-4"
        >
          {title}
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md border border-border bg-muted/30 text-xs font-mono">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Account</th>
                <th className="text-right px-3 py-1.5 text-muted-foreground font-medium w-24">Dr</th>
                <th className="text-right px-3 py-1.5 text-muted-foreground font-medium w-24">Cr</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className={`px-3 py-1.5 ${row.indent ? "pl-8" : ""}`}>{row.account}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.dr ?? ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.cr ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountMapping() {
  const { data: settings, isLoading } = useAccountSettings();
  const { data: completeness } = useAccountSettingsCompleteness();
  const upsert = useUpsertAccountSettings();

  const [form, setForm] = useState<Partial<AccountSettings>>({});
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const set = (key: keyof AccountSettings) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val || null }));

  const handleSave = () => {
    const payload: Partial<AccountSettings> = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === "" ? null : v])
    ) as Partial<AccountSettings>;
    upsert.mutate(payload);
  };

  // ── Completeness banner ───────────────────────────────────────────────────

  const renderBanner = () => {
    if (!completeness) return null;
    if (completeness.fully_complete) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <p className="text-sm font-medium text-emerald-800">
            All 19 accounts mapped — posting engines have full coverage.
          </p>
        </div>
      );
    }
    if (completeness.critical_complete) {
      return (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-amber-800">
              Core accounts mapped. Missing recommended:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {completeness.recommended_missing.map((f) => (
                <Badge key={f} variant="outline" className="text-xs font-mono">
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-medium text-red-800">
            Critical accounts missing — posting will fail:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {completeness.critical_missing.map((f) => (
              <Badge key={f} variant="destructive" className="text-xs font-mono">
                {f}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-52 bg-muted rounded" />
          <div className="h-14 bg-muted rounded-lg" />
          <div className="h-72 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const sharedProps = { form, set };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account Mapping</h1>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
            Default GL accounts used by automated posting engines. Each entry shows the journal
            role (Dr / Cr) so you know exactly what will be debited or credited.
          </p>
        </div>
      </div>

      {/* Completeness banner */}
      {renderBanner()}

      {/* Tabs */}
      <Tabs defaultValue="core">
        <TabsList>
          <TabsTrigger value="core">Core</TabsTrigger>
          <TabsTrigger value="inventory">Inventory &amp; Procurement</TabsTrigger>
          <TabsTrigger value="assets">Fixed Assets</TabsTrigger>
          <TabsTrigger value="equity">Equity &amp; FX</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Core ─────────────────────────────────────────────────── */}
        <TabsContent value="core" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Core AR / AP / Sales</CardTitle>
              <CardDescription>
                Required for invoice posting, bill posting, and payment recording.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldRow fieldKey="ar_account_id" label="Accounts Receivable" badge={<Dr />}
                types={["Asset"]}
                hint="Debited on invoice post; credited on payment receipt."
                {...sharedProps} />
              <FieldRow fieldKey="sales_account_id" label="Default Sales Revenue" badge={<Cr />}
                types={["Income", "Revenue"]}
                hint="Credited on invoice lines with no specific revenue account."
                {...sharedProps} />
              <FieldRow fieldKey="tax_payable_account_id" label="Tax Payable" badge={<Cr />}
                types={["Liability"]}
                hint="Credited for the tax portion of every posted invoice and bill."
                {...sharedProps} />
              <FieldRow fieldKey="ap_account_id" label="Accounts Payable" badge={<Cr />}
                types={["Liability"]}
                hint="Credited on bill post; debited on supplier payment."
                {...sharedProps} />
              <FieldRow fieldKey="bank_account_id" label="Default Bank / Cash" badge={<DrCr />}
                types={["Asset"]}
                hint="Debited on payment receipt; credited on supplier payment."
                {...sharedProps} />
              <SampleJournal
                tabKey="core"
                title="Sample journal entry — Invoice Post"
                rows={[
                  { account: "Accounts Receivable", dr: "1,150.00" },
                  { account: "Sales Revenue", cr: "1,000.00", indent: true },
                  { account: "Tax Payable", cr: "150.00", indent: true },
                ]}
                previewOpen={previewOpen}
                setPreviewOpen={setPreviewOpen}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Inventory & Procurement ────────────────────────────── */}
        <TabsContent value="inventory" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Inventory &amp; Procurement</CardTitle>
              <CardDescription>
                Stock movements, cost of sales, and the three-way match clearing cycle.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldRow fieldKey="inventory_account_id" label="Inventory / Stock Control" badge={<Dr />}
                types={["Asset"]}
                hint="Debited on GRN receipt; credited on COGS entry at sale."
                {...sharedProps} />
              <FieldRow fieldKey="cogs_account_id" label="Cost of Goods Sold" badge={<Dr />}
                types={["Cost of Goods Sold", "Expense"]}
                hint="Debited when an invoiced tracked product is issued from stock."
                {...sharedProps} />
              <FieldRow fieldKey="grni_clearing_account_id" label="Goods Received Not Invoiced" badge={<DrCr />}
                types={["Liability"]}
                hint="Credited on GRN (accrual); debited when supplier bill is posted."
                {...sharedProps} />
              <FieldRow fieldKey="purchase_price_variance_account_id" label="Purchase Price Variance (PPV)" badge={<DrCr />}
                types={["Expense", "Cost of Goods Sold"]}
                hint="Captures cost difference between PO/GRN cost and actual bill cost."
                {...sharedProps} />
              <SampleJournal
                tabKey="inventory"
                title="Sample journal entry — GRN Receipt"
                rows={[
                  { account: "Inventory / Stock", dr: "500.00" },
                  { account: "GRNI Clearing", cr: "500.00", indent: true },
                ]}
                previewOpen={previewOpen}
                setPreviewOpen={setPreviewOpen}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Fixed Assets ───────────────────────────────────────── */}
        <TabsContent value="assets" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Fixed Assets</CardTitle>
              <CardDescription>Global fallback accounts for depreciation and disposal (IAS 16).</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                Asset Category-level accounts take priority when set. These are global fallbacks for categories missing account mappings.
              </p>
              <FieldRow fieldKey="depreciation_expense_account_id" label="Depreciation Expense" badge={<Dr />}
                types={["Expense"]}
                hint="Debited on each monthly depreciation journal (IAS 16)."
                {...sharedProps} />
              <FieldRow fieldKey="accumulated_depreciation_account_id" label="Accumulated Depreciation" badge={<Cr />}
                types={["Asset"]}
                hint="Credited on depreciation. Contra-asset account."
                {...sharedProps} />
              <FieldRow fieldKey="disposal_gain_account_id" label="Gain on Asset Disposal" badge={<Cr />}
                types={["Income", "Other Income"]}
                hint="Credited when sale proceeds exceed Net Book Value (IAS 16)."
                {...sharedProps} />
              <FieldRow fieldKey="disposal_loss_account_id" label="Loss on Asset Disposal" badge={<Dr />}
                types={["Expense", "Other Expense"]}
                hint="Debited when sale proceeds are below Net Book Value (IAS 16)."
                {...sharedProps} />
              <SampleJournal
                tabKey="assets"
                title="Sample journal entry — Monthly Depreciation"
                rows={[
                  { account: "Depreciation Expense", dr: "833.00" },
                  { account: "Accumulated Depreciation", cr: "833.00", indent: true },
                ]}
                previewOpen={previewOpen}
                setPreviewOpen={setPreviewOpen}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Equity & FX ────────────────────────────────────────── */}
        <TabsContent value="equity" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Equity &amp; Foreign Exchange</CardTitle>
              <CardDescription>Period-close and multi-currency revaluation (IAS 21).</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldRow fieldKey="retained_earnings_account_id" label="Retained Earnings" badge={<DrCr />}
                types={["Equity"]}
                hint="Net income transferred here on period close. Required for year-end closing journals."
                {...sharedProps} />
              <FieldRow fieldKey="fx_gain_account_id" label="FX Gain (IAS 21)" badge={<Cr />}
                types={["Income", "Other Income"]}
                hint="Credited on favourable foreign currency re-measurement at period-end."
                {...sharedProps} />
              <FieldRow fieldKey="fx_loss_account_id" label="FX Loss (IAS 21)" badge={<Dr />}
                types={["Expense", "Other Expense"]}
                hint="Debited on adverse foreign currency re-measurement at period-end."
                {...sharedProps} />
              <SampleJournal
                tabKey="equity"
                title="Sample journal entry — Period Close (net profit)"
                rows={[
                  { account: "Sales Revenue (all income)", dr: "50,000.00" },
                  { account: "Retained Earnings", cr: "50,000.00", indent: true },
                ]}
                previewOpen={previewOpen}
                setPreviewOpen={setPreviewOpen}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 5: Payroll ────────────────────────────────────────────── */}
        <TabsContent value="payroll" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Payroll</CardTitle>
              <CardDescription>Global fallback accounts for payroll posting.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                Payroll GL Mapping (component-level) takes priority. These are global fallbacks only.
              </p>
              <FieldRow fieldKey="wages_expense_account_id" label="Salaries & Wages Expense" badge={<Dr />}
                types={["Expense"]}
                hint="Debited for gross payroll when no component-level mapping exists."
                {...sharedProps} />
              <FieldRow fieldKey="payroll_clearing_account_id" label="Payroll Clearing" badge={<Cr />}
                types={["Liability"]}
                hint="Credited for net pay amounts pending bank transfer."
                {...sharedProps} />
              <SampleJournal
                tabKey="payroll"
                title="Sample journal entry — Payroll Post"
                rows={[
                  { account: "Salaries & Wages Expense", dr: "80,000.00" },
                  { account: "Payroll Clearing", cr: "80,000.00", indent: true },
                ]}
                previewOpen={previewOpen}
                setPreviewOpen={setPreviewOpen}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save button */}
      <div className="flex justify-end pt-4">
        <Button onClick={handleSave} disabled={upsert.isPending} className="gap-2">
          <Save className="w-4 h-4" />
          {upsert.isPending ? "Saving…" : "Save Mapping"}
        </Button>
      </div>
    </div>
  );
}
