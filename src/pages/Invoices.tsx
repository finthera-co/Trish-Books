import { Plus, Search, MoreHorizontal, Eye, Send, Ban, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useInvoices, useUpdateInvoice, useAccounts } from "@/hooks/useData";
import { usePostInvoice } from "@/hooks/useAccountSettings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/currency";
import InvoiceDetails from "@/components/invoices/InvoiceDetails";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoiceDownload";

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  overdue: "bg-destructive/10 text-destructive",
  draft: "bg-muted text-muted-foreground",
  voided: "bg-destructive/10 text-destructive line-through",
};

export default function Invoices() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [voidDialogInvoice, setVoidDialogInvoice] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [processing, setProcessing] = useState(false);

  const { data: invoices, isLoading } = useInvoices();
  const { data: accounts } = useAccounts();
  const updateInvoice = useUpdateInvoice();
  const { canEdit: canEditSales } = useMyPermissions();

  const filtered = invoices?.filter((i) =>
    i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    (i.customers as any)?.name?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const getEffectiveStatus = (inv: any) => {
    if (inv.status === "voided") return "voided";
    if (inv.balance_due <= 0) return "paid";
    if (inv.amount_paid > 0) return "partial";
    return inv.status;
  };

  const postInvoice = usePostInvoice();

  // Post a draft invoice via edge function (atomic, idempotent, validated)
  const handlePostDraft = async (inv: any) => {
    setProcessing(true);
    try {
      await postInvoice.mutateAsync({ invoice_id: inv.id, action: "post" });
    } catch (e) {
      // toast handled by mutation
    } finally {
      setProcessing(false);
    }
  };

  // Void a posted invoice via edge function (creates reversal journal)
  const handleVoidInvoice = async () => {
    if (!voidDialogInvoice) return;
    setProcessing(true);
    try {
      await postInvoice.mutateAsync({ invoice_id: voidDialogInvoice.id, action: "void" });
      setVoidDialogInvoice(null);
      setVoidReason("");
    } catch (e) {
      // toast handled by mutation
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async (inv: any) => {
    if (!appUser?.tenant_id) return;
    setProcessing(true);
    try {
      await downloadInvoicePdf(inv.id, appUser.tenant_id);
      toast.success("Invoice downloaded");
    } catch (e: any) {
      toast.error("Failed to download: " + (e?.message || "unknown error"));
    } finally {
      setProcessing(false);
    }
  };
  const stats = {
    outstanding: invoices?.filter(i => getEffectiveStatus(i) === "sent" || getEffectiveStatus(i) === "partial")
      .reduce((s, i) => s + Number(i.balance_due), 0) || 0,
    paid: invoices?.filter(i => getEffectiveStatus(i) === "paid")
      .reduce((s, i) => s + Number(i.total_amount), 0) || 0,
    overdue: invoices?.filter(i => i.status === "overdue")
      .reduce((s, i) => s + Number(i.balance_due), 0) || 0,
    partial: invoices?.filter(i => getEffectiveStatus(i) === "partial")
      .reduce((s, i) => s + Number(i.amount_paid), 0) || 0,
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-description">Create and manage customer invoices with automatic journal posting</p>
        </div>
        {canEditSales("sales") && (
          <Button onClick={() => navigate("/sales/invoices/new")}>
            <Plus className="w-4 h-4" />New Invoice
          </Button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Outstanding Balance</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.outstanding)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Fully Paid</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.paid)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Overdue</p><p className="text-xl font-semibold text-destructive mt-1">{formatCurrency(stats.overdue)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Partial Payments</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.partial)}</p></div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No invoices found</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Invoice</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Due Date</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Paid</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Balance</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const status = getEffectiveStatus(inv);
                  const isDraft = inv.status === "draft";
                  const isVoided = inv.status === "voided";
                  const isPosted = inv.status === "sent" || inv.status === "paid" || inv.status === "partial" || inv.status === "overdue";
                  return (
                    <tr key={inv.id} className={`border-t border-border hover:bg-muted/30 transition-colors ${isVoided ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 font-medium text-foreground">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-muted-foreground">{(inv.customers as any)?.name || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.issue_date}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.due_date || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || ""}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">{formatCurrency(Number(inv.total_amount))}</td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {inv.amount_paid > 0 ? formatCurrency(inv.amount_paid) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${inv.balance_due > 0 ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(inv.balance_due)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedInvoice(inv); setDetailsOpen(true); }}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {isDraft && (
                            <Button variant="ghost" size="sm" title="Post Invoice" onClick={() => handlePostDraft(inv)} disabled={processing}>
                              <Send className="w-4 h-4 text-primary" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              {isDraft && (
                                <DropdownMenuItem onClick={() => handlePostDraft(inv)} disabled={processing}>
                                  <Send className="w-4 h-4 mr-2" /> Post & Create Journal
                                </DropdownMenuItem>
                              )}
                              {isPosted && !isVoided && (
                                <>
                                  <DropdownMenuItem onClick={() => navigate(`/accounting/receive-payment?invoice_id=${inv.id}`)}>
                                    Receive Payment
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive" onClick={() => { setVoidDialogInvoice(inv); setVoidReason(""); }}>
                                    <Ban className="w-4 h-4 mr-2" /> Void Invoice
                                  </DropdownMenuItem>
                                </>
                              )}
                              {!isPosted && !isVoided && (
                                <>
                                  <DropdownMenuItem onClick={() => updateInvoice.mutate({ id: inv.id, status: "sent" })}>Mark as Sent</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InvoiceDetails invoice={selectedInvoice} open={detailsOpen} onOpenChange={setDetailsOpen} />

      {/* Void Invoice Dialog */}
      <Dialog open={!!voidDialogInvoice} onOpenChange={(v) => { if (!v) { setVoidDialogInvoice(null); setVoidReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="w-5 h-5" /> Void Invoice
            </DialogTitle>
            <DialogDescription>
              {voidDialogInvoice?.invoice_number} — This will create a reversing journal entry and mark the invoice as voided.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-destructive mb-1">This action will:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                <li>Create a reversing journal entry (opposite debits/credits)</li>
                <li>Mark the original journal as voided</li>
                <li>Mark the invoice as voided</li>
                <li>Update the customer ledger balance</li>
              </ul>
            </div>
            <div>
              <label className="text-sm font-medium">Reason for voiding <span className="text-destructive">*</span></label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[80px]"
                placeholder="e.g. Customer returned goods, incorrect amount..."
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setVoidDialogInvoice(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={handleVoidInvoice} disabled={!voidReason.trim() || processing}>
                {processing ? "Voiding..." : "Void Invoice"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
