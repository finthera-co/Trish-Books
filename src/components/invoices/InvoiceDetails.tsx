import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePaymentsReceived, useRecordPayment, useUpdateInvoice } from "@/hooks/useData";
import { useCreateCreditNoteWithGL } from "@/hooks/useARModule";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { downloadInvoicePdf } from "@/lib/invoiceDownload";
import { shareInvoiceViaWhatsApp, shareInvoiceViaGmail, type ShareInvoiceArgs } from "@/lib/invoiceShare";
import { toast } from "sonner";
import { DollarSign, Plus, Clock, CheckCircle2, Download, Tag, Percent, MessageCircle, Mail, Send } from "lucide-react";

interface Props {
  invoice: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  overdue: "bg-destructive/10 text-destructive",
  draft: "bg-muted text-muted-foreground",
};

export default function InvoiceDetails({ invoice, open, onOpenChange }: Props) {
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payReference, setPayReference] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);

  const [downloading, setDownloading] = useState(false);

  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  // After a payment is recorded we surface the option to send the invoice.
  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState<"whatsapp" | "gmail" | null>(null);
  // Hard guard against a double-click recording the same payment twice.
  const savingRef = useRef(false);

  const { data: payments, isLoading } = usePaymentsReceived(invoice?.id);
  const recordPayment = useRecordPayment();
  const updateInvoice = useUpdateInvoice();
  const createCreditNote = useCreateCreditNoteWithGL();
  const { data: settings } = useAccountSettings();
  const queryClient = useQueryClient();

  // Discounts/credits applied to this posted invoice (kept live so the dialog
  // updates the balance immediately after a discount is granted).
  const { data: creditNotes } = useQuery({
    queryKey: ["invoice_credit_notes", invoice?.id],
    enabled: !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_credit_notes")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("credit_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Customer contact details for sharing (the list query only carries the name).
  const { data: customer } = useQuery({
    queryKey: ["invoice_customer_contact", invoice?.customer_id],
    enabled: !!invoice?.customer_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("name, phone, email")
        .eq("id", invoice.customer_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!invoice) return null;

  const handleDownload = async () => {
    if (!invoice.tenant_id) return toast.error("Missing tenant for this invoice");
    setDownloading(true);
    try {
      await downloadInvoicePdf(invoice.id, invoice.tenant_id);
      toast.success("Invoice downloaded");
    } catch (e: any) {
      toast.error("Failed to download: " + (e?.message || "unknown error"));
    } finally {
      setDownloading(false);
    }
  };

  const totalAmount = Number(invoice.total_amount);
  const amountPaid = invoice.amount_paid ?? 0;
  const discountTotal = (creditNotes ?? [])
    .filter((c: any) => c.status !== "voided")
    .reduce((s: number, c: any) => s + Number(c.amount), 0);
  const balanceDue = Math.max(0, totalAmount - amountPaid - discountTotal);
  const paidPercent = totalAmount > 0 ? Math.min(((amountPaid + discountTotal) / totalAmount) * 100, 100) : 0;

  const isPosted = invoice.status !== "draft" && invoice.status !== "voided";
  const effectiveStatus = balanceDue <= 0 ? "paid" : amountPaid > 0 || discountTotal > 0 ? "partial" : invoice.status;

  const handleApplyDiscount = async () => {
    const amount = Number(discountAmount);
    if (!amount || amount <= 0) return;
    if (amount > balanceDue) {
      toast.error("Discount cannot exceed the outstanding balance");
      return;
    }
    const arAccountId = invoice.ar_account_id ?? settings?.ar_account_id;
    const revenueAccountId = invoice.revenue_account_id ?? settings?.sales_account_id;
    if (!arAccountId || !revenueAccountId) {
      toast.error("Configure AR and Sales Revenue accounts in Settings → Account Mapping first");
      return;
    }
    await createCreditNote.mutateAsync(
      {
        customer_id: invoice.customer_id,
        credit_note_number: `CN-${invoice.invoice_number}-${Date.now().toString().slice(-5)}`,
        credit_date: new Date().toISOString().slice(0, 10),
        amount,
        reason: discountReason || `Discount on invoice ${invoice.invoice_number}`,
        ar_account_id: arAccountId,
        revenue_account_id: revenueAccountId,
        invoice_id: invoice.id,
      },
      {
        onSuccess: () => {
          // refresh the in-dialog credit-note list
          // (the hook already invalidates ["invoices"] and AR queries)
          queryClient.invalidateQueries({ queryKey: ["invoice_credit_notes", invoice.id] });
          setDiscountAmount("");
          setDiscountReason("");
          setShowDiscountForm(false);
        },
      },
    );
  };

  const handleRecordPayment = async () => {
    // Guard against a rapid double-click submitting before isPending re-renders.
    if (savingRef.current) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    if (amount > balanceDue + 0.005) {
      toast.error("Payment cannot exceed the outstanding balance");
      return;
    }

    savingRef.current = true;
    try {
      await recordPayment.mutateAsync({
        invoice_id: invoice.id,
        amount,
        payment_method: payMethod,
        reference: payReference || undefined,
        payment_date: new Date(payDate).toISOString(),
      });

      // Auto-update invoice status (partial vs fully paid)
      const newPaid = amountPaid + amount;
      if (newPaid + discountTotal >= totalAmount - 0.005) {
        updateInvoice.mutate({ id: invoice.id, status: "paid" });
      } else if (invoice.status !== "partial") {
        updateInvoice.mutate({ id: invoice.id, status: "partial" as any });
      }

      setPayAmount("");
      setPayReference("");
      setShowPayForm(false);
      // Offer to send the updated invoice to the customer.
      setShowSend(true);
    } finally {
      savingRef.current = false;
    }
  };

  const handleSend = async (channel: "whatsapp" | "gmail") => {
    if (sending) return;
    if (!invoice.tenant_id) return toast.error("Missing tenant for this invoice");
    setSending(channel);
    const args: ShareInvoiceArgs = {
      invoiceId: invoice.id,
      tenantId: invoice.tenant_id,
      invoiceNumber: invoice.invoice_number,
      customerName: customer?.name ?? (invoice.customers as any)?.name,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      total: totalAmount,
      amountPaid,
      balanceDue,
    };
    try {
      const outcome = channel === "whatsapp"
        ? await shareInvoiceViaWhatsApp(args)
        : await shareInvoiceViaGmail(args);
      if (outcome === "linked") {
        toast.success("Invoice PDF downloaded — attach it to your message");
      }
    } catch (e: any) {
      toast.error("Failed to share: " + (e?.message || "unknown error"));
    } finally {
      setSending(null);
    }
  };

  // Combined, newest-first timeline of payments and discounts (credit notes).
  const activity = [
    ...((payments ?? []).map((p: any) => ({
      id: p.id,
      kind: "payment" as const,
      amount: Number(p.amount),
      date: p.payment_date,
      detail: [p.payment_method ? String(p.payment_method).replace("_", " ") : null, p.reference ? `Ref: ${p.reference}` : null]
        .filter(Boolean).join(" · "),
    }))),
    ...((creditNotes ?? []).filter((c: any) => c.status !== "voided").map((c: any) => ({
      id: c.id,
      kind: "discount" as const,
      amount: Number(c.amount),
      date: c.credit_date,
      detail: [c.reason, c.credit_note_number].filter(Boolean).join(" · "),
    }))),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setShowSend(false);
      setShowPayForm(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DollarSign className="w-5 h-5" />
            {invoice.invoice_number}
            <Badge className={statusColors[effectiveStatus] || statusColors.draft}>
              {effectiveStatus.toUpperCase()}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={handleDownload}
              disabled={downloading}
            >
              <Download className="w-4 h-4 mr-1.5" />
              {downloading ? "Preparing…" : "Download PDF"}
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Total Amount</p>
            <p className="text-lg font-semibold text-foreground">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Amount Paid</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">{formatCurrency(amountPaid)}</p>
            {discountTotal > 0 && (
              <p className="text-[11px] text-violet-600 dark:text-violet-400 mt-0.5">incl. {formatCurrency(discountTotal)} discount</p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Balance Due</p>
            <p className={`text-lg font-semibold ${balanceDue > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
              {formatCurrency(balanceDue)}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Payment Progress</span>
            <span>{paidPercent.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className="bg-primary h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${paidPercent}%` }}
            />
          </div>
        </div>

        {/* Invoice info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Customer: </span>
            <span className="text-foreground font-medium">{(invoice.customers as any)?.name || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Issue Date: </span>
            <span className="text-foreground">{invoice.issue_date}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Due Date: </span>
            <span className="text-foreground">{invoice.due_date || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Currency: </span>
            <span className="text-foreground">{invoice.currency || "LKR"}</span>
          </div>
        </div>

        {/* Record Payment Button */}
        {balanceDue > 0 && (
          <div>
            {!showPayForm ? (
              <Button onClick={() => { setShowPayForm(true); setPayAmount(String(balanceDue)); }} className="w-full">
                <Plus className="w-4 h-4" /> Record Payment
              </Button>
            ) : (
              <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
                <h4 className="text-sm font-semibold text-foreground">Record Payment</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Amount</label>
                    <input
                      type="number"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      max={balanceDue}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Date</label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Method</label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                    >
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                      <option value="online">Online</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Reference</label>
                    <input
                      type="text"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                      placeholder="Cheque #, Ref #"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowPayForm(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={handleRecordPayment}
                    disabled={
                      !payAmount ||
                      Number(payAmount) <= 0 ||
                      Number(payAmount) > balanceDue + 0.005 ||
                      recordPayment.isPending
                    }
                  >
                    {recordPayment.isPending ? "Saving..." : "Save Payment"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Apply Discount (posted invoices with an outstanding balance) */}
        {isPosted && balanceDue > 0 && (
          <div>
            {!showDiscountForm ? (
              <Button
                variant="outline"
                onClick={() => { setShowDiscountForm(true); setDiscountAmount(""); }}
                className="w-full"
              >
                <Percent className="w-4 h-4" /> Apply Discount
              </Button>
            ) : (
              <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Tag className="w-4 h-4" /> Apply Discount
                </h4>
                <p className="text-xs text-muted-foreground -mt-1">
                  Posts a credit note (Dr Sales Revenue / Cr Accounts Receivable) and reduces the balance due.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Discount Amount</label>
                    <input
                      type="number"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      max={balanceDue}
                      min={0}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Reason</label>
                    <input
                      type="text"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                      placeholder="e.g. Goodwill, early settlement"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowDiscountForm(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={handleApplyDiscount}
                    disabled={
                      !discountAmount ||
                      Number(discountAmount) <= 0 ||
                      Number(discountAmount) > balanceDue ||
                      createCreditNote.isPending
                    }
                  >
                    {createCreditNote.isPending ? "Applying..." : "Apply Discount"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Send Invoice (WhatsApp / Gmail) */}
        {invoice.status !== "voided" && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Send className="w-4 h-4" /> Send Invoice
            </h4>
            {showSend && (
              <p className="text-xs text-green-600 dark:text-green-400 -mt-1">
                Payment recorded. Send the updated invoice to {customer?.name || "the customer"}.
              </p>
            )}
            <p className="text-xs text-muted-foreground -mt-1">
              On a phone the PDF is attached automatically. On desktop the invoice PDF downloads so
              you can attach it to the prefilled message.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSend("whatsapp")}
                disabled={sending !== null}
              >
                <MessageCircle className="w-4 h-4" />
                {sending === "whatsapp" ? "Preparing…" : "WhatsApp"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSend("gmail")}
                disabled={sending !== null}
              >
                <Mail className="w-4 h-4" />
                {sending === "gmail" ? "Preparing…" : "Gmail"}
              </Button>
            </div>
            {!customer?.phone && !customer?.email && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                No phone or email on file for this customer — add one on the customer to prefill the recipient.
              </p>
            )}
          </div>
        )}

        {/* Payment & Discount Activity Log */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Activity Log
          </h4>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
          ) : !activity.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">No payments or discounts recorded yet.</p>
          ) : (
            <div className="space-y-0">
              {activity.map((a, idx) => {
                const isLast = idx === activity.length - 1;
                const isDiscount = a.kind === "discount";
                return (
                  <div key={a.id} className="flex gap-3">
                    {/* Timeline line */}
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isDiscount ? "bg-violet-100 dark:bg-violet-900/30" : "bg-primary/10"}`}>
                        {isDiscount
                          ? <Tag className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                          : <CheckCircle2 className="w-4 h-4 text-primary" />}
                      </div>
                      {!isLast && <div className="w-0.5 flex-1 bg-border" />}
                    </div>
                    {/* Content */}
                    <div className="pb-4 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">
                          {isDiscount ? "−" : ""}{formatCurrency(a.amount)}
                          {isDiscount && <span className="ml-2 text-xs font-normal text-violet-600 dark:text-violet-400">Discount</span>}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {new Date(a.date).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}
                        </span>
                      </div>
                      {a.detail && (
                        <div className="mt-0.5">
                          <span className="text-xs text-muted-foreground capitalize">{a.detail}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
