import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt, Plus, MoreHorizontal, Ban, Trash2, CheckCircle2, XCircle, Send, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/currency";
import { useCustomers, useInvoices } from "@/hooks/useData";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useTaxProfile, useTaxGroups, useTaxCodes, currentRate } from "@/hooks/useTaxEngine";
import { calculateLineTax, type TaxMemberInput } from "@/lib/taxEngine";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AccountCombobox from "@/components/shared/AccountCombobox";
import {
  useARAccounts,
  useCreateCreditNote,
  usePostCreditNote,
  useCreditNotes,
  useVoidCreditNote,
  useApproveCreditNote,
  useDeleteDraftCreditNote,
  type CreditNoteItemInput,
} from "@/hooks/useARModule";

const NO_INVOICE = "__none__";

interface CNLine {
  id: string;
  description: string;
  qty: number;
  rate: number;
  discount: number;
  /** "c:<codeId>" | "g:<groupId>" | "" */
  tax_sel: string;
  inclusive: boolean;
  account_id: string | null;
  product_id: string | null;
  inventory_item_id: string | null;
  is_tracked: boolean;
  restock: boolean;
}

const emptyLine = (): CNLine => ({
  id: crypto.randomUUID(),
  description: "",
  qty: 1,
  rate: 0,
  discount: 0,
  tax_sel: "",
  inclusive: false,
  account_id: null,
  product_id: null,
  inventory_item_id: null,
  is_tracked: false,
  restock: false,
});

const statusBadge = (cn: any) => {
  if (cn.status === "voided") return <Badge className="bg-destructive/10 text-destructive line-through">voided</Badge>;
  if (cn.status === "posted") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">posted</Badge>;
  // Draft: surface where it is in the approval pipeline.
  if (cn.approval_status === "pending")
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
      awaiting approval{cn.required_approvals > 1 ? ` ${cn.approvals_count}/${cn.required_approvals}` : ""}
    </Badge>;
  if (cn.approval_status === "rejected") return <Badge className="bg-destructive/10 text-destructive">rejected</Badge>;
  if (cn.approval_status === "approved") return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">approved · draft</Badge>;
  return <Badge className="bg-muted text-muted-foreground">draft</Badge>;
};

export default function CreditNotePage() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: accounts } = useARAccounts();
  const { data: settings } = useAccountSettings();
  const { data: invoices } = useInvoices();
  const { data: creditNotes, isLoading } = useCreditNotes();
  const { data: taxProfile } = useTaxProfile();
  const { data: taxCodes } = useTaxCodes();
  const { data: taxGroups } = useTaxGroups();
  const createCreditNote = useCreateCreditNote();
  const postCreditNote = usePostCreditNote();
  const voidCreditNote = useVoidCreditNote();
  const approveCreditNote = useApproveCreditNote();
  const deleteDraft = useDeleteDraftCreditNote();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [form, setForm] = useState({
    customer_id: "",
    invoice_id: NO_INVOICE,
    credit_date: new Date().toISOString().split("T")[0],
    reason: "",
    ar_account_id: "",
    revenue_account_id: "",
  });
  const [lines, setLines] = useState<CNLine[]>([emptyLine()]);

  const resolvedAr = form.ar_account_id || settings?.ar_account_id || "";
  const resolvedRev = form.revenue_account_id || settings?.sales_account_id || "";
  const needsArPicker = !settings?.ar_account_id;
  const needsRevPicker = !settings?.sales_account_id;

  // Open, posted invoices for the chosen customer.
  const customerInvoices = useMemo(
    () =>
      ((invoices ?? []) as any[]).filter(
        (i) =>
          i.customer_id === form.customer_id &&
          i.status !== "draft" &&
          i.status !== "voided" &&
          Number(i.balance_due) > 0,
      ),
    [invoices, form.customer_id],
  );
  const selectedInvoice = customerInvoices.find((i: any) => i.id === form.invoice_id) as any;
  const amountCap = selectedInvoice ? Number(selectedInvoice.balance_due) : null;
  const cnCurrency = selectedInvoice?.currency || "LKR";
  const cnRate = selectedInvoice ? Number(selectedInvoice.exchange_rate) || 1 : 1;

  // ── Tax machinery (same engine + gating as CreateInvoice) ────────────
  const codesById = useMemo(() => new Map((taxCodes || []).map((c: any) => [c.id, c])), [taxCodes]);
  const vatRegistered = !!taxProfile?.is_vat_registered;
  const ssclLiable = !!taxProfile?.is_sscl_liable;
  const codeAllowed = useCallback((c: any) => {
    if (c.collection_mode !== "output") return false;
    if (c.tax_type === "VAT" && !vatRegistered) return false;
    if (c.tax_type === "SSCL" && !ssclLiable) return false;
    return true;
  }, [vatRegistered, ssclLiable]);
  const sellableCodes = useMemo(() => (taxCodes || []).filter((c: any) => c.is_active && codeAllowed(c)), [taxCodes, codeAllowed]);
  const sellableGroups = useMemo(
    () => (taxGroups || []).filter((g: any) =>
      g.is_active && g.tax_group_members.length > 0 &&
      g.tax_group_members.every((m: any) => { const c = codesById.get(m.tax_code_id); return c && codeAllowed(c); })
    ),
    [taxGroups, codesById, codeAllowed],
  );

  const membersFor = useCallback((sel: string): TaxMemberInput[] => {
    if (sel.startsWith("g:")) {
      const g = (taxGroups || []).find((x: any) => x.id === sel.slice(2)) as any;
      if (!g) return [];
      return [...g.tax_group_members]
        .sort((a: any, b: any) => a.apply_order - b.apply_order)
        .map((m: any) => {
          const c = codesById.get(m.tax_code_id) as any;
          if (!c) return null;
          return {
            taxCodeId: c.id, code: c.code, rate: currentRate(c, form.credit_date) ?? 0,
            isCompound: m.compound_on_previous, applyOrder: m.apply_order,
            collectionMode: c.collection_mode,
          };
        })
        .filter(Boolean) as TaxMemberInput[];
    }
    if (sel.startsWith("c:")) {
      const c = codesById.get(sel.slice(2)) as any;
      if (!c) return [];
      return [{
        taxCodeId: c.id, code: c.code, rate: currentRate(c, form.credit_date) ?? 0,
        isCompound: false, applyOrder: 1, collectionMode: c.collection_mode,
      }];
    }
    return [];
  }, [taxGroups, codesById, form.credit_date]);

  const lineCalcs = useMemo(() => lines.map((l) => {
    const lineAmount = l.qty * l.rate - l.discount;
    const members = membersFor(l.tax_sel);
    if (members.length === 0 || lineAmount <= 0) {
      const base = Math.round(Math.max(0, lineAmount) * 100) / 100;
      return { exclusiveBase: base, taxes: [] as any[], lineTotal: base };
    }
    const first = codesById.get(members[0].taxCodeId) as any;
    return calculateLineTax({
      lineAmount,
      isInclusive: l.inclusive,
      members,
      roundingMethod: (first?.rounding_method as any) || "half_up",
      roundingLevel: "line",
      documentDate: form.credit_date,
    });
  }), [lines, membersFor, codesById, form.credit_date]);

  const subtotal = useMemo(() => Math.round(lineCalcs.reduce((s, c) => s + c.exclusiveBase, 0) * 100) / 100, [lineCalcs]);
  const taxByCode = useMemo(() => {
    const map = new Map<string, { code: string; rate: number; amount: number }>();
    for (const c of lineCalcs) for (const t of c.taxes) {
      const e = map.get(t.taxCodeId) || { code: t.code, rate: t.rate, amount: 0 };
      e.amount = Math.round((e.amount + t.amount) * 100) / 100;
      map.set(t.taxCodeId, e);
    }
    return [...map.values()];
  }, [lineCalcs]);
  const totalTax = useMemo(() => Math.round(taxByCode.reduce((s, t) => s + t.amount, 0) * 100) / 100, [taxByCode]);
  const total = Math.round((subtotal + totalTax) * 100) / 100;
  const overCap = amountCap !== null && total > amountCap + 0.005;

  const resetForm = () => {
    setForm({
      customer_id: "",
      invoice_id: NO_INVOICE,
      credit_date: new Date().toISOString().split("T")[0],
      reason: "",
      ar_account_id: "",
      revenue_account_id: "",
    });
    setLines([emptyLine()]);
  };

  const updateLine = (id: string, patch: Partial<CNLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  // Copy the linked invoice's lines (incl. products for restock eligibility).
  const prefillFromInvoice = async () => {
    if (form.invoice_id === NO_INVOICE) return;
    const { data, error } = await supabase
      .from("invoice_items")
      .select("*, products(id, name, is_tracked, inventory_item_id)")
      .eq("invoice_id", form.invoice_id);
    if (error) return toast.error(error.message);
    if (!data?.length) return toast.error("The invoice has no line items to copy");
    setLines(
      data.map((it: any) => ({
        id: crypto.randomUUID(),
        description: it.description || it.products?.name || "",
        qty: Number(it.quantity) || 1,
        rate: Number(it.unit_price) || 0,
        discount: Number(it.discount_amount) || 0,
        tax_sel: it.tax_group_id ? `g:${it.tax_group_id}` : it.tax_code_id ? `c:${it.tax_code_id}` : "",
        inclusive: !!it.is_tax_inclusive,
        account_id: it.account_id || null,
        product_id: it.product_id || null,
        inventory_item_id: it.inventory_item_id || it.products?.inventory_item_id || null,
        is_tracked: !!it.products?.is_tracked && !!(it.inventory_item_id || it.products?.inventory_item_id),
        restock: false,
      })),
    );
  };

  const buildItems = (): CreditNoteItemInput[] =>
    lines
      .filter((l) => l.qty > 0 && l.rate > 0)
      .map((l, idx) => ({
        description: l.description || undefined,
        quantity: l.qty,
        unit_price: l.rate,
        discount_amount: l.discount || 0,
        is_tax_inclusive: l.inclusive,
        account_id: l.account_id,
        product_id: l.product_id,
        inventory_item_id: l.inventory_item_id,
        tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
        tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
        restock: l.restock && l.is_tracked,
        sort_order: idx,
      }));

  const canSubmit =
    !!form.customer_id && total > 0 && !overCap && !!resolvedAr && !!resolvedRev &&
    !saving && buildItems().length > 0;

  const handleSave = async (shouldPost: boolean) => {
    setSaving(true);
    try {
      const cn = await createCreditNote.mutateAsync({
        customer_id: form.customer_id,
        credit_date: form.credit_date,
        reason: form.reason,
        invoice_id: form.invoice_id === NO_INVOICE ? null : form.invoice_id,
        currency: cnCurrency,
        exchange_rate: cnRate,
        ar_account_id: resolvedAr,
        revenue_account_id: resolvedRev,
        amount: total,
        subtotal,
        tax_amount: totalTax,
        items: buildItems(),
      });
      if (shouldPost) {
        try {
          await postCreditNote.mutateAsync({ credit_note_id: cn.id });
        } catch {
          // Draft is saved; the posting error (e.g. approval required) is already toasted.
        }
      } else {
        toast.success(`Draft ${cn.credit_note_number} saved`);
      }
      setOpen(false);
      resetForm();
    } catch {
      // toasted by the mutation
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    await voidCreditNote.mutateAsync({ credit_note_id: voidTarget.id, reason: voidReason || undefined });
    setVoidTarget(null);
    setVoidReason("");
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) return toast.error("A reason is required to reject");
    await approveCreditNote.mutateAsync({ credit_note_id: rejectTarget.id, decision: "rejected", note: rejectReason });
    setRejectTarget(null);
    setRejectReason("");
  };

  // Summary across posted notes.
  const active = (creditNotes ?? []).filter((c: any) => c.status === "posted");
  const thisMonth = new Date().toISOString().slice(0, 7);
  const stats = {
    total: active.reduce((s: number, c: any) => s + Number(c.amount), 0),
    month: active.filter((c: any) => (c.credit_date || "").startsWith(thisMonth)).reduce((s: number, c: any) => s + Number(c.amount), 0),
    count: active.length,
    pending: (creditNotes ?? []).filter((c: any) => c.status === "draft" && c.approval_status === "pending").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Receipt className="w-6 h-6 text-warning" /> Credit Notes
            </h1>
            <p className="text-sm text-muted-foreground">
              Line-level credits with VAT/SSCL reversal, optional restock, and the same approval controls as invoices
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Credit Note</Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Credit Note</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Customer *</Label>
                  <Select
                    value={form.customer_id}
                    onValueChange={(v) => { setForm({ ...form, customer_id: v, invoice_id: NO_INVOICE }); setLines([emptyLine()]); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>
                      {(customers || []).map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Apply to invoice (optional)</Label>
                  <Select
                    value={form.invoice_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, invoice_id: v }))}
                    disabled={!form.customer_id}
                  >
                    <SelectTrigger><SelectValue placeholder="Unapplied (credit on account)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_INVOICE}>— Credit on account —</SelectItem>
                      {customerInvoices.map((i: any) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.invoice_number} · bal {formatCurrency(Number(i.balance_due), i.currency)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.credit_date} onChange={(e) => setForm({ ...form, credit_date: e.target.value })} />
                </div>
              </div>

              {form.invoice_id !== NO_INVOICE && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Linked to {selectedInvoice?.invoice_number} ({cnCurrency}
                    {cnCurrency !== "LKR" ? ` @ ${cnRate}` : ""}) — the credit cannot exceed its {formatCurrency(amountCap ?? 0, cnCurrency)} balance.
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={prefillFromInvoice}>
                    <FileDown className="w-3.5 h-3.5 mr-1" /> Copy invoice lines
                  </Button>
                </div>
              )}

              {/* Lines */}
              <div className="border border-border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-48">Description</TableHead>
                      <TableHead className="w-20 text-right">Qty</TableHead>
                      <TableHead className="w-28 text-right">Unit price</TableHead>
                      <TableHead className="w-24 text-right">Discount</TableHead>
                      <TableHead className="w-40">Tax</TableHead>
                      <TableHead className="w-20 text-center" title="Return the goods to stock (tracked products from a linked invoice)">Restock</TableHead>
                      <TableHead className="w-28 text-right">Line total</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, idx) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <Input value={l.description} placeholder="Reason / item description"
                            onChange={(e) => updateLine(l.id, { description: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="0.01" className="text-right" value={l.qty}
                            onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="0.01" className="text-right" value={l.rate}
                            onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="0.01" className="text-right" value={l.discount}
                            onChange={(e) => updateLine(l.id, { discount: Number(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell>
                          <Select value={l.tax_sel || "none"} onValueChange={(v) => updateLine(l.id, { tax_sel: v === "none" ? "" : v })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="No tax" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tax</SelectItem>
                              {sellableGroups.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel>Groups</SelectLabel>
                                  {sellableGroups.map((g: any) => (
                                    <SelectItem key={g.id} value={`g:${g.id}`}>{g.name}</SelectItem>
                                  ))}
                                </SelectGroup>
                              )}
                              {sellableCodes.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel>Codes</SelectLabel>
                                  {sellableCodes.map((c: any) => (
                                    <SelectItem key={c.id} value={`c:${c.id}`}>
                                      {c.code} ({currentRate(c, form.credit_date) ?? 0}%)
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={l.restock}
                            disabled={!l.is_tracked}
                            onCheckedChange={(v) => updateLine(l.id, { restock: !!v })}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatCurrency(lineCalcs[idx]?.lineTotal ?? 0, cnCurrency)}
                        </TableCell>
                        <TableCell>
                          <button className="p-1 rounded hover:bg-accent" onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))}>
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add line
              </Button>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-72 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(subtotal, cnCurrency)}</span></div>
                  {taxByCode.map((t) => (
                    <div key={t.code} className="flex justify-between">
                      <span className="text-muted-foreground">{t.code} ({t.rate}%)</span>
                      <span className="tabular-nums">{formatCurrency(t.amount, cnCurrency)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-semibold border-t border-border pt-1">
                    <span>Total credit</span><span className="tabular-nums">{formatCurrency(total, cnCurrency)}</span>
                  </div>
                  {overCap && (
                    <p className="text-[11px] text-destructive">Exceeds the invoice balance ({formatCurrency(amountCap!, cnCurrency)})</p>
                  )}
                </div>
              </div>

              {/* Account fallbacks — only when tenant defaults are missing. */}
              {(needsArPicker || needsRevPicker) && (
                <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Set defaults in Settings → Account Mapping to skip this step.
                  </p>
                  {needsArPicker && (
                    <div>
                      <Label>AR Account *</Label>
                      <AccountCombobox
                        options={accounts?.arAccounts || []}
                        value={form.ar_account_id}
                        onChange={(v) => setForm({ ...form, ar_account_id: v })}
                        placeholder="Select AR account"
                      />
                    </div>
                  )}
                  {needsRevPicker && (
                    <div>
                      <Label>Revenue Account *</Label>
                      <AccountCombobox
                        options={accounts?.revenueAccounts || []}
                        value={form.revenue_account_id}
                        onChange={(v) => setForm({ ...form, revenue_account_id: v })}
                        placeholder="Select revenue account"
                      />
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for credit note" />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => handleSave(false)} disabled={!canSubmit}>
                  {saving ? "Saving…" : "Save Draft"}
                </Button>
                <Button className="flex-1" onClick={() => handleSave(true)} disabled={!canSubmit}>
                  <Send className="w-4 h-4 mr-2" />{saving ? "Posting…" : "Save & Post"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Posting reverses output VAT/SSCL in the tax sub-ledger, restores stock for restocked lines, and books
                Dr Revenue / Dr Tax Payable / Cr Accounts Receivable. Notes at or above the approval threshold need
                sign-off before they can post.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Credited</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.total)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">This Month</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.month)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Posted Notes</p><p className="text-xl font-semibold text-foreground mt-1">{stats.count}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Awaiting Approval</p><p className="text-xl font-semibold text-foreground mt-1">{stats.pending}</p></div>
      </div>

      <Card>
        <CardHeader><CardTitle>Credit Notes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (creditNotes || []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No credit notes yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(creditNotes || []).map((cn: any) => (
                  <TableRow key={cn.id} className={cn.status === "voided" ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{cn.credit_note_number}</TableCell>
                    <TableCell>{(cn.customers as any)?.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{cn.credit_date}</TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate">{cn.reason || "—"}</TableCell>
                    <TableCell>{statusBadge(cn)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-warning">
                      {formatCurrency(Number(cn.amount), cn.currency)}
                    </TableCell>
                    <TableCell>
                      {cn.status !== "voided" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {cn.status === "draft" && cn.approval_status === "pending" && (
                              <>
                                <DropdownMenuItem onClick={() => approveCreditNote.mutate({ credit_note_id: cn.id, decision: "approved" })}>
                                  <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setRejectTarget(cn); setRejectReason(""); }}>
                                  <XCircle className="w-4 h-4 mr-2" /> Reject…
                                </DropdownMenuItem>
                              </>
                            )}
                            {cn.status === "draft" && cn.approval_status !== "pending" && cn.approval_status !== "rejected" && (
                              <DropdownMenuItem onClick={() => postCreditNote.mutate({ credit_note_id: cn.id })}>
                                <Send className="w-4 h-4 mr-2" /> Post to GL
                              </DropdownMenuItem>
                            )}
                            {cn.status === "draft" && (
                              <DropdownMenuItem className="text-destructive" onClick={() => deleteDraft.mutate({ credit_note_id: cn.id })}>
                                <Trash2 className="w-4 h-4 mr-2" /> Delete draft
                              </DropdownMenuItem>
                            )}
                            {cn.status === "posted" && (
                              <DropdownMenuItem className="text-destructive" onClick={() => { setVoidTarget(cn); setVoidReason(""); }}>
                                <Ban className="w-4 h-4 mr-2" /> Void Credit Note
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Void confirmation */}
      <AlertDialog open={!!voidTarget} onOpenChange={(v) => { if (!v) { setVoidTarget(null); setVoidReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void credit note {voidTarget?.credit_note_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts a reversing journal, restores the output VAT/SSCL that the note reversed, re-issues any
              restocked goods, and restores the customer balance. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Issued in error" className="mt-1" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleVoid}
              disabled={voidCreditNote.isPending}
            >
              {voidCreditNote.isPending ? "Voiding…" : "Void Credit Note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject (reason required) */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) { setRejectTarget(null); setRejectReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject credit note {rejectTarget?.credit_note_number}?</AlertDialogTitle>
            <AlertDialogDescription>A rejected note cannot be posted. A reason is required.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Label className="text-xs text-muted-foreground">Reason *</Label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" className="mt-1" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleReject}
              disabled={approveCreditNote.isPending || !rejectReason.trim()}
            >
              {approveCreditNote.isPending ? "Rejecting…" : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
