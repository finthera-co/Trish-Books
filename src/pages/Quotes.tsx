import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Plus, Trash2, MoreHorizontal, Send, Check, X, ArrowRightCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/currency";
import { useCustomers, useAccounts } from "@/hooks/useData";
import { useTaxGroups, useTaxCodes, useTaxProfile, currentRate } from "@/hooks/useTaxEngine";
import { calculateLineTax, type TaxMemberInput } from "@/lib/taxEngine";
import {
  useQuotes, useCreateQuote, useSetQuoteStatus, useDeleteQuote, useConvertQuoteToInvoice,
  type QuoteItemInput,
} from "@/hooks/useQuotes";

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];

interface LineDraft {
  id: string; description: string; qty: number; rate: number; discount: number;
  tax_sel: string; inclusive: boolean; account_id: string;
}
const emptyLine = (): LineDraft => ({ id: crypto.randomUUID(), description: "", qty: 1, rate: 0, discount: 0, tax_sel: "", inclusive: false, account_id: "" });

const statusColor = (s: string) =>
  s === "accepted" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
  : s === "converted" ? "bg-primary/10 text-primary"
  : s === "sent" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
  : s === "declined" ? "bg-destructive/10 text-destructive"
  : s === "expired" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
  : "bg-muted text-muted-foreground";

export default function Quotes() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const { data: taxProfile } = useTaxProfile();

  const { data: quotes, isLoading } = useQuotes();
  const createQuote = useCreateQuote();
  const setStatus = useSetQuoteStatus();
  const delQuote = useDeleteQuote();
  const convert = useConvertQuoteToInvoice();

  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [form, setForm] = useState({
    customer_id: "", issue_date: new Date().toISOString().split("T")[0],
    expiry_date: "", branch_code: "", payment_terms: "net_30", notes: "",
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

  const membersFor = (sel: string): TaxMemberInput[] => {
    if (sel.startsWith("g:")) {
      const g = (taxGroups ?? []).find((x: any) => x.id === sel.slice(2));
      if (!g) return [];
      return [...g.tax_group_members].sort((a: any, b: any) => a.apply_order - b.apply_order).map((m: any) => {
        const c = codesById.get(m.tax_code_id); if (!c) return null;
        return { taxCodeId: c.id, code: c.code, rate: currentRate(c, form.issue_date) ?? 0, isCompound: m.compound_on_previous, applyOrder: m.apply_order, collectionMode: c.collection_mode };
      }).filter(Boolean) as TaxMemberInput[];
    }
    if (sel.startsWith("c:")) {
      const c = codesById.get(sel.slice(2)); if (!c) return [];
      return [{ taxCodeId: c.id, code: c.code, rate: currentRate(c, form.issue_date) ?? 0, isCompound: false, applyOrder: 1, collectionMode: c.collection_mode }];
    }
    return [];
  };

  const lineCalcs = useMemo(() => lines.map((l) => {
    const lineAmount = l.qty * l.rate - l.discount;
    const members = membersFor(l.tax_sel);
    if (members.length === 0 || lineAmount <= 0) {
      const base = Math.round(Math.max(0, lineAmount) * 100) / 100;
      return { exclusiveBase: base, taxes: [] as any[], lineTotal: base };
    }
    const first = codesById.get(members[0].taxCodeId);
    return calculateLineTax({ lineAmount, isInclusive: l.inclusive, members, roundingMethod: (first?.rounding_method as any) || "half_up", roundingLevel: "line", documentDate: form.issue_date });
  }), [lines, taxGroups, taxCodes, form.issue_date]);

  const subtotal = Math.round(lineCalcs.reduce((s, c) => s + c.exclusiveBase, 0) * 100) / 100;
  const totalTax = Math.round(lineCalcs.reduce((s, c) => s + c.taxes.reduce((t: number, x: any) => t + x.amount, 0), 0) * 100) / 100;
  const total = Math.round((subtotal + totalTax) * 100) / 100;
  const totalDiscount = lines.reduce((s, l) => s + l.discount, 0);

  const updateLine = (id: string, field: keyof LineDraft, value: any) =>
    setLines((p) => p.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  const resetForm = () => {
    setForm({ customer_id: "", issue_date: new Date().toISOString().split("T")[0], expiry_date: "", branch_code: "", payment_terms: "net_30", notes: "" });
    setLines([emptyLine()]);
  };

  const canSubmit = !!form.customer_id && lines.some((l) => l.rate > 0) && !createQuote.isPending;

  const handleCreate = async () => {
    const items: QuoteItemInput[] = lines.filter((l) => l.rate > 0 || l.description).map((l, idx) => ({
      description: l.description, quantity: l.qty, unit_price: l.rate, discount_amount: l.discount,
      total: lineCalcs[idx]?.lineTotal ?? Math.max(0, l.qty * l.rate - l.discount),
      account_id: l.account_id || null, is_tax_inclusive: l.inclusive,
      tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
      tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
    }));
    await createQuote.mutateAsync({
      customer_id: form.customer_id, issue_date: form.issue_date, expiry_date: form.expiry_date || null,
      branch_code: form.branch_code.trim() || null, payment_terms: form.payment_terms, notes: form.notes || null,
      subtotal, tax_amount: totalTax, discount_amount: totalDiscount, total_amount: total, items,
    });
    setOpen(false); resetForm();
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveStatus = (q: any) =>
    q.status === "sent" && q.expiry_date && q.expiry_date < todayIso ? "expired" : q.status;

  const handleConvert = async (q: any) => {
    const inv = await convert.mutateAsync(q.id);
    if (inv?.id) navigate(`/sales/invoices/${inv.id}/edit`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><FileText className="w-6 h-6 text-primary" /> Quotes</h1>
            <p className="text-sm text-muted-foreground">Send priced estimates and convert accepted ones into invoices</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> New Quote</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Quote</DialogTitle></DialogHeader>
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
                  <Label>Branch / Entity code (QQQQ)</Label>
                  <Input value={form.branch_code} onChange={(e) => setForm({ ...form, branch_code: e.target.value })} placeholder="e.g. BR03" className="font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><Label>Issue date</Label><Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></div>
                <div><Label>Valid until</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
                <div>
                  <Label>Payment terms</Label>
                  <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TERMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

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
                          {sellableGroups.length > 0 && <SelectGroup><SelectLabel>Groups</SelectLabel>{sellableGroups.map((g: any) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code}</SelectItem>)}</SelectGroup>}
                          {sellableCodes.length > 0 && <SelectGroup><SelectLabel>Codes</SelectLabel>{sellableCodes.map((c: any) => <SelectItem key={c.id} value={`c:${c.id}`}>{c.code} ({currentRate(c, form.issue_date) ?? 0}%)</SelectItem>)}</SelectGroup>}
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
                        {lines.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))}><Trash2 className="w-4 h-4 text-muted-foreground" /></Button>}
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setLines((p) => [...p, emptyLine()])}><Plus className="w-4 h-4 mr-1.5" /> Add line</Button>
                </div>
                <div className="flex justify-end gap-6 text-sm pt-1">
                  <span className="text-muted-foreground">Subtotal <span className="text-foreground font-medium ml-1">{formatCurrency(subtotal)}</span></span>
                  <span className="text-muted-foreground">Tax <span className="text-foreground font-medium ml-1">{formatCurrency(totalTax)}</span></span>
                  <span className="text-muted-foreground">Total <span className="text-foreground font-semibold ml-1">{formatCurrency(total)}</span></span>
                </div>
              </div>

              <Button className="w-full" onClick={handleCreate} disabled={!canSubmit}>{createQuote.isPending ? "Creating…" : "Create Quote"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Quotes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (quotes || []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No quotes yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(quotes || []).map((q: any) => {
                  const st = effectiveStatus(q);
                  const isConverted = q.status === "converted";
                  return (
                    <TableRow key={q.id}>
                      <TableCell className="font-medium">{q.quote_number}</TableCell>
                      <TableCell>{(q.customers as any)?.name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{q.issue_date}</TableCell>
                      <TableCell className="text-muted-foreground">{q.expiry_date || "—"}</TableCell>
                      <TableCell><Badge className={statusColor(st)}>{st}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(Number(q.total_amount))}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button></DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {(q.status === "draft") && (
                              <DropdownMenuItem onClick={() => setStatus.mutate({ id: q.id, status: "sent" })}><Send className="w-4 h-4 mr-2" /> Mark as Sent</DropdownMenuItem>
                            )}
                            {(q.status === "draft" || q.status === "sent") && (
                              <>
                                <DropdownMenuItem onClick={() => setStatus.mutate({ id: q.id, status: "accepted" })}><Check className="w-4 h-4 mr-2" /> Mark Accepted</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setStatus.mutate({ id: q.id, status: "declined" })}><X className="w-4 h-4 mr-2" /> Mark Declined</DropdownMenuItem>
                              </>
                            )}
                            {!isConverted && (
                              <DropdownMenuItem onClick={() => handleConvert(q)} disabled={convert.isPending}>
                                <ArrowRightCircle className="w-4 h-4 mr-2" /> Convert to Invoice
                              </DropdownMenuItem>
                            )}
                            {isConverted && q.converted_invoice_id && (
                              <DropdownMenuItem onClick={() => navigate("/sales/invoices")}>View Invoice</DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(q)}><Trash2 className="w-4 h-4 mr-2" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete quote {deleteTarget?.quote_number}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the quote. Any invoice already converted from it is unaffected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { delQuote.mutate(deleteTarget.id); setDeleteTarget(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
