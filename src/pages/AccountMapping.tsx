import { useState, useEffect } from "react";
import {
  useAccountSettings,
  useUpsertAccountSettings,
  useAccountSettingsCompleteness,
  type AccountSettings,
} from "@/hooks/useAccountSettings";
import AccountSelector from "@/components/shared/AccountSelector";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Settings,
  Save,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  BookOpen,
  TrendingUp,
  Package,
  Landmark,
  RefreshCw,
  DollarSign,
  ArrowRight,
  ChevronDown,
  Loader2,
} from "lucide-react";

// ── Badges ──────────────────────────────────────────────────────────────────

function DrBadge() {
  return (
    <Badge className="rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-50 text-xs font-semibold px-2 py-0.5 shrink-0">
      Dr
    </Badge>
  );
}

function CrBadge() {
  return (
    <Badge className="rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-50 text-xs font-semibold px-2 py-0.5 shrink-0">
      Cr
    </Badge>
  );
}

function DrCrBadge() {
  return (
    <span className="flex gap-1 shrink-0">
      <DrBadge />
      <CrBadge />
    </span>
  );
}

// ── FieldRow ─────────────────────────────────────────────────────────────────

interface FieldRowProps {
  fieldKey: keyof AccountSettings;
  label: string;
  side: "Dr" | "Cr" | "Dr/Cr";
  types: string[];
  hint: string;
  value: string | null | undefined;
  onChange: (key: keyof AccountSettings, value: string | null) => void;
}

function FieldRow({ fieldKey, label, side, types, hint, value, onChange }: FieldRowProps) {
  const id = `field-${String(fieldKey)}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Label htmlFor={id} className="font-medium text-sm w-52 shrink-0 leading-tight">
          {label}
        </Label>
        <div className="shrink-0">
          {side === "Dr" ? <DrBadge /> : side === "Cr" ? <CrBadge /> : <DrCrBadge />}
        </div>
        <div className="flex-1">
          <AccountSelector
            id={id}
            value={value ?? null}
            onChange={(val) => onChange(fieldKey, val || null)}
            types={types}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground italic pl-[calc(13rem+2.75rem+0.75rem)]">
        {hint}
      </p>
    </div>
  );
}

// ── Sample Journal ────────────────────────────────────────────────────────────

interface JournalRow {
  side: "Dr" | "Cr";
  account: string;
  dr?: string;
  cr?: string;
}

function SampleJournal({ title, rows }: { title: string; rows: JournalRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-xs h-7 px-2"
        >
          <BookOpen className="h-3.5 w-3.5" />
          {title}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border bg-muted/30 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-10">Side</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Account</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Dr</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Cr</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    {r.side === "Dr" ? <DrBadge /> : <CrBadge />}
                  </td>
                  <td className="px-3 py-1.5 text-foreground">{r.account}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-foreground">{r.dr ?? ""}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-foreground">{r.cr ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Completeness Banner ───────────────────────────────────────────────────────

type Completeness = ReturnType<typeof useAccountSettingsCompleteness>["data"];

function CompletenessBanner({ completeness }: { completeness: Completeness }) {
  if (!completeness) return null;

  if (!completeness.configured) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
        <p className="text-sm font-medium text-red-800">
          No account settings configured for this tenant.
        </p>
      </div>
    );
  }

  if (completeness.fully_complete) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
        <p className="text-sm font-medium text-green-800">
          All accounts mapped — posting engines have full coverage.
        </p>
      </div>
    );
  }

  if (completeness.critical_complete) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-medium text-yellow-800">
            Core accounts mapped. Recommended accounts below are missing — some modules may not
            post correctly.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {completeness.recommended_missing.map((f) => (
              <span
                key={f}
                className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 border border-yellow-200"
              >
                {f}
              </span>
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
          Critical accounts missing — posting will fail.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {completeness.critical_missing.map((f) => (
            <span
              key={f}
              className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 border border-red-200"
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AccountMapping() {
  const { data: settings, isLoading } = useAccountSettings();
  const { data: completeness } = useAccountSettingsCompleteness();
  const upsert = useUpsertAccountSettings();
  const [form, setForm] = useState<Partial<AccountSettings>>({});

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const setField = (key: keyof AccountSettings, value: string | null) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-52 bg-muted rounded" />
          <div className="h-4 w-[480px] bg-muted rounded" />
          <div className="h-14 bg-muted rounded-lg" />
          <div className="h-72 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-28">
      {/* ── Header ──────────────────────────────────────────────────────── */}
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

      {/* ── Completeness banner ──────────────────────────────────────────── */}
      <CompletenessBanner completeness={completeness} />

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="core">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="core" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <DollarSign className="h-3.5 w-3.5" />
            Core
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Package className="h-3.5 w-3.5" />
            Inventory &amp; Procurement
          </TabsTrigger>
          <TabsTrigger value="fixed-assets" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Landmark className="h-3.5 w-3.5" />
            Fixed Assets
          </TabsTrigger>
          <TabsTrigger value="equity-fx" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="h-3.5 w-3.5" />
            Equity &amp; FX
          </TabsTrigger>
          <TabsTrigger value="payroll" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <RefreshCw className="h-3.5 w-3.5" />
            Payroll
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Core ───────────────────────────────────────────────── */}
        <TabsContent value="core" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Core AR / AP / Sales</CardTitle>
              <CardDescription>
                Fundamental accounts required for invoice posting, bill posting, and payment recording.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow
                fieldKey="ar_account_id"
                label="Accounts Receivable"
                side="Dr"
                types={["Asset"]}
                hint="Debited when an invoice is posted; credited when payment is received."
                value={form.ar_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="sales_account_id"
                label="Default Sales Revenue"
                side="Cr"
                types={["Income", "Revenue"]}
                hint="Credited on every invoice line that has no specific revenue account."
                value={form.sales_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="tax_payable_account_id"
                label="Tax Payable"
                side="Cr"
                types={["Liability"]}
                hint="Credited for the tax portion of every posted invoice and bill."
                value={form.tax_payable_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="ap_account_id"
                label="Accounts Payable"
                side="Cr"
                types={["Liability"]}
                hint="Credited when a supplier bill is posted; debited when a payment is made."
                value={form.ap_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="bank_account_id"
                label="Default Bank / Cash"
                side="Dr/Cr"
                types={["Asset"]}
                hint="Debited on customer payment receipt; credited on supplier payment."
                value={form.bank_account_id}
                onChange={setField}
              />
              <Separator />
              <SampleJournal
                title="Sample Journal Entry — Invoice Post"
                rows={[
                  { side: "Dr", account: "Accounts Receivable", dr: "1,150.00" },
                  { side: "Cr", account: "Sales Revenue", cr: "1,000.00" },
                  { side: "Cr", account: "Tax Payable", cr: "150.00" },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Inventory & Procurement ────────────────────────────── */}
        <TabsContent value="inventory" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Inventory &amp; Procurement</CardTitle>
              <CardDescription>
                Accounts for stock movements, cost of sales, and the three-way match clearing cycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow
                fieldKey="inventory_account_id"
                label="Inventory / Stock Control"
                side="Dr"
                types={["Asset"]}
                hint="Debited on GRN receipt; credited when inventory is sold (COGS entry)."
                value={form.inventory_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="cogs_account_id"
                label="Cost of Goods Sold (COGS)"
                side="Dr"
                types={["Cost of Goods Sold", "Expense"]}
                hint="Debited when an invoiced product is issued from stock."
                value={form.cogs_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="grni_clearing_account_id"
                label="GRNI Clearing"
                side="Dr/Cr"
                types={["Liability"]}
                hint="Credited on GRN receipt (accrual); debited when the supplier bill is posted."
                value={form.grni_clearing_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="purchase_price_variance_account_id"
                label="Purchase Price Variance (PPV)"
                side="Dr/Cr"
                types={["Expense", "Cost of Goods Sold"]}
                hint="Captures the difference between PO/GRN cost and actual supplier invoice cost."
                value={form.purchase_price_variance_account_id}
                onChange={setField}
              />
              <Separator />
              <div className="space-y-2">
                <SampleJournal
                  title="Sample Journal Entry — GRN Receipt"
                  rows={[
                    { side: "Dr", account: "Inventory / Stock", dr: "500.00" },
                    { side: "Cr", account: "GRNI Clearing", cr: "500.00" },
                  ]}
                />
                <SampleJournal
                  title="Sample Journal Entry — Invoice COGS"
                  rows={[
                    { side: "Dr", account: "Cost of Goods Sold", dr: "300.00" },
                    { side: "Cr", account: "Inventory / Stock", cr: "300.00" },
                  ]}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Fixed Assets ───────────────────────────────────────── */}
        <TabsContent value="fixed-assets" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Fixed Assets</CardTitle>
              <CardDescription>
                Global fallback accounts for depreciation and disposal journals (IAS 16).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  These are global fallbacks. Asset Category-level accounts take priority when set.
                </p>
              </div>
              <FieldRow
                fieldKey="depreciation_expense_account_id"
                label="Depreciation Expense"
                side="Dr"
                types={["Expense"]}
                hint="Debited on each monthly depreciation journal (IAS 16)."
                value={form.depreciation_expense_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="accumulated_depreciation_account_id"
                label="Accumulated Depreciation"
                side="Cr"
                types={["Asset"]}
                hint="Credited on each monthly depreciation journal. Contra-asset account."
                value={form.accumulated_depreciation_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="disposal_gain_account_id"
                label="Gain on Asset Disposal"
                side="Cr"
                types={["Income", "Other Income"]}
                hint="Credited when sale proceeds exceed Net Book Value (IAS 16). Must be separate from loss account."
                value={form.disposal_gain_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="disposal_loss_account_id"
                label="Loss on Asset Disposal"
                side="Dr"
                types={["Expense", "Other Expense"]}
                hint="Debited when sale proceeds are below Net Book Value (IAS 16). Must be separate from gain account."
                value={form.disposal_loss_account_id}
                onChange={setField}
              />
              <Separator />
              <div className="space-y-2">
                <SampleJournal
                  title="Sample Journal Entry — Monthly Depreciation"
                  rows={[
                    { side: "Dr", account: "Depreciation Expense", dr: "833.00" },
                    { side: "Cr", account: "Accumulated Depreciation", cr: "833.00" },
                  ]}
                />
                <SampleJournal
                  title="Sample Journal Entry — Asset Disposal (gain)"
                  rows={[
                    { side: "Dr", account: "Cash / Bank", dr: "12,000.00" },
                    { side: "Dr", account: "Accumulated Depreciation", dr: "8,000.00" },
                    { side: "Cr", account: "Asset at Cost", cr: "18,000.00" },
                    { side: "Cr", account: "Gain on Disposal", cr: "2,000.00" },
                  ]}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Equity & FX ────────────────────────────────────────── */}
        <TabsContent value="equity-fx" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Equity &amp; Foreign Exchange</CardTitle>
              <CardDescription>
                Accounts for period-close entries and multi-currency revaluation (IAS 21).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow
                fieldKey="retained_earnings_account_id"
                label="Retained Earnings"
                side="Dr/Cr"
                types={["Equity"]}
                hint="Net income is transferred here on period close. Required for year-end closing journals."
                value={form.retained_earnings_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="fx_gain_account_id"
                label="Foreign Exchange Gain"
                side="Cr"
                types={["Income", "Other Income"]}
                hint="Credited when re-measuring foreign currency balances at period-end (IAS 21)."
                value={form.fx_gain_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="fx_loss_account_id"
                label="Foreign Exchange Loss"
                side="Dr"
                types={["Expense", "Other Expense"]}
                hint="Debited when re-measuring foreign currency balances at period-end (IAS 21)."
                value={form.fx_loss_account_id}
                onChange={setField}
              />
              <Separator />
              <SampleJournal
                title="Sample Journal Entry — Period Close"
                rows={[
                  { side: "Dr", account: "Sales Revenue", dr: "50,000.00" },
                  { side: "Cr", account: "Retained Earnings", cr: "50,000.00" },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 5: Payroll ────────────────────────────────────────────── */}
        <TabsContent value="payroll" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payroll</CardTitle>
              <CardDescription>
                Global fallback accounts for payroll posting.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  These are global fallbacks. Payroll GL Mapping (component-level) takes priority when set.
                </p>
              </div>
              <FieldRow
                fieldKey="wages_expense_account_id"
                label="Salaries & Wages Expense"
                side="Dr"
                types={["Expense"]}
                hint="Debited for gross payroll expense when no component-level mapping exists."
                value={form.wages_expense_account_id}
                onChange={setField}
              />
              <Separator />
              <FieldRow
                fieldKey="payroll_clearing_account_id"
                label="Payroll Clearing / Net Pay Payable"
                side="Cr"
                types={["Liability"]}
                hint="Credited for net pay amounts awaiting bank transfer."
                value={form.payroll_clearing_account_id}
                onChange={setField}
              />
              <Separator />
              <SampleJournal
                title="Sample Journal Entry — Payroll Post"
                rows={[
                  { side: "Dr", account: "Salaries & Wages Expense", dr: "80,000.00" },
                  { side: "Cr", account: "Payroll Clearing", cr: "80,000.00" },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Save button ──────────────────────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 z-20">
        <Button
          onClick={() => upsert.mutate(form)}
          disabled={upsert.isPending}
          size="lg"
          className="flex items-center gap-2 shadow-lg"
        >
          {upsert.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Mapping
        </Button>
      </div>
    </div>
  );
}
