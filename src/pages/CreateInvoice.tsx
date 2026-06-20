import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Plus, Trash2, Send, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomers, useAccounts, useProducts } from "@/hooks/useData";
import { useTaxProfile, useTaxGroups, useTaxCodes, currentRate } from "@/hooks/useTaxEngine";
import { calculateLineTax, type TaxMemberInput } from "@/lib/taxEngine";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { usePostInvoice } from "@/hooks/useAccountSettings";
import { QuickCustomerDialog } from "@/components/invoices/QuickCustomerDialog";
import { useSetHideSidebar } from "@/stores/useAppStore";

interface LineItem {
  id: string;
  product_id: string;
  description: string;
  qty: number;
  rate: number;
  /** Encoded tax selection: "g:<groupId>" | "c:<codeId>" | "" (none). */
  tax_sel: string;
  inclusive: boolean;
  discount: number;
  /** Revenue account for THIS line (service or product income acct). Empty = fall back to default sales account in post-invoice. */
  account_id: string;
}

const emptyLine = (): LineItem => ({
  id: crypto.randomUUID(),
  product_id: "",
  description: "",
  qty: 1,
  rate: 0,
  tax_sel: "",
  inclusive: false,
  discount: 0,
  account_id: "",
});

const TERM_OPTIONS = [
  { value: "due_on_receipt", label: "Due on receipt", days: 0 },
  { value: "net_15", label: "Net 15", days: 15 },
  { value: "net_30", label: "Net 30", days: 30 },
  { value: "net_45", label: "Net 45", days: 45 },
  { value: "net_60", label: "Net 60", days: 60 },
];
const termToDays = (t: string) => TERM_OPTIONS.find((o) => o.value === t)?.days ?? 30;
const addDays = (isoDate: string, days: number) => {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

export default function CreateInvoice() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const { data: products } = useProducts();
  const { data: taxProfile } = useTaxProfile();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const postInvoiceFn = usePostInvoice();
  const setHideSidebar = useSetHideSidebar();

  // Collapse the module sidebar while drafting an invoice so the line-item
  // grid has room to breathe; restore it on leave.
  useEffect(() => {
    setHideSidebar(true);
    return () => setHideSidebar(false);
  }, [setHideSidebar]);

  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("net_30");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!invoiceNumber) setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
  }, []);

  // Inherit the selected customer's default payment term.
  useEffect(() => {
    const c = customers?.find((x) => x.id === customerId);
    if (c?.payment_terms) setPaymentTerms(c.payment_terms);
  }, [customerId, customers]);

  // Auto-compute due date = issue date + term days. The user can still override
  // the date manually afterwards.
  useEffect(() => {
    if (issueDate) setDueDate(addDays(issueDate, termToDays(paymentTerms)));
  }, [issueDate, paymentTerms]);

  // Account lookups (for journal preview only)
  const arAccount = useMemo(
    () => accounts?.find((a) => a.account_subtype === "Accounts Receivable" || a.account_name?.toLowerCase().includes("accounts receivable")),
    [accounts]
  );
  const revenueAccount = useMemo(
    () => accounts?.find((a) => a.account_type === "Revenue" && !a.account_name?.toLowerCase().includes("return")),
    [accounts]
  );

  // All active income accounts, for the per-line revenue-account picker. Sorted by code.
  // "Revenue" is the live COA label; "Income"/"Other Income" are defensive and harmless if unused.
  const revenueAccounts = useMemo(
    () =>
      (accounts ?? [])
        .filter(
          (a: any) =>
            a.is_active &&
            (a.account_type === "Revenue" ||
              a.account_type === "Income" ||
              a.account_type === "Other Income"),
        )
        .sort((a: any, b: any) =>
          String(a.account_code).localeCompare(String(b.account_code)),
        ),
    [accounts]
  );

  const productsById = useMemo(
    () => new Map((products || []).map((p: any) => [p.id, p])),
    [products]
  );

  // Inventory-awareness helpers for invoice lines. A product is stock-moving only
  // when it's an inventory type, tracked, and linked to an inventory_items row.
  const isTracked = useCallback((p: any) =>
    !!p && p.type === "inventory" && p.is_tracked && !!p.inventory_item_id, []);
  const onHandOf = useCallback((p: any) =>
    isTracked(p) ? Number(p.inventory_item?.quantity_on_hand) || 0 : null, [isTracked]);
  // Current unit cost for a stocked item (moving-average), falling back to the
  // last purchase price. Null for services / non-inventory items.
  const costOf = useCallback((p: any) => {
    if (!isTracked(p)) return null;
    const c = p.inventory_item?.unit_cost ?? p.inventory_item?.last_purchase_price;
    return c == null ? null : Number(c) || 0;
  }, [isTracked]);
  const typeLabel = useCallback((p: any) => {
    if (!p) return null;
    if (isTracked(p)) return "Stock";
    if (p.type === "service") return "Service";
    return "Non-inv";
  }, [isTracked]);

  const codesById = useMemo(() => new Map((taxCodes || []).map((c) => [c.id, c])), [taxCodes]);
  const vatRegistered = !!taxProfile?.is_vat_registered;
  const ssclLiable = !!taxProfile?.is_sscl_liable;

  // A code is selectable on a SALES invoice only when it is output-mode and
  // its tax type is allowed by the tenant profile (VAT hidden if not
  // registered; SSCL hidden if not liable).
  const codeAllowed = useCallback((c: any) => {
    if (c.collection_mode !== "output") return false;
    if (c.tax_type === "VAT" && !vatRegistered) return false;
    if (c.tax_type === "SSCL" && !ssclLiable) return false;
    return true;
  }, [vatRegistered, ssclLiable]);

  const sellableCodes = useMemo(
    () => (taxCodes || []).filter((c) => c.is_active && codeAllowed(c)),
    [taxCodes, codeAllowed]
  );
  // A group is offered only if every member is allowed by the profile.
  const sellableGroups = useMemo(
    () => (taxGroups || []).filter((g) =>
      g.is_active &&
      g.tax_group_members.length > 0 &&
      g.tax_group_members.every((m) => {
        const c = codesById.get(m.tax_code_id);
        return c && codeAllowed(c);
      })
    ),
    [taxGroups, codesById, codeAllowed]
  );

  // Resolve a line's encoded selection into engine members at the issue date.
  const membersFor = useCallback((sel: string): TaxMemberInput[] => {
    if (sel.startsWith("g:")) {
      const g = (taxGroups || []).find((x) => x.id === sel.slice(2));
      if (!g) return [];
      return [...g.tax_group_members]
        .sort((a, b) => a.apply_order - b.apply_order)
        .map((m) => {
          const c = codesById.get(m.tax_code_id);
          if (!c) return null;
          return {
            taxCodeId: c.id, code: c.code, rate: currentRate(c, issueDate) ?? 0,
            isCompound: m.compound_on_previous, applyOrder: m.apply_order,
            collectionMode: c.collection_mode as any,
          };
        })
        .filter(Boolean) as TaxMemberInput[];
    }
    if (sel.startsWith("c:")) {
      const c = codesById.get(sel.slice(2));
      if (!c) return [];
      return [{
        taxCodeId: c.id, code: c.code, rate: currentRate(c, issueDate) ?? 0,
        isCompound: false, applyOrder: 1, collectionMode: c.collection_mode as any,
      }];
    }
    return [];
  }, [taxGroups, codesById, issueDate]);

  const updateLine = useCallback((id: string, field: string, value: any) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };
        if (field === "product_id" && products) {
          const product: any = products.find((p: any) => p.id === value);
          if (product) {
            updated.description = product.description || product.name;
            // Stocked goods default to inventory selling_price when set; otherwise
            // the product master price (current behavior for services/non-inventory).
            const sellPrice = product.inventory_item?.selling_price;
            updated.rate = Number(sellPrice ?? product.price) || 0;
            // Inherit the product's revenue account onto this line.
            updated.account_id = product.income_account_id || "";
            // Default tax from the product (group preferred, then code)
            if (product.default_tax_group_id) updated.tax_sel = `g:${product.default_tax_group_id}`;
            else if (product.default_tax_code_id) updated.tax_sel = `c:${product.default_tax_code_id}`;
          } else {
            // Product cleared → this is now a service line: drop the inherited revenue
            // account so the manual picker takes over, and reset qty (a service bills a
            // flat amount, not qty × rate).
            updated.account_id = "";
            updated.qty = 1;
          }
        }
        return updated;
      })
    );
  }, [products]);

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  // ── Live tax computation via the shared engine ──────────────────────
  const lineCalcs = useMemo(() => {
    return lines.map((l) => {
      const lineAmount = l.qty * l.rate - l.discount;
      const members = membersFor(l.tax_sel);
      if (members.length === 0 || lineAmount <= 0) {
        const base = Math.round(Math.max(0, lineAmount) * 100) / 100;
        return { exclusiveBase: base, taxes: [] as any[], lineTotal: base };
      }
      const first = codesById.get(members[0].taxCodeId);
      return calculateLineTax({
        lineAmount,
        isInclusive: l.inclusive,
        members,
        roundingMethod: (first?.rounding_method as any) || "half_up",
        roundingLevel: "line",
        documentDate: issueDate,
      });
    });
  }, [lines, membersFor, codesById, issueDate]);

  const subtotal = useMemo(() => Math.round(lineCalcs.reduce((s, c) => s + c.exclusiveBase, 0) * 100) / 100, [lineCalcs]);
  const totalDiscount = useMemo(() => lines.reduce((s, l) => s + l.discount, 0), [lines]);

  // Aggregate tax per code across lines for the footer ("one row per code")
  const taxByCode = useMemo(() => {
    const map = new Map<string, { code: string; rate: number; amount: number }>();
    for (const c of lineCalcs) {
      for (const t of c.taxes) {
        const e = map.get(t.taxCodeId) || { code: t.code, rate: t.rate, amount: 0 };
        e.amount = Math.round((e.amount + t.amount) * 100) / 100;
        map.set(t.taxCodeId, e);
      }
    }
    return [...map.values()];
  }, [lineCalcs]);

  const totalTax = useMemo(() => Math.round(taxByCode.reduce((s, t) => s + t.amount, 0) * 100) / 100, [taxByCode]);
  const total = Math.round((subtotal + totalTax) * 100) / 100;

  const handleSave = async (shouldPost = false) => {
    if (!customerId) return toast.error("Please select a customer");
    if (!invoiceNumber) return toast.error("Please enter an invoice number");
    if (lines.every((l) => l.rate === 0)) return toast.error("Add at least one line item");

    // Non-blocking warning: a posted line with an amount but no revenue account and no
    // product silently lands in the default sales account — a footgun for service firms.
    if (shouldPost) {
      const unmapped = lines.filter((l) => l.rate > 0 && !l.account_id && !l.product_id);
      if (unmapped.length > 0) {
        const proceed = window.confirm(
          `${unmapped.length} line(s) have no revenue account selected and will post to the ` +
            `default sales account. Continue posting?`,
        );
        if (!proceed) return;
      }
    }

    const setter = shouldPost ? setPosting : setSaving;
    setter(true);

    try {
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          tenant_id: appUser?.tenant_id,
          customer_id: customerId,
          invoice_number: invoiceNumber,
          issue_date: issueDate,
          due_date: dueDate || null,
          payment_terms: paymentTerms,
          total_amount: total,
          subtotal,
          tax_amount: totalTax,
          discount_amount: totalDiscount,
          notes: notes || null,
          terms: terms || null,
          status: "draft",
        } as any)
        .select()
        .single();

      if (invErr) throw invErr;

      const itemInserts = lines
        .filter((l) => l.rate > 0 || l.description)
        .map((l) => ({
          invoice_id: invoice.id,
          description: l.description,
          quantity: l.qty,
          unit_price: l.rate,
          // total carries the line gross (incl. tax) for display; the server
          // recomputes tax from qty*unit_price - discount_amount + is_tax_inclusive
          total: lineCalcs[lines.indexOf(l)]?.lineTotal ?? l.qty * l.rate - l.discount,
          product_id: l.product_id || null,
          // Revenue account for this line; null → post-invoice falls back to defaultSalesId.
          // Do NOT set inventory_item_id here — the DB trigger snapshots it from the product
          // only when the product is tracked, so service lines correctly stay null.
          account_id: l.account_id || null,
          discount_amount: l.discount,
          is_tax_inclusive: l.inclusive,
          tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
          tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
        }));

      if (itemInserts.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(itemInserts as any);
        if (itemErr) throw itemErr;
      }

      if (shouldPost) {
        await postInvoiceFn.mutateAsync({ invoice_id: invoice.id, action: "post" });
      } else {
        toast.success("Invoice saved as draft");
      }

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate("/sales/invoices");
    } catch (err: any) {
      toast.error(err.message || "Failed to save invoice");
    } finally {
      setter(false);
    }
  };

  const customer = customers?.find((c) => c.id === customerId);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/sales/invoices")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Create Invoice</h1>
            <p className="text-sm text-muted-foreground">Fill in the details to create a new invoice</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving || posting}>
            <Save className="w-4 h-4 mr-1" />
            {saving ? "Saving..." : "Save Draft"}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving || posting}>
            <Send className="w-4 h-4 mr-1" />
            {posting ? "Posting..." : "Save & Post"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Main Form */}
        <div className="lg:col-span-3 space-y-8">
          {/* Customer & Dates */}
          <Card>
            <CardContent className="pt-6 space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label>Customer *</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                      <SelectContent>
                        {customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <QuickCustomerDialog onCreated={(id) => setCustomerId(id)} />
                  </div>
                </div>
                <div>
                  <Label>Invoice Number *</Label>
                  <Input className="mt-1.5" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <Label>Issue Date</Label>
                  <Input type="date" className="mt-1.5" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Payment Terms</Label>
                  <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TERM_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" className="mt-1.5" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
              {customer && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm">
                  <p className="font-medium">{customer.name}</p>
                  {customer.email && <p className="text-muted-foreground">{customer.email}</p>}
                  {customer.address && <p className="text-muted-foreground">{customer.address}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Line Items</CardTitle>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus className="w-4 h-4 mr-1" /> Add Line
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[280px]">Product / Description</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground w-20">Qty</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Unit Cost</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Rate / Amount</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground w-28">Tax</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground w-20">Discount</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Amount</th>
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const lineProduct = line.product_id ? productsById.get(line.product_id) : null;
                      const lineOnHand = onHandOf(lineProduct);
                      const lineCost = costOf(lineProduct);
                      const lineBadge = typeLabel(lineProduct);
                      // A line with no product is a service / ad-hoc line: it bills a flat
                      // amount against a chosen revenue account — no qty, no unit cost, no
                      // COGS leg. Selecting a product switches it back to a goods line.
                      const isService = !line.product_id;
                      const overStock = lineOnHand !== null && line.qty > lineOnHand;
                      // Gross margin % on the entered rate vs unit cost (stocked items only)
                      const marginPct = lineCost && line.rate > 0
                        ? Math.round(((line.rate - lineCost) / line.rate) * 100)
                        : null;
                      return (
                      <tr key={line.id} className="border-t border-border align-top">
                        <td className="px-4 py-5">
                          <div className="space-y-3">
                            <Select value={line.product_id || "none"}
                              onValueChange={(v) => updateLine(line.id, "product_id", v === "none" ? "" : v)}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select product..." /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— No product (service) —</SelectItem>
                                {products?.map((p: any) => {
                                  const oh = onHandOf(p);
                                  return (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}{oh !== null ? ` — ${oh} in stock` : ""}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <Input className="h-9 text-sm" placeholder="Description" value={line.description}
                              onChange={(e) => updateLine(line.id, "description", e.target.value)} />
                            {/* Revenue account for this line — auto-filled from the product's
                                income account, or pick directly for an ad-hoc service line. */}
                            <Select value={line.account_id} onValueChange={(v) => updateLine(line.id, "account_id", v)}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Revenue account…" />
                              </SelectTrigger>
                              <SelectContent>
                                {revenueAccounts.map((a: any) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.account_code} · {a.account_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {(lineBadge || isService) && (
                              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {lineBadge ?? "Service"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          {isService ? (
                            // Service lines bill a flat amount; quantity is not applicable.
                            <div className="h-9 flex items-center justify-center">
                              <span className="text-xs text-muted-foreground/60">—</span>
                            </div>
                          ) : (
                            <>
                              <Input type="number"
                                className={`h-9 text-sm text-center${overStock ? " border-destructive focus-visible:ring-destructive" : ""}`}
                                value={line.qty || ""}
                                onChange={(e) => updateLine(line.id, "qty", Number(e.target.value))} min={1} />
                              {overStock && (
                                <p className="text-[10px] text-destructive mt-1">Only {lineOnHand} in stock</p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-5">
                          <div className="h-9 flex items-center justify-end">
                            {lineCost !== null ? (
                              <span className="text-sm font-medium text-muted-foreground tabular-nums">
                                {formatCurrency(lineCost)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/60">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <Input type="number" className="h-9 text-sm text-right" placeholder={isService ? "Amount" : "Rate"}
                            value={line.rate || ""}
                            onChange={(e) => updateLine(line.id, "rate", Number(e.target.value))} min={0} />
                          {marginPct !== null && (
                            <p className={`text-[10px] mt-1 text-right ${marginPct < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {marginPct}% margin
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-5">
                          <div className="space-y-2">
                            <Select value={line.tax_sel || "none"}
                              onValueChange={(v) => updateLine(line.id, "tax_sel", v === "none" ? "" : v)}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="No tax" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No Tax</SelectItem>
                                {sellableGroups.length > 0 && (
                                  <SelectGroup>
                                    <SelectLabel>Groups</SelectLabel>
                                    {sellableGroups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code}</SelectItem>)}
                                  </SelectGroup>
                                )}
                                {sellableCodes.length > 0 && (
                                  <SelectGroup>
                                    <SelectLabel>Codes</SelectLabel>
                                    {sellableCodes.map((c) => (
                                      <SelectItem key={c.id} value={`c:${c.id}`}>
                                        {c.code} ({currentRate(c, issueDate) ?? 0}%)
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                )}
                              </SelectContent>
                            </Select>
                            {line.tax_sel && (
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Switch className="scale-75" checked={line.inclusive}
                                  onCheckedChange={(v) => updateLine(line.id, "inclusive", v)} />
                                Incl.
                              </label>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <Input type="number" className="h-9 text-sm text-right" value={line.discount || ""}
                            onChange={(e) => updateLine(line.id, "discount", Number(e.target.value))} min={0} />
                        </td>
                        <td className="px-4 py-5">
                          <div className="h-9 flex items-center justify-end font-medium text-foreground tabular-nums">
                            {formatCurrency(lineCalcs[idx]?.lineTotal ?? 0)}
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <div className="h-9 flex items-center justify-center">
                            {lines.length > 1 && (
                              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeLine(line.id)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Notes & Terms */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label>Notes</Label>
                  <Textarea className="mt-1.5" rows={4} placeholder="Notes visible on invoice..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div>
                  <Label>Terms &amp; Conditions</Label>
                  <Textarea className="mt-1.5" rows={4} placeholder="Payment terms..." value={terms} onChange={(e) => setTerms(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Totals & Journal Preview */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Invoice Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium text-destructive">-{formatCurrency(totalDiscount)}</span>
                </div>
              )}
              {/* One row per tax code */}
              {taxByCode.map((t) => (
                <div key={t.code} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.code} {t.rate}%</span>
                  <span className="font-medium">{formatCurrency(t.amount)}</span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(total)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Journal Preview */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Journal Preview</CardTitle></CardHeader>
            <CardContent>
              {total > 0 ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dr {arAccount?.account_name || "A/R"}</span>
                    <span className="font-mono">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span className="text-muted-foreground">Cr {revenueAccount?.account_name || "Revenue"}</span>
                    <span className="font-mono">{formatCurrency(subtotal)}</span>
                  </div>
                  {taxByCode.map((t) => (
                    <div key={t.code} className="flex justify-between pl-4">
                      <span className="text-muted-foreground">Cr {t.code} Payable</span>
                      <span className="font-mono">{formatCurrency(t.amount)}</span>
                    </div>
                  ))}
                  <Separator className="my-2" />
                  <p className="text-[10px] text-muted-foreground">
                    Each tax code posts to its own liability account; the server recomputes tax and rejects mismatches.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Add line items to preview journal entries</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
