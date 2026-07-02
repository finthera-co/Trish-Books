import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Repeat, Plus, Trash2, Pause, Play, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/currency";
import { useCustomers, useAccounts } from "@/hooks/useData";
import { useTaxGroups, useTaxCodes, useTaxProfile, currentRate } from "@/hooks/useTaxEngine";
import {
  useRecurringInvoices, useCreateRecurringInvoice, useSetRecurringStatus, useDeleteRecurringInvoice,
  type RecurringItemInput,
} from "@/hooks/useRecurringInvoices";

const FREQ = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];

interface LineDraft {
  id: string;
  description: string;
  qty: number;
  rate: number;
  discount: number;
  tax_sel: string; // "g:<id>" | "c:<id>" | ""
  account_id: string;
}
const emptyLine = (): LineDraft => ({ id: crypto.randomUUID(), description: "", qty: 1, rate: 0, discount: 0, tax_sel: "", account_id: "" });

const statusColor = (s: string) =>
  s === "active" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
  : s === "paused" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
  : "bg-muted text-muted-foreground";

export default function RecurringInvoices() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const { data: taxProfile } = useTaxProfile();

  const { data: schedules, isLoading } = useRecurringInvoices();
  const createRec = useCreateRecurringInvoice();
  const setStatus = useSetRecurringStatus();
  const delRec = useDeleteRecurringInvoice();

  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [form, setForm] = useState({
    customer_id: "", template_name: "", frequency: "monthly" as const,
    interval_count: 1, start_date: new Date().toISOString().split("T")[0],
    end_date: "", max_occurrences: "", auto_post: false, branch_code: "",
    payment_terms: "net_30", notes: "",
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const revenueAccounts = useMemo(
    () => (accounts ?? []).filter((a: any) => a.is_active && ["Revenue", "Income", "Other Income"].includes(a.account_type))
      .sort((a: any, b: any) => String(a.account_code).localeCompare(String(b.account_code))),
    [accounts],
  );
  const vatRegistered = !!taxProfile?.is_vat_registered;
  const ssclLiable = !!taxProfile?.is_sscl_liable;
  const codeAllowed = (c: any) =>
    c.collection_mode === "output" && !(c.tax_type === "VAT" && !vatRegistered) && !(c.tax_type === "SSCL" && !ssclLiable);
  const sellableCodes = (taxCodes ?? []).filter((c: any) => c.is_active && codeAllowed(c));
  const codesById = useMemo(() => new Map((taxCodes ?? []).map((c: any) => [c.id, c])), [taxCodes]);
  const sellableGroups = (taxGroups ?? []).filter((g: any) =>
    g.is_active && g.tax_group_members.length > 0 &&
    g.tax_group_members.every((m: any) => { const c = codesById.get(m.tax_code_id); return c && codeAllowed(c); }));

  const updateLine = (id: string, field: keyof LineDraft, value: any) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  const estTotal = lines.reduce((s, l) => s + Math.max(0, l.qty * l.rate - l.discount), 0);

  const resetForm = () => {
    setForm({ customer_id: "", template_name: "", frequency: "monthly", interval_count: 1, start_date: new Date().toISOString().split("T")[0], end_date: "", max_occurrences: "", auto_post: false, branch_code: "", payment_terms: "net_30", notes: "" });
    setLines([emptyLine()]);
  };

  const canSubmit = !!form.customer_id && !!form.template_name.trim() && lines.some((l) => l.rate > 0) && !createRec.isPending;

  const handleCreate = async () => {
    const items: RecurringItemInput[] = lines
      .filter((l) => l.rate > 0 || l.description)
      .map((l) => ({
        description: l.description, quantity: l.qty, unit_price: l.rate, discount_amount: l.discount,
        account_id: l.account_id || null,
        tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
        tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
      }));
    await createRec.mutateAsync({
      customer_id: form.customer_id,
      template_name: form.template_name.trim(),
      frequency: form.frequency,
      interval_count: Math.max(1, Number(form.interval_count) || 1),
      start_date: form.start_date,
      end_date: form.end_date || null,
      max_occurrences: form.max_occurrences ? Number(form.max_occurrences) : null,
      auto_post: form.auto_post,
      branch_code: form.branch_code.trim() || null,
      payment_terms: form.payment_terms,
      notes: form.notes || null,
      items,
    });
    setOpen(false);
    resetForm();
  };

  const freqLabel = (s: any) => {
    const f = FREQ.find((x) => x.value === s.frequency)?.label ?? s.frequency;
    return s.interval_count > 1 ? `Every ${s.interval_count} ${s.frequency === "weekly" ? "weeks" : s.frequency.replace("ly", s.frequency === "monthly" ? "s" : "s")}` : f;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Repeat className="w-6 h-6 text-primary" /> Recurring Invoices
            </h1>
            <p className="text-sm text-muted-foreground">Automatically generate invoices on a schedule (subscriptions, retainers)</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> New Schedule</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Recurring Schedule</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Customer *</Label>
                  <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>{(customers || []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Schedule name *</Label>
                  <Input value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })} placeholder="e.g. Monthly retainer" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Frequency</Label>
                  <Select value={form.frequency} onValueChange={(v: any) => setForm({ ...form, frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FREQ.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Every</Label>
                  <Input type="number" min={1} value={form.interval_count} onChange={(e) => setForm({ ...form, interval_count: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Start date</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>End date (optional)</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
                <div>
                  <Label>Max occurrences</Label>
                  <Input type="number" min={1} value={form.max_occurrences} onChange={(e) => setForm({ ...form, max_occurrences: e.target.value })} placeholder="∞" />
                </div>
                <div>
                  <Label>Payment terms</Label>
                  <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TERMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 items-end">
                <div>
                  <Label>Branch / Entity code (QQQQ)</Label>
                  <Input value={form.branch_code} onChange={(e) => setForm({ ...form, branch_code: e.target.value })} placeholder="e.g. BR03" className="font-mono" />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <Switch checked={form.auto_post} onCheckedChange={(v) => setForm({ ...form, auto_post: v })} />
                  Auto-post to GL (otherwise generated as draft)
                </label>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <Label>Line items</Label>
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {lines.map((l, idx) => (
                    <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-4 h-9 text-sm" placeholder="Description" value={l.description} onChange={(e) => updateLine(l.id, "description", e.target.value)} />
                      <Input className="col-span-1 h-9 text-sm text-center" type="number" min={1} value={l.qty || ""} onChange={(e) => updateLine(l.id, "qty", Number(e.target.value))} title="Qty" />
                      <Input className="col-span-2 h-9 text-sm text-right" type="number" placeholder="Rate" value={l.rate || ""} onChange={(e) => updateLine(l.id, "rate", Number(e.target.value))} />
                      <Select value={l.tax_sel || "none"} onValueChange={(v) => updateLine(l.id, "tax_sel", v === "none" ? "" : v)}>
                        <SelectTrigger className="col-span-2 h-9 text-xs"><SelectValue placeholder="Tax" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No tax</SelectItem>
                          {sellableGroups.length > 0 && (
                            <SelectGroup><SelectLabel>Groups</SelectLabel>
                              {sellableGroups.map((g: any) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code}</SelectItem>)}
                            </SelectGroup>
                          )}
                          {sellableCodes.length > 0 && (
                            <SelectGroup><SelectLabel>Codes</SelectLabel>
                              {sellableCodes.map((c: any) => <SelectItem key={c.id} value={`c:${c.id}`}>{c.code} ({currentRate(c) ?? 0}%)</SelectItem>)}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                      <Select value={l.account_id || "none"} onValueChange={(v) => updateLine(l.id, "account_id", v === "none" ? "" : v)}>
                        <SelectTrigger className="col-span-2 h-9 text-xs"><SelectValue placeholder="Revenue a/c" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Default</SelectItem>
                          {revenueAccounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.account_code} {a.account_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="col-span-1 flex justify-end">
                        {lines.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))}>
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setLines((p) => [...p, emptyLine()])}>
                    <Plus className="w-4 h-4 mr-1.5" /> Add line
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-right">Estimated net per invoice: <span className="font-semibold text-foreground">{formatCurrency(estTotal)}</span> (before tax)</p>
              </div>

              <Button className="w-full" onClick={handleCreate} disabled={!canSubmit}>
                {createRec.isPending ? "Creating…" : "Create Schedule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Schedules</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (schedules || []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No recurring schedules yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(schedules || []).map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.template_name}</TableCell>
                    <TableCell>{(s.customers as any)?.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{freqLabel(s)}</TableCell>
                    <TableCell className="text-muted-foreground">{s.status === "completed" ? "—" : s.next_run_date}</TableCell>
                    <TableCell className="text-muted-foreground">{s.occurrences_generated}{s.max_occurrences ? ` / ${s.max_occurrences}` : ""}</TableCell>
                    <TableCell><Badge variant="outline">{s.auto_post ? "Auto-post" : "Draft"}</Badge></TableCell>
                    <TableCell><Badge className={statusColor(s.status)}>{s.status}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {s.status === "active" && (
                            <DropdownMenuItem onClick={() => setStatus.mutate({ id: s.id, status: "paused" })}>
                              <Pause className="w-4 h-4 mr-2" /> Pause
                            </DropdownMenuItem>
                          )}
                          {s.status === "paused" && (
                            <DropdownMenuItem onClick={() => setStatus.mutate({ id: s.id, status: "active" })}>
                              <Play className="w-4 h-4 mr-2" /> Resume
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(s)}>
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule “{deleteTarget?.template_name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops future invoices from being generated. Invoices already created are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { delRec.mutate(deleteTarget.id); setDeleteTarget(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
