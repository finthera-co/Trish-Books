import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Settings, Save, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import AccountSelector from "@/components/shared/AccountSelector";
import { useAccountSettings, useUpsertAccountSettings, type AccountSettings } from "@/hooks/useAccountSettings";
import { useAccountById } from "@/hooks/useAccountSearch";

// ── Preview sub-component ──────────────────────────────────────────────────

interface PreviewRow {
  side: "Dr" | "Cr";
  role: string;
  cell: JSX.Element;
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="pb-2 text-left text-xs font-medium text-muted-foreground w-10">Side</th>
          <th className="pb-2 text-left text-xs font-medium text-muted-foreground pr-3">Account Role</th>
          <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Mapped Account</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            <td className="py-2 pr-2">
              {r.side === "Dr" ? (
                <Badge className="rounded-full bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 text-xs font-semibold px-2">Dr</Badge>
              ) : (
                <Badge className="rounded-full bg-green-50 text-green-700 border-green-200 hover:bg-green-50 text-xs font-semibold px-2">Cr</Badge>
              )}
            </td>
            <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{r.role}</td>
            <td className="py-2">{r.cell}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function MappingSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="animate-pulse flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted" />
        <div className="space-y-2">
          <div className="h-6 w-44 rounded bg-muted" />
          <div className="h-3 w-64 rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {[4, 4, 4].map((fieldCount, ci) => (
            <div key={ci} className="animate-pulse rounded-xl border bg-card p-6 space-y-5">
              <div className="space-y-1.5">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-56 rounded bg-muted" />
              </div>
              {Array.from({ length: fieldCount }).map((_, fi) => (
                <div key={fi} className="space-y-1.5">
                  <div className="h-3 w-32 rounded bg-muted" />
                  <div className="h-3 w-48 rounded bg-muted" />
                  <div className="h-9 rounded-md bg-muted" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="animate-pulse rounded-xl border bg-card p-6 h-72">
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-3 w-52 rounded bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AccountMapping() {
  const { data: settings, isLoading } = useAccountSettings();
  const upsert = useUpsertAccountSettings();

  // ── Per-field state ──────────────────────────────────────────────
  const [arAccountId, setArAccountId] = useState("");
  const [salesAccountId, setSalesAccountId] = useState("");
  const [taxPayableAccountId, setTaxPayableAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [apAccountId, setApAccountId] = useState("");
  const [inventoryAssetAccountId, setInventoryAssetAccountId] = useState("");
  const [cogsAccountId, setCogsAccountId] = useState("");
  const [grniClearingAccountId, setGrniClearingAccountId] = useState("");
  const [accumDepreciationAccountId, setAccumDepreciationAccountId] = useState("");
  const [gainLossDisposalAccountId, setGainLossDisposalAccountId] = useState("");
  const [pettyCashAccountId, setPettyCashAccountId] = useState("");
  const [retainedEarningsAccountId, setRetainedEarningsAccountId] = useState("");

  // ── Snapshot (last saved state — drives isDirty) ─────────────────
  const [snapshot, setSnapshot] = useState({
    ar: "", sales: "", taxPayable: "", bank: "",
    ap: "", inventoryAsset: "", cogs: "", grniClearing: "",
    accumDepreciation: "", gainLossDisposal: "", pettyCash: "", retainedEarnings: "",
  });

  // ── Validation errors ────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Seed from loaded settings ────────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    const s = {
      ar:                settings.ar_account_id              || "",
      sales:             settings.sales_account_id           || "",
      taxPayable:        settings.tax_payable_account_id     || "",
      bank:              settings.bank_account_id            || "",
      ap:                settings.ap_account_id              || "",
      inventoryAsset:    settings.inventory_asset_account_id || "",
      cogs:              settings.cogs_account_id            || "",
      grniClearing:      settings.grni_clearing_account_id   || "",
      accumDepreciation: settings.accum_depreciation_account_id || "",
      gainLossDisposal:  settings.gain_on_disposal_account_id   || "",
      pettyCash:         settings.petty_cash_account_id      || "",
      retainedEarnings:  settings.retained_earnings_account_id || "",
    };
    setArAccountId(s.ar);
    setSalesAccountId(s.sales);
    setTaxPayableAccountId(s.taxPayable);
    setBankAccountId(s.bank);
    setApAccountId(s.ap);
    setInventoryAssetAccountId(s.inventoryAsset);
    setCogsAccountId(s.cogs);
    setGrniClearingAccountId(s.grniClearing);
    setAccumDepreciationAccountId(s.accumDepreciation);
    setGainLossDisposalAccountId(s.gainLossDisposal);
    setPettyCashAccountId(s.pettyCash);
    setRetainedEarningsAccountId(s.retainedEarnings);
    setSnapshot(s);
  }, [settings]);

  // ── isDirty ──────────────────────────────────────────────────────
  const isDirty = useMemo(() =>
    arAccountId              !== snapshot.ar              ||
    salesAccountId           !== snapshot.sales           ||
    taxPayableAccountId      !== snapshot.taxPayable      ||
    bankAccountId            !== snapshot.bank            ||
    apAccountId              !== snapshot.ap              ||
    inventoryAssetAccountId  !== snapshot.inventoryAsset  ||
    cogsAccountId            !== snapshot.cogs            ||
    grniClearingAccountId    !== snapshot.grniClearing    ||
    accumDepreciationAccountId !== snapshot.accumDepreciation ||
    gainLossDisposalAccountId  !== snapshot.gainLossDisposal  ||
    pettyCashAccountId         !== snapshot.pettyCash         ||
    retainedEarningsAccountId  !== snapshot.retainedEarnings,
  [
    arAccountId, salesAccountId, taxPayableAccountId, bankAccountId,
    apAccountId, inventoryAssetAccountId, cogsAccountId, grniClearingAccountId,
    accumDepreciationAccountId, gainLossDisposalAccountId, pettyCashAccountId,
    retainedEarningsAccountId, snapshot,
  ]);

  // ── Account name resolution (12 calls) ──────────────────────────
  const { data: arData }               = useAccountById(arAccountId              || null);
  const { data: salesData }            = useAccountById(salesAccountId           || null);
  const { data: taxPayableData }       = useAccountById(taxPayableAccountId      || null);
  const { data: bankData }             = useAccountById(bankAccountId            || null);
  const { data: apData }               = useAccountById(apAccountId              || null);
  const { data: inventoryAssetData }   = useAccountById(inventoryAssetAccountId  || null);
  const { data: cogsData }             = useAccountById(cogsAccountId            || null);
  const { data: grniClearingData }     = useAccountById(grniClearingAccountId    || null);
  const { data: accumDepreciationData }= useAccountById(accumDepreciationAccountId || null);
  const { data: gainLossDisposalData } = useAccountById(gainLossDisposalAccountId  || null);
  const { data: pettyCashData }        = useAccountById(pettyCashAccountId       || null);
  const { data: retainedEarningsData } = useAccountById(retainedEarningsAccountId || null);

  const accountNames = useMemo(() => ({
    ar_account_id:               arData?.account_name,
    sales_account_id:            salesData?.account_name,
    tax_payable_account_id:      taxPayableData?.account_name,
    bank_account_id:             bankData?.account_name,
    ap_account_id:               apData?.account_name,
    inventory_asset_account_id:  inventoryAssetData?.account_name,
    cogs_account_id:             cogsData?.account_name,
    grni_clearing_account_id:    grniClearingData?.account_name,
    accum_depreciation_account_id: accumDepreciationData?.account_name,
    gain_loss_disposal_account_id: gainLossDisposalData?.account_name,
    petty_cash_account_id:       pettyCashData?.account_name,
    retained_earnings_account_id: retainedEarningsData?.account_name,
  }), [
    arData, salesData, taxPayableData, bankData, apData,
    inventoryAssetData, cogsData, grniClearingData,
    accumDepreciationData, gainLossDisposalData, pettyCashData, retainedEarningsData,
  ]);

  // ── Helpers ──────────────────────────────────────────────────────

  const clearError = (key: string) =>
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });

  const renderMapped = (
    fieldKey: keyof typeof accountNames,
    value: string,
    optional?: boolean,
    note?: string,
  ): JSX.Element => {
    if (value) {
      const name = accountNames[fieldKey];
      return <span className="text-sm text-foreground">{name ?? "…"}</span>;
    }
    if (optional) {
      return <span className="text-xs text-muted-foreground italic">{note ?? "Optional"}</span>;
    }
    return (
      <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">
        Not mapped
      </Badge>
    );
  };

  const staticCell = (text: string): JSX.Element => (
    <span className="text-xs text-muted-foreground italic">{text}</span>
  );

  // ── Save ─────────────────────────────────────────────────────────

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!arAccountId)   newErrors.ar_account_id   = "Required for posting";
    if (!apAccountId)   newErrors.ap_account_id   = "Required for posting";
    if (!bankAccountId) newErrors.bank_account_id = "Required for posting";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    const payload: Partial<AccountSettings> = {
      ar_account_id:                 arAccountId              || null,
      sales_account_id:              salesAccountId           || null,
      tax_payable_account_id:        taxPayableAccountId      || null,
      bank_account_id:               bankAccountId            || null,
      ap_account_id:                 apAccountId              || null,
      inventory_asset_account_id:    inventoryAssetAccountId  || null,
      cogs_account_id:               cogsAccountId            || null,
      grni_clearing_account_id:      grniClearingAccountId    || null,
      accum_depreciation_account_id: accumDepreciationAccountId || null,
      gain_on_disposal_account_id:   gainLossDisposalAccountId  || null,
      loss_on_disposal_account_id:   gainLossDisposalAccountId  || null,
      petty_cash_account_id:         pettyCashAccountId       || null,
      retained_earnings_account_id:  retainedEarningsAccountId || null,
    };
    upsert.mutate(payload, {
      onSuccess: () => {
        setSnapshot({
          ar:                arAccountId,
          sales:             salesAccountId,
          taxPayable:        taxPayableAccountId,
          bank:              bankAccountId,
          ap:                apAccountId,
          inventoryAsset:    inventoryAssetAccountId,
          cogs:              cogsAccountId,
          grniClearing:      grniClearingAccountId,
          accumDepreciation: accumDepreciationAccountId,
          gainLossDisposal:  gainLossDisposalAccountId,
          pettyCash:         pettyCashAccountId,
          retainedEarnings:  retainedEarningsAccountId,
        });
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────

  if (isLoading) return <MappingSkeleton />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Account Mapping</h1>
          <p className="text-sm text-muted-foreground">
            Default GL control accounts used by automated posting.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

        {/* ── LEFT: mapping cards ──────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Card 1: Receivables & Revenue */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Receivables & Revenue</CardTitle>
              <CardDescription>
                Controls journal entries for sales invoices and customer payments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldRow
                label="Accounts Receivable"
                hint="Dr when invoice is posted"
                value={arAccountId}
                onChange={(id) => { setArAccountId(id); clearError("ar_account_id"); }}
                types={["Asset"]}
                error={errors.ar_account_id}
              />
              <FieldRow
                label="Default Sales Revenue"
                hint="Cr when invoice is posted — used when invoice line has no specific account"
                value={salesAccountId}
                onChange={setSalesAccountId}
                types={["Income", "Other Income"]}
              />
              <FieldRow
                label="Tax Payable"
                hint="Cr for tax portion on invoices — required if any invoice has tax"
                value={taxPayableAccountId}
                onChange={setTaxPayableAccountId}
                types={["Liability"]}
              />
              <FieldRow
                label="Default Bank / Cash"
                hint="Dr when payment received is posted"
                value={bankAccountId}
                onChange={(id) => { setBankAccountId(id); clearError("bank_account_id"); }}
                types={["Asset"]}
                error={errors.bank_account_id}
              />
            </CardContent>
          </Card>

          {/* Card 2: Payables & Inventory */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Payables & Inventory</CardTitle>
              <CardDescription>
                Controls journal entries for supplier bills, goods receipts, and stock
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldRow
                label="Accounts Payable"
                hint="Cr when supplier bill is posted"
                value={apAccountId}
                onChange={(id) => { setApAccountId(id); clearError("ap_account_id"); }}
                types={["Liability"]}
                error={errors.ap_account_id}
              />
              <FieldRow
                label="Default Inventory Asset"
                hint="Dr on goods receipt — fallback when inventory item has no asset account"
                value={inventoryAssetAccountId}
                onChange={setInventoryAssetAccountId}
                types={["Asset"]}
              />
              <FieldRow
                label="Default COGS"
                hint="Dr on invoice dispatch — fallback when product has no COGS account"
                value={cogsAccountId}
                onChange={setCogsAccountId}
                types={["Cost of Goods Sold"]}
              />
              <FieldRow
                label="GRNI Clearing"
                hint="Cr on GRN before supplier invoice arrives (Goods Received Not Invoiced)"
                value={grniClearingAccountId}
                onChange={setGrniClearingAccountId}
                types={["Liability"]}
              />
            </CardContent>
          </Card>

          {/* Card 3: Fixed Assets & Equity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Fixed Assets & Equity</CardTitle>
              <CardDescription>
                Controls depreciation, disposals, petty cash, and year-end close
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldRow
                label="Accumulated Depreciation"
                hint="Cr on every depreciation run — must be a contra-asset (account_subtype = Accumulated Depreciation)"
                value={accumDepreciationAccountId}
                onChange={setAccumDepreciationAccountId}
                types={["Asset"]}
              />
              <FieldRow
                label="Gain / Loss on Disposal"
                hint="Net Dr or Cr when an asset is disposed"
                value={gainLossDisposalAccountId}
                onChange={setGainLossDisposalAccountId}
                types={["Other Income", "Other Expense"]}
              />
              <FieldRow
                label="Petty Cash Fund"
                hint="Cr when a petty cash voucher is posted"
                value={pettyCashAccountId}
                onChange={setPettyCashAccountId}
                types={["Asset"]}
              />
              <FieldRow
                label="Retained Earnings"
                hint="Target account for year-end P&L close journal"
                value={retainedEarningsAccountId}
                onChange={setRetainedEarningsAccountId}
                types={["Equity"]}
              />
            </CardContent>
          </Card>

          <Separator />

          {/* Unsaved changes banner */}
          {isDirty && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>You have unsaved changes.</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={upsert.isPending || !isDirty}>
              {upsert.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save className="w-4 h-4" />}
              {upsert.isPending ? "Saving…" : "Save Mapping"}
            </Button>
          </div>
        </div>

        {/* ── RIGHT: journal preview (sticky) ─────────────────────── */}
        <div className="sticky top-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Journal Entry Preview</CardTitle>
              <CardDescription>How mapped accounts appear in automated journals</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="invoice">
                <TabsList className="grid grid-cols-5 w-full">
                  <TabsTrigger value="invoice"      className="text-xs">Invoice</TabsTrigger>
                  <TabsTrigger value="payment"      className="text-xs">Payment</TabsTrigger>
                  <TabsTrigger value="bill"         className="text-xs">Bill</TabsTrigger>
                  <TabsTrigger value="grn"          className="text-xs">GRN</TabsTrigger>
                  <TabsTrigger value="depreciation" className="text-xs">Depr.</TabsTrigger>
                </TabsList>

                <TabsContent value="invoice" className="mt-3">
                  <PreviewTable rows={[
                    { side: "Dr", role: "Accounts Receivable", cell: renderMapped("ar_account_id", arAccountId) },
                    { side: "Cr", role: "Sales Revenue",        cell: renderMapped("sales_account_id", salesAccountId) },
                    { side: "Cr", role: "Tax Payable",          cell: renderMapped("tax_payable_account_id", taxPayableAccountId, true) },
                    { side: "Dr", role: "COGS (per product)",   cell: renderMapped("cogs_account_id", cogsAccountId, true, "Fallback only") },
                    { side: "Cr", role: "Inventory Asset",      cell: renderMapped("inventory_asset_account_id", inventoryAssetAccountId, true, "Fallback only") },
                  ]} />
                </TabsContent>

                <TabsContent value="payment" className="mt-3">
                  <PreviewTable rows={[
                    { side: "Dr", role: "Bank / Cash",        cell: renderMapped("bank_account_id", bankAccountId) },
                    { side: "Cr", role: "Accounts Receivable", cell: renderMapped("ar_account_id", arAccountId) },
                  ]} />
                </TabsContent>

                <TabsContent value="bill" className="mt-3">
                  <PreviewTable rows={[
                    { side: "Dr", role: "Expense / Asset",  cell: staticCell("Set per bill line") },
                    { side: "Cr", role: "Accounts Payable", cell: renderMapped("ap_account_id", apAccountId) },
                  ]} />
                </TabsContent>

                <TabsContent value="grn" className="mt-3">
                  <PreviewTable rows={[
                    { side: "Dr", role: "Inventory Asset", cell: renderMapped("inventory_asset_account_id", inventoryAssetAccountId) },
                    { side: "Cr", role: "GRNI Clearing",   cell: renderMapped("grni_clearing_account_id", grniClearingAccountId) },
                  ]} />
                </TabsContent>

                <TabsContent value="depreciation" className="mt-3">
                  <PreviewTable rows={[
                    { side: "Dr", role: "Depreciation Expense",    cell: staticCell("Set per asset category") },
                    { side: "Cr", role: "Accumulated Depreciation", cell: renderMapped("accum_depreciation_account_id", accumDepreciationAccountId) },
                  ]} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}

// ── Field row (module-level, not a nested component) ──────────────────────

interface FieldRowProps {
  label: string;
  hint: string;
  value: string;
  onChange: (id: string) => void;
  types: string[];
  error?: string;
}

function FieldRow({ label, hint, value, onChange, types, error }: FieldRowProps) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <AccountSelector
        value={value}
        onChange={(id) => onChange(id)}
        types={types}
        placeholder="Search account…"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
