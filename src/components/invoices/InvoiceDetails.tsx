import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePaymentsReceived, useRecordPayment, useUpdateInvoice } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { DollarSign, Plus, Clock, CheckCircle2 } from "lucide-react";

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

  const { data: payments, isLoading } = usePaymentsReceived(invoice?.id);
  const recordPayment = useRecordPayment();
  const updateInvoice = useUpdateInvoice();

  if (!invoice) return null;

  const totalAmount = Number(invoice.total_amount);
  const amountPaid = invoice.amount_paid ?? 0;
  const balanceDue = invoice.balance_due ?? totalAmount;
  const paidPercent = totalAmount > 0 ? Math.min((amountPaid / totalAmount) * 100, 100) : 0;

  const effectiveStatus = balanceDue <= 0 ? "paid" : amountPaid > 0 ? "partial" : invoice.status;

  const handleRecordPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;

    await recordPayment.mutateAsync({
      invoice_id: invoice.id,
      amount,
      payment_method: payMethod,
      reference: payReference || undefined,
      payment_date: new Date(payDate).toISOString(),
    });

    // Auto-update invoice status
    const newPaid = amountPaid + amount;
    if (newPaid >= totalAmount) {
      updateInvoice.mutate({ id: invoice.id, status: "paid" });
    } else if (invoice.status !== "partial") {
      updateInvoice.mutate({ id: invoice.id, status: "partial" as any });
    }

    setPayAmount("");
    setPayReference("");
    setShowPayForm(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DollarSign className="w-5 h-5" />
            {invoice.invoice_number}
            <Badge className={statusColors[effectiveStatus] || statusColors.draft}>
              {effectiveStatus.toUpperCase()}
            </Badge>
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
                    disabled={!payAmount || Number(payAmount) <= 0 || recordPayment.isPending}
                  >
                    {recordPayment.isPending ? "Saving..." : "Save Payment"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Payment Activity Log */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Payment Activity Log
          </h4>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
          ) : !payments?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">No payments recorded yet.</p>
          ) : (
            <div className="space-y-0">
              {payments.map((p: any, idx: number) => {
                const isLast = idx === payments.length - 1;
                return (
                  <div key={p.id} className="flex gap-3">
                    {/* Timeline line */}
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                      </div>
                      {!isLast && <div className="w-0.5 flex-1 bg-border" />}
                    </div>
                    {/* Content */}
                    <div className={`pb-4 flex-1 ${isLast ? "" : ""}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">
                          {formatCurrency(Number(p.amount))}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {new Date(p.payment_date).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}
                        </span>
                      </div>
                      <div className="flex gap-3 mt-0.5">
                        {p.payment_method && (
                          <span className="text-xs text-muted-foreground capitalize">
                            {p.payment_method.replace("_", " ")}
                          </span>
                        )}
                        {p.reference && (
                          <span className="text-xs text-muted-foreground">
                            Ref: {p.reference}
                          </span>
                        )}
                      </div>
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
