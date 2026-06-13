import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import AccountSelector from "@/components/shared/AccountSelector";
import { Info, Lock, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  useTaxProfile, useSaveTaxProfile, useTaxCodes, useSaveTaxCode, useAddTaxRate,
  useTaxGroups, useSaveTaxGroup, useWhtRules, useSaveWhtRule, useDeleteWhtRule,
  useApitSchedules, useSaveApitSchedule, currentRate,
  type TaxCodeRow, type TaxGroupRow,
} from "@/hooks/useTaxEngine";
import { calculateLineTax, calculateApit, type TaxMemberInput } from "@/lib/taxEngine";
import { useAuth } from "@/contexts/AuthContext";

const fmt = (n: number) =>
  n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const NATURES = ["service_fee", "rent", "interest", "dividend", "royalty", "contractor", "other"];
const PAYEE_TYPES = ["resident_individual", "resident_company", "non_resident"];
const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ═══════════════════════ Tax Profile tab ═══════════════════════ */

function TaxProfileTab() {
  const { data: profile } = useTaxProfile();
  const { data: groups } = useTaxGroups();
  const { data: codes } = useTaxCodes();
  const save = useSaveTaxProfile();
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    if (profile !== undefined && form === null) {
      setForm({
        is_vat_registered: profile?.is_vat_registered ?? false,
        vat_registration_number: profile?.vat_registration_number ?? "",
        vat_registered_from: profile?.vat_registered_from ?? "",
        vat_filing_frequency: profile?.vat_filing_frequency ?? "monthly",
        is_sscl_liable: profile?.is_sscl_liable ?? false,
        sscl_registration_number: profile?.sscl_registration_number ?? "",
        wht_agent: profile?.wht_agent ?? true,
        tin: profile?.tin ?? "",
        default_sales_tax_group_id: profile?.default_sales_tax_group_id ?? null,
        default_purchase_tax_code_id: profile?.default_purchase_tax_code_id ?? null,
      });
    }
  }, [profile, form]);

  if (!form) return <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>;

  const purchaseCodes = (codes || []).filter((c) => ["input", "reverse_charge"].includes(c.collection_mode));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Profile</CardTitle>
        <CardDescription>IRD registrations drive what the engine allows and posts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Seeded rates are indicative defaults — verify against current IRD gazettes before filing.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between">
          <Label htmlFor="vat-reg">VAT registered</Label>
          <Switch id="vat-reg" checked={form.is_vat_registered}
            onCheckedChange={(v) => setForm({ ...form, is_vat_registered: v })} />
        </div>
        {form.is_vat_registered && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pl-4 border-l-2 border-muted">
            <div>
              <Label>VAT registration number</Label>
              <Input value={form.vat_registration_number}
                onChange={(e) => setForm({ ...form, vat_registration_number: e.target.value })} />
            </div>
            <div>
              <Label>Registered from</Label>
              <Input type="date" value={form.vat_registered_from}
                onChange={(e) => setForm({ ...form, vat_registered_from: e.target.value })} />
            </div>
            <div>
              <Label>Filing frequency</Label>
              <Select value={form.vat_filing_frequency}
                onValueChange={(v) => setForm({ ...form, vat_filing_frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Label htmlFor="sscl">SSCL liable</Label>
          <Switch id="sscl" checked={form.is_sscl_liable}
            onCheckedChange={(v) => setForm({ ...form, is_sscl_liable: v })} />
        </div>
        {form.is_sscl_liable && (
          <div className="pl-4 border-l-2 border-muted">
            <Label>SSCL registration number</Label>
            <Input className="max-w-sm" value={form.sscl_registration_number}
              onChange={(e) => setForm({ ...form, sscl_registration_number: e.target.value })} />
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="wht-agent">WHT agent</Label>
            <p className="text-xs text-muted-foreground">Required to deduct AIT on vendor payments</p>
          </div>
          <Switch id="wht-agent" checked={form.wht_agent}
            onCheckedChange={(v) => setForm({ ...form, wht_agent: v })} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>TIN</Label>
            <Input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} />
          </div>
          <div>
            <Label>Default sales tax group</Label>
            <Select value={form.default_sales_tax_group_id ?? "none"}
              onValueChange={(v) => setForm({ ...form, default_sales_tax_group_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(groups || []).map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Default purchase tax code</Label>
            <Select value={form.default_purchase_tax_code_id ?? "none"}
              onValueChange={(v) => setForm({ ...form, default_purchase_tax_code_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {purchaseCodes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={() => save.mutate({
          ...form,
          vat_registration_number: form.vat_registration_number || null,
          vat_registered_from: form.vat_registered_from || null,
          sscl_registration_number: form.sscl_registration_number || null,
          tin: form.tin || null,
        })} disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save Tax Profile"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════ Tax Codes tab ═══════════════════════ */

function TaxCodeDialog({ code, open, onClose }: { code: TaxCodeRow | null; open: boolean; onClose: () => void }) {
  const save = useSaveTaxCode();
  const addRate = useAddTaxRate();
  const [form, setForm] = useState<any>({});
  const [newRate, setNewRate] = useState<{ rate: string; effective_from: string }>({ rate: "", effective_from: "" });
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setForm(code ? { ...code } : {
      code: "", name: "", tax_type: "VAT", collection_mode: "output",
      is_compound: false, is_recoverable: true, is_inclusive_default: false,
      rounding_method: "half_up", rounding_level: "line", is_active: true,
      output_liability_account_id: null, input_receivable_account_id: null,
      wht_payable_account_id: null, wht_receivable_account_id: null,
    });
    setNewRate({ rate: "", effective_from: "" });
  }, [code, open]);

  const rates = useMemo(
    () => [...(code?.tax_code_rates || [])].sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1)),
    [code]
  );
  const hasBeenUsed = (code?.tax_code_rates || []).some((r) => r.effective_from < today);
  const mode = form.collection_mode;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{code ? `Tax Code — ${code.code}` : "New Tax Code"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Code</Label>
            <Input value={form.code ?? ""} disabled={!!code && hasBeenUsed}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <Label>Name</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.tax_type} onValueChange={(v) => setForm({ ...form, tax_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["VAT", "SSCL", "WHT", "APIT", "STAMP", "OTHER"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Collection mode</Label>
            <Select value={form.collection_mode} onValueChange={(v) => setForm({ ...form, collection_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["output", "input", "withholding_payable", "withholding_receivable", "reverse_charge"].map((m) => (
                  <SelectItem key={m} value={m}>{label(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between col-span-2 md:col-span-1">
            <Label>Recoverable</Label>
            <Switch checked={!!form.is_recoverable} onCheckedChange={(v) => setForm({ ...form, is_recoverable: v })} />
          </div>
          <div className="flex items-center justify-between col-span-2 md:col-span-1">
            <Label>Inclusive by default</Label>
            <Switch checked={!!form.is_inclusive_default} onCheckedChange={(v) => setForm({ ...form, is_inclusive_default: v })} />
          </div>
          <div>
            <Label>Rounding method</Label>
            <Select value={form.rounding_method} onValueChange={(v) => setForm({ ...form, rounding_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="half_up">Half up</SelectItem>
                <SelectItem value="half_even">Half even (banker's)</SelectItem>
                <SelectItem value="down">Down (truncate)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rounding level</Label>
            <Select value={form.rounding_level} onValueChange={(v) => setForm({ ...form, rounding_level: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="document">Document</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* GL mapping — only the selectors relevant to the mode */}
          <div className="col-span-2 border-t pt-3 space-y-3">
            <p className="text-sm font-medium">GL mapping</p>
            {(mode === "output" || mode === "reverse_charge") && (
              <div>
                <Label>Output liability account</Label>
                <AccountSelector value={form.output_liability_account_id} types={["Liability"]}
                  onChange={(v) => setForm({ ...form, output_liability_account_id: v })} />
              </div>
            )}
            {(mode === "input" || mode === "reverse_charge") && (
              <div>
                <Label>Input receivable account</Label>
                <AccountSelector value={form.input_receivable_account_id} types={["Asset"]}
                  onChange={(v) => setForm({ ...form, input_receivable_account_id: v })} />
              </div>
            )}
            {mode === "withholding_payable" && (
              <div>
                <Label>WHT payable account</Label>
                <AccountSelector value={form.wht_payable_account_id} types={["Liability"]}
                  onChange={(v) => setForm({ ...form, wht_payable_account_id: v })} />
              </div>
            )}
            {mode === "withholding_receivable" && (
              <div>
                <Label>WHT receivable account</Label>
                <AccountSelector value={form.wht_receivable_account_id} types={["Asset"]}
                  onChange={(v) => setForm({ ...form, wht_receivable_account_id: v })} />
              </div>
            )}
          </div>

          {/* Rate history */}
          {code && (
            <div className="col-span-2 border-t pt-3">
              <p className="text-sm font-medium mb-2">Rate history</p>
              <table className="data-table w-full">
                <thead><tr><th>Rate</th><th>From</th><th>To</th><th /></tr></thead>
                <tbody>
                  {rates.map((r) => {
                    const status = r.effective_from > today ? "future"
                      : (!r.effective_to || r.effective_to >= today) ? "current" : "historical";
                    return (
                      <tr key={r.id}>
                        <td>{Number(r.rate)}%</td>
                        <td>{r.effective_from}</td>
                        <td>{r.effective_to ?? "—"}</td>
                        <td className="text-right">
                          {status === "current" && <Badge>current</Badge>}
                          {status === "future" && <Badge variant="secondary">future</Badge>}
                          {status === "historical" && <span className="inline-flex items-center gap-1 text-muted-foreground text-xs"><Lock className="w-3 h-3" />historical</span>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td><Input className="h-8 w-24" type="number" min={0} step="0.01" placeholder="Rate %"
                      value={newRate.rate} onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })} /></td>
                    <td colSpan={2}><Input className="h-8 w-40" type="date" value={newRate.effective_from}
                      onChange={(e) => setNewRate({ ...newRate, effective_from: e.target.value })} /></td>
                    <td className="text-right">
                      <Button size="sm" variant="outline"
                        disabled={newRate.rate === "" || !newRate.effective_from || addRate.isPending}
                        onClick={() => addRate.mutate(
                          { tax_code_id: code.id, rate: Number(newRate.rate), effective_from: newRate.effective_from },
                          { onSuccess: () => setNewRate({ rate: "", effective_from: "" }) }
                        )}>
                        <Plus className="w-3 h-3" /> Add Rate
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-1">
                Adding a rate auto-closes the previous open-ended rate the day before. Rates already in force are locked.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!form.code || !form.name || save.isPending}
            onClick={() => save.mutate(form, { onSuccess: () => onClose() })}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaxCodesTab() {
  const { data: codes, isLoading } = useTaxCodes();
  const save = useSaveTaxCode();
  const [editing, setEditing] = useState<TaxCodeRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const glMapped = (c: TaxCodeRow) => {
    switch (c.collection_mode) {
      case "output": return !!c.output_liability_account_id;
      case "input": return !!c.input_receivable_account_id;
      case "withholding_payable": return !!c.wht_payable_account_id;
      case "withholding_receivable": return !!c.wht_receivable_account_id;
      case "reverse_charge": return !!c.output_liability_account_id;
      default: return false;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Tax Codes</CardTitle>
          <CardDescription>Effective-dated rates; posting always resolves by document date.</CardDescription>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="w-4 h-4" />New Code</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-9 bg-muted animate-pulse rounded" />)}</div>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Type</th><th>Mode</th><th className="text-right">Current Rate</th><th>Effective From</th><th>GL Mapped</th><th>Active</th></tr>
            </thead>
            <tbody>
              {(codes || []).map((c) => {
                const rate = currentRate(c);
                const cur = (c.tax_code_rates || []).find((r) => Number(r.rate) === rate &&
                  r.effective_from <= new Date().toISOString().slice(0, 10));
                return (
                  <tr key={c.id} className="cursor-pointer" onClick={() => { setEditing(c); setDialogOpen(true); }}>
                    <td className="font-mono">{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.tax_type}</td>
                    <td>{label(c.collection_mode)}</td>
                    <td className="text-right">{rate !== null ? `${rate}%` : "—"}</td>
                    <td>{cur?.effective_from ?? "—"}</td>
                    <td>{glMapped(c) ? "✓" : <span title="No GL account mapped — global fallback will be used">⚠</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Switch checked={c.is_active}
                        onCheckedChange={(v) => save.mutate({ id: c.id, is_active: v } as any)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
      <TaxCodeDialog code={editing} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Card>
  );
}

/* ═══════════════════════ Tax Groups tab ═══════════════════════ */

function TaxGroupsTab() {
  const { data: groups, isLoading } = useTaxGroups();
  const { data: codes } = useTaxCodes();
  const save = useSaveTaxGroup();
  const [editing, setEditing] = useState<TaxGroupRow | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ code: "", name: "", members: [] });
  const [sample, setSample] = useState(100000);

  const openDialog = (g: TaxGroupRow | null) => {
    setEditing(g);
    setForm(g ? {
      id: g.id, code: g.code, name: g.name, is_active: g.is_active,
      members: [...g.tax_group_members]
        .sort((a, b) => a.apply_order - b.apply_order)
        .map((m) => ({ tax_code_id: m.tax_code_id, apply_order: m.apply_order, compound_on_previous: m.compound_on_previous })),
    } : { code: "", name: "", members: [] });
    setOpen(true);
  };

  const activeCodes = (codes || []).filter((c) => c.is_active);
  const codeById = new Map((codes || []).map((c) => [c.id, c]));

  // Live preview chain via the shared engine — recomputed on every change
  const preview = useMemo(() => {
    const members: TaxMemberInput[] = (form.members || [])
      .map((m: any, i: number) => {
        const c = codeById.get(m.tax_code_id);
        if (!c) return null;
        return {
          taxCodeId: c.id, code: c.code, rate: currentRate(c) ?? 0,
          isCompound: m.compound_on_previous, applyOrder: m.apply_order ?? i + 1,
          collectionMode: c.collection_mode as any,
        };
      })
      .filter(Boolean) as TaxMemberInput[];
    if (members.length === 0) return null;
    return calculateLineTax({
      lineAmount: sample, isInclusive: false, members,
      roundingMethod: "half_up", roundingLevel: "line",
      documentDate: new Date().toISOString().slice(0, 10),
    });
  }, [form.members, sample, codes]);

  const moveMember = (idx: number, dir: -1 | 1) => {
    const ms = [...form.members];
    const j = idx + dir;
    if (j < 0 || j >= ms.length) return;
    [ms[idx], ms[j]] = [ms[j], ms[idx]];
    setForm({ ...form, members: ms.map((m: any, i: number) => ({ ...m, apply_order: i + 1 })) });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Tax Groups</CardTitle>
          <CardDescription>Stacked/compound taxes — e.g. VAT 18% on top of SSCL 2.5%.</CardDescription>
        </div>
        <Button onClick={() => openDialog(null)}><Plus className="w-4 h-4" />New Group</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-9 bg-muted animate-pulse rounded" />
        ) : (
          <table className="data-table w-full">
            <thead><tr><th>Code</th><th>Name</th><th>Members</th><th>Active</th></tr></thead>
            <tbody>
              {(groups || []).map((g) => (
                <tr key={g.id} className="cursor-pointer" onClick={() => openDialog(g)}>
                  <td className="font-mono">{g.code}</td>
                  <td>{g.name}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {[...g.tax_group_members].sort((a, b) => a.apply_order - b.apply_order).map((m) => (
                        <Badge key={m.id} variant="secondary">
                          {m.tax_codes?.code}{m.compound_on_previous ? " ↑" : ""}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td>{g.is_active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? `Tax Group — ${editing.code}` : "New Tax Group"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Members (applied in order; ↑ = compounds on previous)</Label>
              {(form.members || []).map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <span className="font-mono text-sm flex-1">{codeById.get(m.tax_code_id)?.code ?? "?"}</span>
                  <Label className="text-xs">Compound</Label>
                  <Switch checked={m.compound_on_previous}
                    onCheckedChange={(v) => {
                      const ms = [...form.members]; ms[i] = { ...m, compound_on_previous: v };
                      setForm({ ...form, members: ms });
                    }} />
                  <Button size="icon" variant="ghost" onClick={() => moveMember(i, -1)}><ArrowUp className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => moveMember(i, 1)}><ArrowDown className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setForm({
                    ...form,
                    members: form.members.filter((_: any, j: number) => j !== i).map((mm: any, k: number) => ({ ...mm, apply_order: k + 1 })),
                  })}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
              <Select value="" onValueChange={(v) => setForm({
                ...form,
                members: [...form.members, { tax_code_id: v, apply_order: form.members.length + 1, compound_on_previous: false }],
              })}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Add member..." /></SelectTrigger>
                <SelectContent>
                  {activeCodes
                    .filter((c) => !(form.members || []).some((m: any) => m.tax_code_id === c.id))
                    .map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 border rounded-md p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-xs">Sample amount</Label>
                <Input className="h-8 w-36" type="number" value={sample} onChange={(e) => setSample(Number(e.target.value) || 0)} />
              </div>
              {preview ? (
                <p className="text-sm font-mono">
                  {fmt(sample)}
                  {preview.taxes.map((t) => ` → ${t.code} (${t.rate}%) ${fmt(t.amount)}${t.base !== preview.exclusiveBase ? ` on ${fmt(t.base)}` : ""}`)}
                  {" "}= Total {fmt(preview.lineTotal)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Add members to preview the tax chain.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.code || !form.name || save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => setOpen(false) })}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ═══════════════════════ WHT Rules tab ═══════════════════════ */

function WhtRulesTab() {
  const { data: rules, isLoading } = useWhtRules();
  const { data: codes } = useTaxCodes();
  const save = useSaveWhtRule();
  const del = useDeleteWhtRule();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  const whtCodes = (codes || []).filter((c) => c.collection_mode === "withholding_payable");

  const openDialog = (r: any | null) => {
    setForm(r ? { ...r } : {
      tax_code_id: whtCodes[0]?.id ?? "", payment_nature: "service_fee",
      payee_type: "resident_individual", rate: 5, threshold_amount: null,
      threshold_period: null, effective_from: new Date().toISOString().slice(0, 10),
      effective_to: null, certificate_required: true,
    });
    setOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>WHT / AIT Rules</CardTitle>
          <CardDescription>Withholding at settlement, per payment nature and payee type.</CardDescription>
        </div>
        <Button onClick={() => openDialog(null)}><Plus className="w-4 h-4" />New Rule</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-9 bg-muted animate-pulse rounded" />
        ) : (rules || []).length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No WHT rules — Sri Lanka defaults can be seeded from Tax Profile.
          </p>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr><th>Nature</th><th>Payee Type</th><th className="text-right">Rate</th><th className="text-right">Threshold</th><th>Period</th><th>From</th><th>To</th><th>Cert</th><th /></tr>
            </thead>
            <tbody>
              {(rules || []).map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => openDialog(r)}>
                  <td>{label(r.payment_nature)}</td>
                  <td>{label(r.payee_type)}</td>
                  <td className="text-right">{Number(r.rate)}%</td>
                  <td className="text-right">{r.threshold_amount ? fmt(Number(r.threshold_amount)) : "—"}</td>
                  <td>{r.threshold_period ? label(r.threshold_period) : "—"}</td>
                  <td>{r.effective_from}</td>
                  <td>{r.effective_to ?? "—"}</td>
                  <td>{r.certificate_required ? "✓" : "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="w-3 h-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.id ? "Edit WHT Rule" : "New WHT Rule"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>WHT tax code</Label>
                <Select value={form.tax_code_id} onValueChange={(v) => setForm({ ...form, tax_code_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {whtCodes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment nature</Label>
                <Select value={form.payment_nature} onValueChange={(v) => setForm({ ...form, payment_nature: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{NATURES.map((n) => <SelectItem key={n} value={n}>{label(n)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payee type</Label>
                <Select value={form.payee_type} onValueChange={(v) => setForm({ ...form, payee_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYEE_TYPES.map((p) => <SelectItem key={p} value={p}>{label(p)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rate %</Label>
                <Input type="number" min={0} step="0.01" value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Threshold (LKR)</Label>
                <Input type="number" min={0} value={form.threshold_amount ?? ""}
                  onChange={(e) => setForm({ ...form, threshold_amount: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div>
                <Label>Threshold period</Label>
                <Select value={form.threshold_period ?? "none"}
                  onValueChange={(v) => setForm({ ...form, threshold_period: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="per_payment">Per payment</SelectItem>
                    <SelectItem value="per_month">Per month</SelectItem>
                    <SelectItem value="per_annum">Per annum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Effective from</Label>
                <Input type="date" value={form.effective_from}
                  onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div>
                <Label>Effective to</Label>
                <Input type="date" value={form.effective_to ?? ""}
                  onChange={(e) => setForm({ ...form, effective_to: e.target.value || null })} />
              </div>
              <div className="flex items-center justify-between col-span-2">
                <Label>Certificate required</Label>
                <Switch checked={!!form.certificate_required}
                  onCheckedChange={(v) => setForm({ ...form, certificate_required: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form?.tax_code_id || save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => setOpen(false) })}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ═══════════════════════ APIT tab ═══════════════════════ */

function ApitTab() {
  const { appUser } = useAuth();
  const { data: schedules, isLoading } = useApitSchedules();
  const save = useSaveApitSchedule();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(null);
  const [previewGross, setPreviewGross] = useState(300000);

  const selected = (schedules || []).find((s) => s.id === selectedId) ?? (schedules || [])[0];

  useEffect(() => {
    if (selected && (!form || form.sourceId !== selected.id)) {
      setForm({
        sourceId: selected.id,
        // editing a SYSTEM schedule forks it into a tenant override
        id: selected.tenant_id === appUser?.tenant_id ? selected.id : undefined,
        effective_from: selected.effective_from,
        effective_to: selected.effective_to,
        annual_relief: Number(selected.annual_relief),
        brackets: [...(selected.apit_brackets || [])]
          .sort((a: any, b: any) => a.bracket_order - b.bracket_order)
          .map((b: any) => ({
            bracket_order: b.bracket_order,
            annual_amount_up_to: b.annual_amount_up_to === null ? null : Number(b.annual_amount_up_to),
            rate: Number(b.rate),
          })),
      });
    }
  }, [selected, appUser?.tenant_id]);

  const apitPreview = useMemo(() => {
    if (!form?.brackets?.length) return null;
    return calculateApit(previewGross, {
      id: form.sourceId ?? "preview",
      annualRelief: Number(form.annual_relief) || 0,
      brackets: form.brackets.map((b: any) => ({
        bracketOrder: b.bracket_order, annualAmountUpTo: b.annual_amount_up_to, rate: b.rate,
      })),
    });
  }, [form, previewGross]);

  if (isLoading || !form) return <div className="h-24 bg-muted animate-pulse rounded" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>APIT Bracket Schedule</CardTitle>
          <CardDescription>
            {selected?.tenant_id === null
              ? "System default (2025/26 indicative). Saving creates a tenant override."
              : "Tenant override schedule."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 items-end">
            <div>
              <Label>Schedule</Label>
              <Select value={selected?.id} onValueChange={(v) => { setSelectedId(v); setForm(null); }}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(schedules || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.effective_from} → {s.effective_to ?? "open"} {s.tenant_id === null ? "(system)" : "(tenant)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Annual relief (LKR)</Label>
              <Input type="number" className="w-44" value={form.annual_relief}
                onChange={(e) => setForm({ ...form, annual_relief: Number(e.target.value) })} />
            </div>
          </div>
          <table className="data-table w-full">
            <thead><tr><th>Order</th><th>Up to (annual)</th><th className="text-right">Rate %</th><th /></tr></thead>
            <tbody>
              {form.brackets.map((b: any, i: number) => (
                <tr key={i}>
                  <td>{b.bracket_order}</td>
                  <td>
                    <Input className="h-8 w-40" type="number" placeholder="(top bracket)"
                      value={b.annual_amount_up_to ?? ""}
                      onChange={(e) => {
                        const bs = [...form.brackets];
                        bs[i] = { ...b, annual_amount_up_to: e.target.value === "" ? null : Number(e.target.value) };
                        setForm({ ...form, brackets: bs });
                      }} />
                  </td>
                  <td className="text-right">
                    <Input className="h-8 w-24 ml-auto" type="number" step="0.01" value={b.rate}
                      onChange={(e) => {
                        const bs = [...form.brackets];
                        bs[i] = { ...b, rate: Number(e.target.value) };
                        setForm({ ...form, brackets: bs });
                      }} />
                  </td>
                  <td className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => setForm({
                      ...form,
                      brackets: form.brackets.filter((_: any, j: number) => j !== i)
                        .map((bb: any, k: number) => ({ ...bb, bracket_order: k + 1 })),
                    })}><Trash2 className="w-3 h-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setForm({
              ...form,
              brackets: [...form.brackets, { bracket_order: form.brackets.length + 1, annual_amount_up_to: null, rate: 0 }],
            })}><Plus className="w-3 h-3" />Add bracket</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate({
              id: form.id,
              effective_from: form.effective_from,
              effective_to: form.effective_to,
              annual_relief: form.annual_relief,
              brackets: form.brackets,
            })}>{save.isPending ? "Saving..." : form.id ? "Save Schedule" : "Save as Tenant Override"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Live preview</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Monthly gross (LKR)</Label>
            <Input type="number" value={previewGross} onChange={(e) => setPreviewGross(Number(e.target.value) || 0)} />
          </div>
          {apitPreview && (
            <div className="space-y-1">
              <p className="text-lg font-semibold">APIT: {fmt(apitPreview.monthlyApit)}/month</p>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {apitPreview.trace.evaluation_steps.map((s, i) => <p key={i}>{s}</p>)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════════ Page ═══════════════════════ */

export default function TaxSettings() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Tax Configuration</h1>
        <p className="page-description">
          Sri Lanka tax engine — VAT, SSCL, WHT/AIT and APIT. Codes have moved here from{" "}
          <Link to="/sales/products-taxes" className="underline">Products &amp; Taxes</Link>.
        </p>
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Tax Profile</TabsTrigger>
          <TabsTrigger value="codes">Tax Codes</TabsTrigger>
          <TabsTrigger value="groups">Tax Groups</TabsTrigger>
          <TabsTrigger value="wht">WHT Rules</TabsTrigger>
          <TabsTrigger value="apit">APIT</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4"><TaxProfileTab /></TabsContent>
        <TabsContent value="codes" className="mt-4"><TaxCodesTab /></TabsContent>
        <TabsContent value="groups" className="mt-4"><TaxGroupsTab /></TabsContent>
        <TabsContent value="wht" className="mt-4"><WhtRulesTab /></TabsContent>
        <TabsContent value="apit" className="mt-4"><ApitTab /></TabsContent>
      </Tabs>
    </div>
  );
}
