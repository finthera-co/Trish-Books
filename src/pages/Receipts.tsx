import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Receipt as ReceiptIcon, Printer, Download, Lock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useInvoices, useCustomers, usePaymentsReceived } from "@/hooks/useData";
import { useInvoiceReceipt, useIssueInvoiceReceipt } from "@/hooks/useInvoiceReceipts";
import ReceiptDocument, { balanceAfterReceipt, type ReceiptModel } from "@/components/receipts/ReceiptDocument";
import { downloadReceiptPdf, printReceiptPdf } from "@/lib/receiptPdf";
import { formatCurrency } from "@/lib/currency";
import { formatInvoiceDate } from "@/lib/format";

const today = () => new Date().toISOString().split("T")[0];

export default function Receipts() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const [params] = useSearchParams();

  const { data: invoices } = useInvoices();
  const { data: customers } = useCustomers();

  const [invoiceId, setInvoiceId] = useState<string>(params.get("invoice_id") || "");
  const { data: payments } = usePaymentsReceived(invoiceId || undefined);
  // The stored receipt, if this invoice has already been receipted. Its
  // existence locks the form: one receipt per invoice, and it is the document
  // whose number the customer already holds.
  const { data: issued, isLoading: loadingIssued } = useInvoiceReceipt(invoiceId || null);
  const issueReceipt = useIssueInvoiceReceipt();

  const [form, setForm] = useState<ReceiptModel>({
    receiptNumber: "",
    receiptDate: today(),
    receivedFrom: "",
    customerAddress: "",
    invoiceNumber: "",
    amount: 0,
    paymentMethod: "",
    reference: "",
    invoiceTotal: null,
    balanceDue: null,
    notes: "",
    currency: "LKR",
  });
  // What the invoice had already settled BEFORE this receipt (earlier payments
  // and credit notes). Held outside the document model — it isn't printed, it
  // only lets the balance track the amount as the user edits it.
  const [settledBefore, setSettledBefore] = useState(0);

  const { data: company } = useQuery({
    queryKey: ["company_hdr", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data } = await supabase.from("tenants")
        .select("company_name, address, phone, tax_id, logo_url").eq("id", appUser!.tenant_id).maybeSingle();
      return data;
    },
  });

  const selectedInvoice = useMemo(
    () => (invoices || []).find((i: any) => i.id === invoiceId),
    [invoices, invoiceId],
  );

  const outstanding = Number((selectedInvoice as any)?.balance_due ?? 0);
  const settled = !!selectedInvoice && outstanding <= 0.005;
  const isDraft = (selectedInvoice as any)?.status === "draft";
  const isVoided = (selectedInvoice as any)?.status === "voided";
  const locked = !!issued;

  // Auto-fill the receipt from the chosen invoice + its latest payment. Once a
  // receipt has been issued the STORED document wins — what the customer holds
  // must not drift as later activity lands on the invoice.
  useEffect(() => {
    if (!selectedInvoice) return;
    const inv = selectedInvoice as any;
    const cust = (customers || []).find((c: any) => c.id === inv.customer_id) as any;
    const invoiceTotal = Number(inv.total_amount) || 0;

    if (issued) {
      setSettledBefore(Math.max(0, invoiceTotal - Number(issued.amount)));
      setForm({
        receiptNumber: issued.receipt_number,
        receiptDate: String(issued.receipt_date).slice(0, 10),
        receivedFrom: issued.received_from || inv.customers?.name || cust?.name || "",
        customerAddress: issued.customer_address || cust?.address || "",
        invoiceNumber: inv.invoice_number || "",
        amount: Number(issued.amount),
        paymentMethod: issued.payment_method || "",
        reference: issued.reference || "",
        invoiceTotal,
        balanceDue: null,
        notes: issued.notes || "",
        currency: issued.currency || inv.currency || "LKR",
      });
      return;
    }

    const latest = (payments || [])[0] as any; // ordered newest first
    // A receipt is only issuable on a settled invoice, so it acknowledges the
    // whole invoice; the latest payment supplies the method/reference detail.
    setSettledBefore(0);
    setForm((f) => ({
      ...f,
      receiptNumber: "", // assigned by the server at issue time
      receivedFrom: inv.customers?.name || cust?.name || "",
      customerAddress: cust?.address || "",
      invoiceNumber: inv.invoice_number || "",
      amount: invoiceTotal,
      paymentMethod: latest?.payment_method || "",
      reference: latest?.reference || "",
      receiptDate: latest?.payment_date ? String(latest.payment_date).slice(0, 10) : today(),
      invoiceTotal,
      currency: inv.currency || "LKR",
    }));
  }, [selectedInvoice, payments, customers, issued]);

  const set = (patch: Partial<ReceiptModel>) => setForm((f) => ({ ...f, ...patch }));

  // The document that gets previewed, printed and downloaded. The balance is
  // always derived — invoice total less everything settled including this
  // receipt — so editing the amount can never leave the two contradicting.
  const receipt: ReceiptModel = useMemo(() => ({
    ...form,
    balanceDue: balanceAfterReceipt(form.invoiceTotal, settledBefore, form.amount),
  }), [form, settledBefore]);

  const handleIssue = async () => {
    if (!invoiceId) return;
    await issueReceipt.mutateAsync({
      invoiceId,
      receiptDate: form.receiptDate || undefined,
      paymentMethod: form.paymentMethod,
      reference: form.reference,
      notes: form.notes,
      receivedFrom: form.receivedFrom,
      customerAddress: form.customerAddress,
    });
  };

  // Why the Issue button is unavailable, in the user's terms. Null = go ahead.
  const blockedReason =
    !invoiceId ? "Pick an invoice first"
    : isDraft ? "Post the invoice before issuing a receipt"
    : isVoided ? "This invoice has been voided"
    : !settled ? `${formatCurrency(outstanding, form.currency)} still outstanding — a receipt is issued only when the invoice is paid in full`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ReceiptIcon className="w-6 h-6 text-primary" /> Receipt Generator</h1>
          <p className="text-sm text-muted-foreground">One numbered receipt per invoice — issuing it stamps the invoice PAID</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Form */}
        <Card className="print:hidden">
          <CardHeader><CardTitle className="text-base">Receipt details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Invoice</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId}>
                <SelectTrigger><SelectValue placeholder="Select an invoice to auto-fill" /></SelectTrigger>
                <SelectContent>
                  {(invoices || []).map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.invoice_number} — {(i.customers as any)?.name || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {locked
                  ? "This receipt has been issued — the fields below are the document of record."
                  : "Every field below is prefilled and still editable until you issue the receipt."}
              </p>
            </div>

            {/* Issue state: the one action that turns this preview into a document */}
            {invoiceId && !loadingIssued && (
              locked ? (
                <div className="flex items-start gap-2 rounded-lg border border-green-600/30 bg-green-600/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Receipt <span className="font-mono font-semibold">{issued!.receipt_number}</span> was issued on{" "}
                    {formatInvoiceDate(issued!.receipt_date)}. An invoice can carry only one receipt, so this one cannot
                    be replaced — the invoice document now shows the PAID stamp.
                  </span>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {blockedReason ?? "Issuing assigns the official receipt number and stamps the invoice PAID. This cannot be undone."}
                  </p>
                  <Button className="w-full" onClick={handleIssue} disabled={!!blockedReason || issueReceipt.isPending}>
                    <ReceiptIcon className="mr-1.5 h-4 w-4" />
                    {issueReceipt.isPending ? "Issuing…" : "Issue receipt"}
                  </Button>
                </div>
              )
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Receipt #</Label>
                <Input
                  value={form.receiptNumber}
                  readOnly
                  placeholder="Assigned when issued"
                  className="font-mono"
                />
              </div>
              <div>
                <Label>Receipt date</Label>
                <Input type="date" value={form.receiptDate} disabled={locked} onChange={(e) => set({ receiptDate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Received from</Label>
              <Input value={form.receivedFrom} disabled={locked} onChange={(e) => set({ receivedFrom: e.target.value })} placeholder="Customer name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount received</Label>
                {/* Always the full invoice total — a receipt settles the invoice. */}
                <Input value={form.amount ? formatCurrency(form.amount, form.currency) : ""} readOnly className="font-mono" />
              </div>
              <div>
                <Label>Payment method</Label>
                <Select value={form.paymentMethod || ""} disabled={locked} onValueChange={(v) => set({ paymentMethod: v })}>
                  <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Invoice #</Label><Input value={form.invoiceNumber || ""} readOnly className="font-mono" /></div>
              <div><Label>Reference</Label><Input value={form.reference || ""} disabled={locked} onChange={(e) => set({ reference: e.target.value })} placeholder="Cheque #, txn ref" /></div>
            </div>
            <div>
              <Label>Notes</Label>
              <textarea rows={2} value={form.notes || ""} disabled={locked} onChange={(e) => set({ notes: e.target.value })}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground disabled:opacity-60"
                placeholder="Optional note on the receipt" />
            </div>
          </CardContent>
        </Card>

        {/* Live preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2 print:hidden">
            {!locked && (
              <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Draft preview — not yet a numbered receipt
              </span>
            )}
            <Button
              variant="outline"
              disabled={!locked}
              onClick={async () => { try { await printReceiptPdf(receipt, company); } catch (e: any) { toast.error(e?.message || "Print failed"); } }}
            >
              <Printer className="w-4 h-4 mr-1.5" /> Print
            </Button>
            <Button
              disabled={!locked}
              onClick={async () => { try { await downloadReceiptPdf(receipt, company); toast.success("Receipt downloaded"); } catch (e: any) { toast.error(e?.message || "Download failed"); } }}
            >
              <Download className="w-4 h-4 mr-1.5" /> Download PDF
            </Button>
          </div>
          <div className="rounded border border-border overflow-hidden">
            <ReceiptDocument model={receipt} company={company} />
          </div>
        </div>
      </div>
    </div>
  );
}
