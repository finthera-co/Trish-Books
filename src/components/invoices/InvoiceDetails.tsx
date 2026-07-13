import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePaymentsReceived } from "@/hooks/useData";
import { useARAccounts, useCreateCreditNoteWithGL, useReceiveCustomerPayment } from "@/hooks/useARModule";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { downloadInvoicePdf } from "@/lib/invoiceDownload";
import { shareInvoiceViaWhatsApp, shareInvoiceViaGmail, type ShareInvoiceArgs } from "@/lib/invoiceShare";
import { useSendInvoiceEmail } from "@/hooks/useSendInvoiceEmail";
import { toast } from "sonner";
import { DollarSign, Plus, Clock, CheckCircle2, Download, Tag, Percent, MessageCircle, Mail, Send, MailCheck, ShieldCheck, Paperclip, Trash2, Upload } from "lucide-react";
import { useInvoiceAttachments, useUploadAttachment, useDeleteAttachment } from "@/hooks/useInvoiceAttachments";

interface Props {
  invoice: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  posted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
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
  const [payBankAccountId, setPayBankAccountId] = useState("");

  const [downloading, setDownloading] = useState(false);

  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  // After a payment is recorded we surface the option to send the invoice.
  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState<"whatsapp" | "gmail" | null>(null);
  // Server-side email (Resend) — recipient/subject/body are editable before send.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const sendEmail = useSendInvoiceEmail();
  // Hard guard against a double-click recording the same payment twice.
  const savingRef = useRef(false);

  const { data: payments, isLoading } = usePaymentsReceived(invoice?.id);
  const { data: attachments } = useInvoiceAttachments(invoice?.id);
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();
  const recordPayment = useReceiveCustomerPayment();
  const { data: arAccounts } = useARAccounts();
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

  // Approval trail — submitted / approved / rejected events with actor names.
  const { data: approvalHistory } = useQuery({
    queryKey: ["invoice_approval_history", invoice?.id],
    enabled: !!invoice?.id && !!invoice?.approval_status && invoice.approval_status !== "not_required",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_approval_history" as any)
        .select("id, action, note, amount_base, created_at, users:actor_id(first_name, last_name, email)")
        .eq("invoice_id", invoice.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
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

  const cur = invoice.currency || "LKR";
  const totalAmount = Number(invoice.total_amount);
  const amountPaid = invoice.amount_paid ?? 0;
  const discountTotal = (creditNotes ?? [])
    .filter((c: any) => c.status !== "voided")
    .reduce((s: number, c: any) => s + Number(c.amount), 0);
  const balanceDue = Math.max(0, totalAmount - amountPaid - discountTotal);
  const paidPercent = totalAmount > 0 ? Math.min(((amountPaid + discountTotal) / totalAmount) * 100, 100) : 0;

  const isPosted = invoice.status !== "draft" && invoice.status !== "voided";

  // Live overdue derivation (matches the list + due-reminder alerts): a posted,
  // still-owing invoice past its due date.
  const todayIso = new Date().toISOString().slice(0, 10);
  const isOverdue = isPosted && balanceDue > 0 && !!invoice.due_date && invoice.due_date < todayIso;

  const effectiveStatus = invoice.status === "draft"
    ? "draft"
    : balanceDue <= 0
      ? "paid"
      : isOverdue
        ? "overdue"
        : amountPaid > 0 || discountTotal > 0
          ? "partial"
          : invoice.status === "sent" ? "posted" : invoice.status;

  // Short human hint shown beside the due date for owing invoices.
  const dueHint = (): { text: string; overdue: boolean } | null => {
    if (!invoice.due_date || balanceDue <= 0 || !isPosted) return null;
    const days = Math.round(
      (new Date(invoice.due_date + "T00:00:00").getTime() - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000
    );
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true };
    if (days === 0) return { text: "due today", overdue: true };
    if (days <= 7) return { text: `in ${days}d`, overdue: false };
    return null;
  };

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
    // (The server also carries a request_id idempotency key as the hard guard.)
    if (savingRef.current) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    if (amount > balanceDue + 0.005) {
      toast.error("Payment cannot exceed the outstanding balance");
      return;
    }
    const bankId = payBankAccountId || arAccounts?.bankAccounts?.[0]?.id;
    if (!bankId) {
      toast.error("No bank/cash account found — create one in the chart of accounts first");
      return;
    }

    savingRef.current = true;
    try {
      // Posted server-side: GL, allocation, AR sub-ledgers and outstanding all
      // move together (paid/partial status is derived from the balance).
      await recordPayment.mutateAsync({
        customer_id: invoice.customer_id,
        payment_date: payDate,
        payment_method: payMethod,
        reference: payReference || undefined,
        bank_account_id: bankId,
        allocations: [{ invoice_id: invoice.id, amount }],
      });

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

  const openEmailForm = () => {
    setEmailTo(customer?.email ?? (invoice.customers as any)?.email ?? "");
    setEmailSubject(`Invoice ${invoice.invoice_number}`);
    setEmailMessage(
      `Hi ${customer?.name ?? (invoice.customers as any)?.name ?? "there"},\n\n` +
        `Please find invoice ${invoice.invoice_number} attached.\n` +
        `Total: ${formatCurrency(totalAmount, cur)}\nBalance due: ${formatCurrency(balanceDue, cur)}\n\nThank you.`,
    );
    setShowEmailForm(true);
  };

  const handleSendEmail = async () => {
    if (!invoice.tenant_id) return toast.error("Missing tenant for this invoice");
    if (!emailTo.trim()) return toast.error("Enter a recipient email");
    try {
      await sendEmail.mutateAsync({
        invoiceId: invoice.id,
        tenantId: invoice.tenant_id,
        invoiceNumber: invoice.invoice_number,
        recipient: emailTo.trim(),
        subject: emailSubject.trim() || undefined,
        message: emailMessage.trim() || undefined,
      });
      setShowEmailForm(false);
    } catch {
      // toast handled by mutation
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
            <p className="text-lg font-semibold text-foreground">{formatCurrency(totalAmount, cur)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Amount Paid</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">{formatCurrency(amountPaid, cur)}</p>
            {discountTotal > 0 && (
              <p className="text-[11px] text-violet-600 dark:text-violet-400 mt-0.5">incl. {formatCurrency(discountTotal, cur)} discount</p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Balance Due</p>
            <p className={`text-lg font-semibold ${balanceDue > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
              {formatCurrency(balanceDue, cur)}
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
            {(() => {
              const hint = dueHint();
              if (!hint) return null;
              return (
                <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${hint.overdue ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                  {hint.text}
                </span>
              );
            })()}
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
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground">Deposit to</label>
                    <select
                      value={payBankAccountId || arAccounts?.bankAccounts?.[0]?.id || ""}
                      onChange={(e) => setPayBankAccountId(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                    >
                      {(arAccounts?.bankAccounts || []).map((a: any) => (
                        <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>
                      ))}
                    </select>
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
            {/* Email status badge */}
            {invoice.email_status && (
              <p className="-mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <MailCheck className="w-3.5 h-3.5" />
                {invoice.email_status === "opened" ? "Opened by recipient" : invoice.email_status === "failed" ? "Last email failed" : "Emailed"}
                {invoice.last_emailed_at ? ` · ${new Date(invoice.last_emailed_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}
                {invoice.email_recipient ? ` · ${invoice.email_recipient}` : ""}
              </p>
            )}

            {/* Real server-side email (Resend) with the PDF attached. */}
            {!showEmailForm ? (
              <Button variant="default" size="sm" className="w-full" onClick={openEmailForm}>
                <Mail className="w-4 h-4" /> Email invoice
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-background p-3">
                <div>
                  <label className="text-xs text-muted-foreground">To</label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="customer@example.com"
                    className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Message</label>
                  <textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={4}
                    className="mt-1 w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowEmailForm(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSendEmail} disabled={sendEmail.isPending}>
                    {sendEmail.isPending ? "Sending…" : "Send email"}
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Or share manually — on a phone the PDF attaches automatically; on desktop it downloads
              so you can attach it to the prefilled message.
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

        {/* Approval trail */}
        {invoice.approval_status && invoice.approval_status !== "not_required" && (
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Approval
              </h4>
              {invoice.approval_status === "pending" && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  {invoice.approvals_count ?? 0} of {invoice.required_approvals || 1} approvals
                </Badge>
              )}
              {invoice.approval_status === "approved" && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Approved</Badge>
              )}
              {invoice.approval_status === "rejected" && (
                <Badge className="bg-destructive/10 text-destructive">Rejected</Badge>
              )}
            </div>
            {(approvalHistory ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Awaiting the first approval decision.</p>
            ) : (
              <div className="space-y-2">
                {(approvalHistory ?? []).map((h: any) => {
                  const u = h.users;
                  const who = u ? ([u.first_name, u.last_name].filter(Boolean).join(" ") || u.email) : "System";
                  const color = h.action === "approved" ? "text-green-600 dark:text-green-400"
                    : h.action === "rejected" ? "text-destructive" : "text-muted-foreground";
                  return (
                    <div key={h.id} className="flex items-start justify-between gap-3 text-xs">
                      <div>
                        <span className={`font-medium capitalize ${color}`}>{h.action}</span>
                        <span className="text-muted-foreground"> · {who}</span>
                        {h.note && <p className="text-muted-foreground mt-0.5">{h.note}</p>}
                      </div>
                      <span className="text-muted-foreground shrink-0">
                        {new Date(h.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Attachments */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Paperclip className="w-4 h-4" /> Attachments
            </h4>
            <label className="cursor-pointer">
              <input type="file" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment.mutate({ invoiceId: invoice.id, file: f }); e.currentTarget.value = ""; }} />
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted">
                <Upload className="w-3.5 h-3.5" /> {uploadAttachment.isPending ? "Uploading…" : "Upload"}
              </span>
            </label>
          </div>
          {(attachments ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No files attached. Add a PO copy, signed delivery note, etc. (max 10 MB).</p>
          ) : (
            <div className="space-y-1.5">
              {(attachments ?? []).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm rounded-md border border-border px-2.5 py-1.5">
                  <a href={a.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 text-primary hover:underline">
                    <Paperclip className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{a.file_name}</span>
                  </a>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.size_bytes != null && <span className="text-[11px] text-muted-foreground">{(a.size_bytes / 1024).toFixed(0)} KB</span>}
                    <button onClick={() => deleteAttachment.mutate({ ...a } as any)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
                          {isDiscount ? "−" : ""}{formatCurrency(a.amount, cur)}
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
