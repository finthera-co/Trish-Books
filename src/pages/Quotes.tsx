import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Plus, Trash2, MoreHorizontal, Send, Check, X, ArrowRightCircle, Eye, Printer, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { discountFromPercent, percentFromDiscount } from "@/lib/lineDiscount";
import {
  useQuotes, useCreateQuote, useSetQuoteStatus, useDeleteQuote, useConvertQuoteToInvoice, useQuoteDocument,
  type QuoteItemInput,
} from "@/hooks/useQuotes";
import QuoteDocument from "@/components/quotes/QuoteDocument";
import { useAuth } from "@/contexts/AuthContext";
import { downloadQuotePdf } from "@/lib/quotePdf";
import AccountCombobox from "@/components/shared/AccountCombobox";

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];

interface LineDraft {
  id: string; description: string; qty: number; rate: number;
  /** Discount as a % of qty × rate; drives `discount`. 0 for a flat-amount discount. */
  discount_pct: number;
  /** Money value of the discount — what the tax engine and the stored line calculate on. */
  discount: number;
  tax_sel: string; inclusive: boolean; account_id: string;
}
const emptyLine = (): LineDraft => ({ id: crypto.randomUUID(), description: "", qty: 1, rate: 0, discount_pct: 0, discount: 0, tax_sel: "", inclusive: false, account_id: "" });

const statusColor = (s: string) =>
  s === "accepted" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
  : s === "converted" ? "bg-primary/10 text-primary"
  : s === "sent" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
  : s === "declined" ? "bg-destructive/10 text-destructive"
  : s === "expired" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
  : "bg-muted text-muted-foreground";

export default function Quotes() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { data: previewDoc } = useQuoteDocument(previewId);
  const [form, setForm] = useState({
    customer_id: "", issue_date: new Date().toISOString().split("T")[0],
    expiry_date: "", branch_code: "", payment_terms: "net_30", notes: "", terms: "",
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

  // Editing a line keeps its discount %/amount pair in step: the % re-derives the
  // money value from qty × rate (and follows any change to either), while typing
  // straight into the amount box re-derives the %.
  const updateLine = (id: string, field: keyof LineDraft, value: any) =>
    setLines((p) => p.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, [field]: value };
      if (field === "discount_pct") next.discount = discountFromPercent(next.qty, next.rate, next.discount_pct);
      else if (field === "discount") next.discount_pct = percentFromDiscount(next.qty, next.rate, next.discount);
      else if ((field === "qty" || field === "rate") && next.discount_pct > 0)
        next.discount = discountFromPercent(next.qty, next.rate, next.discount_pct);
      return next;
    }));

  const resetForm = () => {
    setForm({ customer_id: "", issue_date: new Date().toISOString().split("T")[0], expiry_date: "", branch_code: "", payment_terms: "net_30", notes: "", terms: "" });
    setLines([emptyLine()]);
  };

  const canSubmit = !!form.customer_id && lines.some((l) => l.rate > 0) && !createQuote.isPending;

  const handleCreate = async () => {
    const items: QuoteItemInput[] = lines.filter((l) => l.rate > 0 || l.description).map((l, idx) => ({
      description: l.description, quantity: l.qty, unit_price: l.rate,
      discount_amount: l.discount, discount_percent: l.discount_pct,
      total: lineCalcs[idx]?.lineTotal ?? Math.max(0, l.qty * l.rate - l.discount),
      account_id: l.account_id || null, is_tax_inclusive: l.inclusive,
      tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
      tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
    }));
    await createQuote.mutateAsync({
      customer_id: form.customer_id, issue_date: form.issue_date, expiry_date: form.expiry_date || null,
      branch_code: form.branch_code.trim() || null, payment_terms: form.payment_terms,
      notes: form.notes || null, terms: form.terms || null,
      subtotal, tax_amount: totalTax, discount_amount: totalDiscount, total_amount: total, items,
    });
    setOpen(false); resetForm();
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveStatus = (q: any) =>
    q.status === "sent" && q.expiry_date && q.expiry_date < todayIso ? "expired" : q.status;

  // Download the estimate as a vector PDF (same "Steel Statement" design as the
  // invoice PDF). Tracked per-quote so only the row being generated shows a
  // spinner — generation embeds fonts and the logo, so it isn't instant.
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const handleDownload = async (quoteId: string) => {
    if (!appUser?.tenant_id) return toast.error("No tenant context");
    setDownloadingId(quoteId);
    try {
      await downloadQuotePdf(quoteId, appUser.tenant_id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate the estimate PDF");
    } finally {
      setDownloadingId(null);
    }
  };

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
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><FileText className="w-6 h-6 text-primary" /> Quotes / Estimates</h1>
            <p className="text-sm text-muted-foreground">Generate priced estimates, download as PDF, and convert accepted ones into invoices</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> New Quote</Button></DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
                    <div key={l.id} className="space-y-2 rounded-md border border-border/60 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-4 shrink-0 text-[11px] text-muted-foreground">{idx + 1}</span>
                        <Input className="h-9 min-w-0 flex-1 text-sm" placeholder="Description" value={l.description} onChange={(e) => updateLine(l.id, "description", e.target.value)} />
                        <AccountCombobox
                          options={revenueAccounts}
                          value={l.account_id}
                          onChange={(v) => updateLine(l.id, "account_id", v)}
                          placeholder="Default"
                          clearLabel="Default"
                          className="h-9 w-[160px] shrink-0 text-xs"
                        />
                        <div className="w-8 shrink-0">
                          {lines.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))}><Trash2 className="w-4 h-4 text-muted-foreground" /></Button>}
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-2 space-y-1">
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Qty</span>
                          <Input className="h-9 text-sm text-center tabular-nums" type="number" min={1} value={l.qty || ""} onChange={(e) => updateLine(l.id, "qty", Number(e.target.value))} />
                        </div>
                        <div className="col-span-3 space-y-1">
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Rate</span>
                          <Input className="h-9 text-sm text-right tabular-nums" type="number" min={0} placeholder="0.00" value={l.rate || ""} onChange={(e) => updateLine(l.id, "rate", Number(e.target.value))} />
                        </div>
                        {/* Discount — enter a % of qty × rate and the money value is
                            calculated, or enter the money value and the % follows. */}
                        <div className="col-span-2 space-y-1">
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Disc %</span>
                          <div className="relative">
                            <Input className="h-9 pr-4 text-sm text-right tabular-nums" type="number" min={0} max={100} step="0.01" placeholder="0"
                              value={l.discount_pct || ""} onChange={(e) => updateLine(l.id, "discount_pct", Number(e.target.value))} />
                            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="col-span-2 space-y-1">
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Disc amt</span>
                          <Input className="h-9 text-sm text-right tabular-nums" type="number" min={0} placeholder="0.00"
                            value={l.discount || ""} onChange={(e) => updateLine(l.id, "discount", Number(e.target.value))} />
                        </div>
                        <div className="col-span-3 space-y-1">
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Tax</span>
                          <Select value={l.tax_sel || "none"} onValueChange={(v) => updateLine(l.id, "tax_sel", v === "none" ? "" : v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Tax" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tax</SelectItem>
                              {sellableGroups.length > 0 && <SelectGroup><SelectLabel>Groups</SelectLabel>{sellableGroups.map((g: any) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code}</SelectItem>)}</SelectGroup>}
                              {sellableCodes.length > 0 && <SelectGroup><SelectLabel>Codes</SelectLabel>{sellableCodes.map((c: any) => <SelectItem key={c.id} value={`c:${c.id}`}>{c.code} ({currentRate(c, form.issue_date) ?? 0}%)</SelectItem>)}</SelectGroup>}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-4 text-[11px]">
                        {l.discount > 0 && (
                          <span className="text-muted-foreground">
                            Discount <span className="tabular-nums text-destructive">−{formatCurrency(l.discount)}</span>
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          Amount <span className="ml-1 tabular-nums font-semibold text-foreground">{formatCurrency(lineCalcs[idx]?.lineTotal ?? 0)}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setLines((p) => [...p, emptyLine()])}><Plus className="w-4 h-4 mr-1.5" /> Add line</Button>
                </div>
                <div className="flex justify-end gap-6 text-sm pt-1">
                  <span className="text-muted-foreground">Subtotal <span className="text-foreground font-medium ml-1">{formatCurrency(subtotal)}</span></span>
                  {totalDiscount > 0 && (
                    <span className="text-muted-foreground">Discount <span className="text-destructive font-medium ml-1">−{formatCurrency(totalDiscount)}</span></span>
                  )}
                  <span className="text-muted-foreground">Tax <span className="text-foreground font-medium ml-1">{formatCurrency(totalTax)}</span></span>
                  <span className="text-muted-foreground">Total <span className="text-foreground font-semibold ml-1">{formatCurrency(total)}</span></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Notes</Label>
                  <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Visible on the estimate…"
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <Label>Terms &amp; Conditions</Label>
                  <textarea rows={3} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })}
                    placeholder="e.g. 50% advance, balance on delivery…"
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground" />
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
                            <DropdownMenuItem onClick={() => setPreviewId(q.id)}><Eye className="w-4 h-4 mr-2" /> Preview</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload(q.id)} disabled={downloadingId === q.id}>
                              {downloadingId === q.id
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                : <Download className="w-4 h-4 mr-2" />}
                              {downloadingId === q.id ? "Preparing…" : "Download PDF"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
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

      {/* Estimate preview / PDF */}
      <Dialog open={!!previewId} onOpenChange={(v) => { if (!v) setPreviewId(null); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6 print:hidden">
            <DialogTitle>Estimate {previewDoc?.quote?.quote_number ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="px-6">
            {previewDoc ? (
              <div className="rounded border border-border overflow-hidden">
                <QuoteDocument quote={previewDoc.quote} company={previewDoc.company} />
              </div>
            ) : (
              <p className="py-10 text-center text-muted-foreground">Loading…</p>
            )}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 print:hidden">
            <Button variant="outline" onClick={() => setPreviewId(null)}>Close</Button>
            <Button variant="outline" onClick={() => window.print()} disabled={!previewDoc}><Printer className="w-4 h-4 mr-1.5" /> Print</Button>
            <Button onClick={() => previewId && handleDownload(previewId)} disabled={!previewDoc || downloadingId === previewId}>
              {downloadingId === previewId
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <Download className="w-4 h-4 mr-1.5" />}
              {downloadingId === previewId ? "Preparing…" : "Download PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
