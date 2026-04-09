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
import { useInvoiceTemplates } from "@/hooks/useInvoiceTemplates";
import { supabase } from "@/integrations/supabase/client";
import { post } from "@/lib/postingEngine";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { DesignerComponent, TableSettings, PageSettings } from "@/components/invoice-designer/types";

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
  const { data: templates } = useInvoiceTemplates();

  // Form state
  const [templateId, setTemplateId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  // Template data
  const selectedTemplate = useMemo(
    () => templates?.find((t: any) => t.id === templateId),
    [templates, templateId]
  );

  const tableSettings: TableSettings | null = useMemo(() => {
    if (!selectedTemplate?.table_settings) return null;
    return selectedTemplate.table_settings as unknown as TableSettings;
  }, [selectedTemplate]);

  // Auto-select default template
  useEffect(() => {
    if (templates && templates.length > 0 && !templateId) {
      const def = templates.find((t: any) => t.is_default);
      setTemplateId(def ? def.id : templates[0].id);
    }
  }, [templates, templateId]);

  // Auto-generate invoice number
  useEffect(() => {
    if (!invoiceNumber) {
      const num = `INV-${Date.now().toString().slice(-6)}`;
      setInvoiceNumber(num);
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

  // Calculations
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

        // If product selected, fill in defaults
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

        // If tax changed, update rate
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

  // Visible columns from template
  const visibleColumns = useMemo(() => {
    if (!tableSettings?.columns) {
      return ["description", "qty", "rate", "tax", "discount", "amount"];
    }
    return tableSettings.columns.filter((c) => c.visible).map((c) => c.key);
  }, [tableSettings]);

  // Save as draft
  const handleSave = async (shouldPost = false) => {
    if (!customerId) return toast.error("Please select a customer");
    if (!invoiceNumber) return toast.error("Please enter an invoice number");
    if (lines.every((l) => l.rate === 0)) return toast.error("Add at least one line item");

    const setter = shouldPost ? setPosting : setSaving;
    setter(true);

    try {
      // 1. Create invoice
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
          template_id: templateId || null,
          notes: notes || null,
          terms: terms || null,
          status: shouldPost ? "sent" : "draft",
          ar_account_id: arAccount?.id || null,
          revenue_account_id: revenueAccount?.id || null,
        } as any)
        .select()
        .single();

      if (invErr) throw invErr;

      // 2. Save line items
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

      // 3. Post journal entries if requested
      if (shouldPost && arAccount && revenueAccount) {
        const journalLines: any[] = [];
        const subledgerEntries: any[] = [];

        // Dr Accounts Receivable (total including tax)
        journalLines.push({
          account_id: arAccount.id,
          debit: total,
          credit: 0,
          customer_id: customerId,
        });

        // Cr Revenue (subtotal - after discount)
        journalLines.push({
          account_id: revenueAccount.id,
          debit: 0,
          credit: subtotal,
        });

        // Cr Tax Payable (if tax)
        if (totalTax > 0 && taxPayableAccount) {
          journalLines.push({
            account_id: taxPayableAccount.id,
            debit: 0,
            credit: totalTax,
          });
        }

        // Dr Discount Allowed (if discount, adjust AR and add discount debit)
        if (totalDiscount > 0 && discountAccount) {
          // Adjust: AR should be total (after discount already applied in subtotal calc)
          // subtotal already has discount subtracted per line
          // The gross revenue is subtotal + totalDiscount
          // So: Dr AR = total, Dr Discount = totalDiscount, Cr Revenue = subtotal + totalDiscount
          journalLines[1].credit = subtotal + totalDiscount; // gross revenue
          journalLines[0].debit = total; // net AR (subtotal + tax = total)
          journalLines.push({
            account_id: discountAccount.id,
            debit: totalDiscount,
            credit: 0,
          });
        }

        // AR subledger
        subledgerEntries.push({
          type: "ar",
          entity_id: customerId,
          document_type: "invoice",
          document_id: invoice.id,
          debit: journalLines[0].debit,
          credit: 0,
          invoice_no: invoiceNumber,
          due_date: dueDate || null,
        });

        await post({
          tenant_id: appUser?.tenant_id!,
          entry_date: issueDate,
          description: `Invoice ${invoiceNumber}`,
          source_type: "invoice",
          source_id: invoice.id,
          reference: invoiceNumber,
          lines: journalLines,
          subledger_entries: subledgerEntries,
        });

        // Update invoice with journal link
        // (posting engine returns journal_entry_id but we need to update invoice)
      }

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(shouldPost ? "Invoice posted successfully" : "Invoice saved as draft");
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
            <p className="text-sm text-muted-foreground">Create a new invoice from template</p>
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

      {/* Template Selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <Label className="whitespace-nowrap">Invoice Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select template..." />
              </SelectTrigger>
              <SelectContent>
                {templates?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.template_name} {t.is_default ? "(Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!templates?.length && (
              <p className="text-sm text-muted-foreground">
                No templates found.{" "}
                <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/sales/invoices/templates")}>
                  Create one
                </Button>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Dates */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Customer *</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customers?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      {visibleColumns.includes("description") && (
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product / Description</th>
                      )}
                      {visibleColumns.includes("qty") && (
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground w-20">Qty</th>
                      )}
                      {visibleColumns.includes("rate") && (
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Rate</th>
                      )}
                      {visibleColumns.includes("tax") && (
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground w-32">Tax</th>
                      )}
                      {visibleColumns.includes("discount") && (
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground w-24">Discount</th>
                      )}
                      {visibleColumns.includes("amount") && (
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Amount</th>
                      )}
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-t border-border">
                        {visibleColumns.includes("description") && (
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
                        )}
                        {visibleColumns.includes("qty") && (
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              className="h-8 text-xs text-center"
                              value={line.qty || ""}
                              onChange={(e) => updateLine(line.id, "qty", Number(e.target.value))}
                              min={1}
                            />
                          </td>
                        )}
                        {visibleColumns.includes("rate") && (
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              className="h-8 text-xs text-right"
                              value={line.rate || ""}
                              onChange={(e) => updateLine(line.id, "rate", Number(e.target.value))}
                              min={0}
                            />
                          </td>
                        )}
                        {visibleColumns.includes("tax") && (
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
                        )}
                        {visibleColumns.includes("discount") && (
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              className="h-8 text-xs text-right"
                              value={line.discount || ""}
                              onChange={(e) => updateLine(line.id, "discount", Number(e.target.value))}
                              min={0}
                            />
                          </td>
                        )}
                        {visibleColumns.includes("amount") && (
                          <td className="px-3 py-2 text-right font-medium text-foreground">
                            {formatCurrency(line.amount)}
                          </td>
                        )}
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

        {/* Sidebar - Totals & Preview */}
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

          {/* Template Info */}
          {selectedTemplate && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Template</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium">{(selectedTemplate as any).template_name}</p>
                <p className="text-xs text-muted-foreground capitalize">{(selectedTemplate as any).template_type} template</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
