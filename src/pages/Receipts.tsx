import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Receipt as ReceiptIcon, Printer, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useInvoices, useCustomers, usePaymentsReceived } from "@/hooks/useData";
import ReceiptDocument, { balanceAfterReceipt, type ReceiptModel } from "@/components/receipts/ReceiptDocument";
import { downloadReceiptPdf, printReceiptPdf } from "@/lib/receiptPdf";

const today = () => new Date().toISOString().split("T")[0];
const genReceiptNo = () =>
  `RCP-${today().replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;

export default function Receipts() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const [params] = useSearchParams();

  const { data: invoices } = useInvoices();
  const { data: customers } = useCustomers();

  const [invoiceId, setInvoiceId] = useState<string>(params.get("invoice_id") || "");
  const { data: payments } = usePaymentsReceived(invoiceId || undefined);

  const [form, setForm] = useState<ReceiptModel>({
    receiptNumber: genReceiptNo(),
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

  // Auto-fill the receipt from the chosen invoice + its latest payment.
  useEffect(() => {
    if (!selectedInvoice) return;
    const inv = selectedInvoice as any;
    const cust = (customers || []).find((c: any) => c.id === inv.customer_id) as any;
    const latest = (payments || [])[0] as any; // ordered newest first
    const invoiceTotal = Number(inv.total_amount) || 0;
    // balance_due already nets off every recorded payment and credit note.
    const outstanding = Number(inv.balance_due) || 0;
    // Receipting a payment that is already recorded? Then it sits inside the
    // settled figure and must come back out, or it would be counted twice.
    const amount = latest ? Number(latest.amount) : outstanding;
    setSettledBefore(Math.max(0, invoiceTotal - outstanding - (latest ? amount : 0)));
    setForm((f) => ({
      ...f,
      receivedFrom: inv.customers?.name || cust?.name || "",
      customerAddress: cust?.address || "",
      invoiceNumber: inv.invoice_number || "",
      amount,
      paymentMethod: latest?.payment_method || "",
      reference: latest?.reference || "",
      receiptDate: latest?.payment_date ? String(latest.payment_date).slice(0, 10) : today(),
      invoiceTotal,
      currency: inv.currency || "LKR",
    }));
  }, [selectedInvoice, payments, customers]);

  const set = (patch: Partial<ReceiptModel>) => setForm((f) => ({ ...f, ...patch }));

  // The document that gets previewed, printed and downloaded. The balance is
  // always derived — invoice total less everything settled including this
  // receipt — so editing the amount can never leave the two contradicting.
  const receipt: ReceiptModel = useMemo(() => ({
    ...form,
    balanceDue: balanceAfterReceipt(form.invoiceTotal, settledBefore, form.amount),
  }), [form, settledBefore]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ReceiptIcon className="w-6 h-6 text-primary" /> Receipt Generator</h1>
          <p className="text-sm text-muted-foreground">Pick an invoice — its customer, amount, and payment details fill in automatically</p>
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
              <p className="text-[11px] text-muted-foreground mt-1">Every field below is prefilled and still editable.</p>
            </div>

            {/* Payment picker when the invoice has more than one payment */}
            {(payments || []).length > 1 && (
              <div>
                <Label>Payment</Label>
                <Select
                  value={form.reference || ""}
                  onValueChange={(v) => {
                    const p = (payments || []).find((x: any) => (x.reference || x.id) === v) as any;
                    if (!p) return;
                    // Switching to a different recorded payment moves which one
                    // this receipt is for — everything else stays "settled before".
                    const inv = selectedInvoice as any;
                    const total = Number(inv?.total_amount) || 0;
                    const outstanding = Number(inv?.balance_due) || 0;
                    setSettledBefore(Math.max(0, total - outstanding - Number(p.amount)));
                    set({ amount: Number(p.amount), paymentMethod: p.payment_method, reference: p.reference || "", receiptDate: String(p.payment_date).slice(0, 10) });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Choose which payment" /></SelectTrigger>
                  <SelectContent>
                    {(payments || []).map((p: any) => (
                      <SelectItem key={p.id} value={p.reference || p.id}>
                        {String(p.payment_date).slice(0, 10)} · {Number(p.amount).toLocaleString()} · {p.payment_method || "—"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Receipt #</Label><Input value={form.receiptNumber} onChange={(e) => set({ receiptNumber: e.target.value })} className="font-mono" /></div>
              <div><Label>Receipt date</Label><Input type="date" value={form.receiptDate} onChange={(e) => set({ receiptDate: e.target.value })} /></div>
            </div>
            <div>
              <Label>Received from</Label>
              <Input value={form.receivedFrom} onChange={(e) => set({ receivedFrom: e.target.value })} placeholder="Customer name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Amount received</Label><Input type="number" value={form.amount || ""} onChange={(e) => set({ amount: Number(e.target.value) })} className="font-mono" /></div>
              <div>
                <Label>Payment method</Label>
                <Select value={form.paymentMethod || ""} onValueChange={(v) => set({ paymentMethod: v })}>
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
              <div><Label>Invoice #</Label><Input value={form.invoiceNumber || ""} onChange={(e) => set({ invoiceNumber: e.target.value })} className="font-mono" /></div>
              <div><Label>Reference</Label><Input value={form.reference || ""} onChange={(e) => set({ reference: e.target.value })} placeholder="Cheque #, txn ref" /></div>
            </div>
            <div>
              <Label>Notes</Label>
              <textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground"
                placeholder="Optional note on the receipt" />
            </div>
          </CardContent>
        </Card>

        {/* Live preview */}
        <div className="space-y-3">
          <div className="flex justify-end gap-2 print:hidden">
            <Button variant="outline" onClick={async () => { try { await printReceiptPdf(receipt, company); } catch (e: any) { toast.error(e?.message || "Print failed"); } }}>
              <Printer className="w-4 h-4 mr-1.5" /> Print
            </Button>
            <Button onClick={async () => { try { await downloadReceiptPdf(receipt, company); toast.success("Receipt downloaded"); } catch (e: any) { toast.error(e?.message || "Download failed"); } }}>
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
