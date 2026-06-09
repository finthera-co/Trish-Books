import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Plus, Trash2, Send, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomers, useAccounts, useProducts, useTaxes } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { usePostInvoice } from "@/hooks/useAccountSettings";
import { QuickCustomerDialog } from "@/components/invoices/QuickCustomerDialog";

interface LineItem {
  id: string;
  product_id: string;
  description: string;
  qty: number;
  rate: number;
  tax_id: string;
  tax_rate: number;
  discount: number;
  amount: number;
}

const emptyLine = (): LineItem => ({
  id: crypto.randomUUID(),
  product_id: "",
  description: "",
  qty: 1,
  rate: 0,
  tax_id: "",
  tax_rate: 0,
  discount: 0,
  amount: 0,
});

export default function CreateInvoice() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const { data: products } = useProducts();
  const { data: taxes } = useTaxes();
  const postInvoiceFn = usePostInvoice();

  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  // Auto-generate invoice number
  useEffect(() => {
    if (!invoiceNumber) {
      setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
    }
  }, []);

  // Account lookups
  const arAccount = useMemo(
    () => accounts?.find((a) => a.account_subtype === "Accounts Receivable" || a.account_name?.toLowerCase().includes("accounts receivable")),
    [accounts]
  );
  const revenueAccount = useMemo(
    () => accounts?.find((a) => a.account_type === "Revenue" && !a.account_name?.toLowerCase().includes("return")),
    [accounts]
  );
  const taxPayableAccount = useMemo(
    () => accounts?.find((a) => a.account_name?.toLowerCase().includes("tax payable") || a.account_subtype === "Tax Payable"),
    [accounts]
  );
  const discountAccount = useMemo(
    () => accounts?.find((a) => a.account_name?.toLowerCase().includes("discount") && a.account_type === "Expense"),
    [accounts]
  );

  const recalcLine = useCallback((line: LineItem): LineItem => {
    const gross = line.qty * line.rate;
    const afterDiscount = gross - line.discount;
    const taxAmt = afterDiscount * (line.tax_rate / 100);
    return { ...line, amount: afterDiscount + taxAmt };
  }, []);

  const updateLine = useCallback((id: string, field: string, value: any) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };
        if (field === "product_id" && products) {
          const product = products.find((p: any) => p.id === value);
          if (product) {
            updated.description = product.description || product.name;
            updated.rate = Number(product.price) || 0;
            if (product.tax_id && taxes) {
              const tax = taxes.find((t: any) => t.id === product.tax_id);
              if (tax) {
                updated.tax_id = tax.id;
                updated.tax_rate = Number(tax.tax_rate) || 0;
              }
            }
          }
        }
        if (field === "tax_id" && taxes) {
          const tax = taxes.find((t: any) => t.id === value);
          updated.tax_rate = tax ? Number(tax.tax_rate) : 0;
        }
        return recalcLine(updated);
      })
    );
  }, [products, taxes, recalcLine]);

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  const subtotal = lines.reduce((s, l) => s + l.qty * l.rate - l.discount, 0);
  const totalTax = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.tax_rate / 100), 0);
  const totalDiscount = lines.reduce((s, l) => s + l.discount, 0);
  const total = subtotal + totalTax;

  const handleSave = async (shouldPost = false) => {
    if (!customerId) return toast.error("Please select a customer");
    if (!invoiceNumber) return toast.error("Please enter an invoice number");
    if (lines.every((l) => l.rate === 0)) return toast.error("Add at least one line item");

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
          total: l.amount,
          product_id: l.product_id || null,
          tax_id: l.tax_id || null,
        }));

      if (itemInserts.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(itemInserts);
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
    <div className="space-y-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Dates */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Customer *</Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {customers?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <QuickCustomerDialog onCreated={(id) => setCustomerId(id)} />
                  </div>
                </div>
                <div>
                  <Label>Invoice Number *</Label>
                  <Input className="mt-1" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Issue Date</Label>
                  <Input type="date" className="mt-1" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" className="mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product / Description</th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground w-20">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Rate</th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground w-32">Tax</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground w-24">Discount</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Amount</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <Select
                              value={line.product_id}
                              onValueChange={(v) => updateLine(line.id, "product_id", v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select product..." />
                              </SelectTrigger>
                              <SelectContent>
                                {products?.map((p: any) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              className="h-8 text-xs"
                              placeholder="Description"
                              value={line.description}
                              onChange={(e) => updateLine(line.id, "description", e.target.value)}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            className="h-8 text-xs text-center"
                            value={line.qty || ""}
                            onChange={(e) => updateLine(line.id, "qty", Number(e.target.value))}
                            min={1}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            className="h-8 text-xs text-right"
                            value={line.rate || ""}
                            onChange={(e) => updateLine(line.id, "rate", Number(e.target.value))}
                            min={0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={line.tax_id}
                            onValueChange={(v) => updateLine(line.id, "tax_id", v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="No tax" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No Tax</SelectItem>
                              {taxes?.map((t: any) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.tax_name} ({t.tax_rate}%)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            className="h-8 text-xs text-right"
                            value={line.discount || ""}
                            onChange={(e) => updateLine(line.id, "discount", Number(e.target.value))}
                            min={0}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-foreground">
                          {formatCurrency(line.amount)}
                        </td>
                        <td className="px-3 py-2">
                          {lines.length > 1 && (
                            <Button variant="ghost" size="sm" onClick={() => removeLine(line.id)}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Notes & Terms */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Notes</Label>
                  <Textarea className="mt-1" rows={3} placeholder="Notes visible on invoice..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div>
                  <Label>Terms & Conditions</Label>
                  <Textarea className="mt-1" rows={3} placeholder="Payment terms..." value={terms} onChange={(e) => setTerms(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Totals & Journal Preview */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invoice Summary</CardTitle>
            </CardHeader>
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
              {totalTax > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-medium">{formatCurrency(totalTax)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(total)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Journal Preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Journal Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {total > 0 ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dr {arAccount?.account_name || "A/R"}</span>
                    <span className="font-mono">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span className="text-muted-foreground">Cr {revenueAccount?.account_name || "Revenue"}</span>
                    <span className="font-mono">{formatCurrency(totalDiscount > 0 ? subtotal + totalDiscount : subtotal)}</span>
                  </div>
                  {totalTax > 0 && (
                    <div className="flex justify-between pl-4">
                      <span className="text-muted-foreground">Cr {taxPayableAccount?.account_name || "Tax Payable"}</span>
                      <span className="font-mono">{formatCurrency(totalTax)}</span>
                    </div>
                  )}
                  {totalDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dr {discountAccount?.account_name || "Discount"}</span>
                      <span className="font-mono">{formatCurrency(totalDiscount)}</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <p className="text-[10px] text-muted-foreground">AR subledger entry will be created for the selected customer.</p>
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
