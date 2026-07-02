import { Plus, Search, MoreHorizontal, Eye, Send, Ban, Download, MessageCircle, Mail, FileText, Pencil, Trash2, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useInvoices, useUpdateInvoice, useAccounts, useDeleteInvoice, useApproveInvoice } from "@/hooks/useData";
import { usePostInvoice } from "@/hooks/useAccountSettings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import JournalPreview, { type JournalPreviewLine } from "@/components/accounting/JournalPreview";
import { useAccountSettings, useUpsertAccountSettings } from "@/hooks/useAccountSettings";
import { useTenantUsers } from "@/hooks/usePettyCash";
import { Switch } from "@/components/ui/switch";
import { useAccountById } from "@/hooks/useAccountSearch";
import { formatCurrency } from "@/lib/currency";
import InvoiceDetails from "@/components/invoices/InvoiceDetails";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoiceDownload";
import { downloadTaxInvoicePdf } from "@/lib/taxInvoicePdf";
import { loadTaxInvoice, type TaxInvoiceModel } from "@/lib/taxInvoiceData";
import TaxInvoiceDocument from "@/components/invoices/TaxInvoiceDocument";
import { shareInvoiceViaWhatsApp, shareInvoiceViaGmail, type ShareInvoiceArgs } from "@/lib/invoiceShare";

// Canonical invoice status vocabulary (stored): draft · posted · partial · paid · voided.
// "overdue" is derived live (posted/partial past due); "sent" is a legacy alias for "posted".
const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  posted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  overdue: "bg-destructive/10 text-destructive",
  draft: "bg-muted text-muted-foreground",
  voided: "bg-destructive/10 text-destructive line-through",
};

export default function Invoices() {
  const navigate = useNavigate();
  const { appUser, isCompanyAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "due_soon" | "overdue" | "paid" | "draft">("all");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [voidDialogInvoice, setVoidDialogInvoice] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [postConfirmInvoice, setPostConfirmInvoice] = useState<any>(null);
  const [deleteDialogInvoice, setDeleteDialogInvoice] = useState<any>(null);
  const [govOpen, setGovOpen] = useState(false);
  const [govTiers, setGovTiers] = useState<{ min_amount: string; required_approvals: number }[]>([]);
  const [govEnforce, setGovEnforce] = useState(true);
  const [govApprovers, setGovApprovers] = useState<string[]>([]);
  const [rejectInvoice, setRejectInvoice] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");
  const upsertSettings = useUpsertAccountSettings();
  const { data: tenantUsers } = useTenantUsers();
  const [taxPreviewOpen, setTaxPreviewOpen] = useState(false);
  const [taxPreviewModel, setTaxPreviewModel] = useState<TaxInvoiceModel | null>(null);
  const [taxPreviewInvoice, setTaxPreviewInvoice] = useState<any>(null);

  const { data: invoices, isLoading } = useInvoices();
  const { data: accounts } = useAccounts();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const approveInvoice = useApproveInvoice();
  const { canEdit: canEditSales } = useMyPermissions();

  const todayIso = new Date().toISOString().slice(0, 10);

  const getEffectiveStatus = (inv: any) => {
    if (inv.status === "voided") return "voided";
    if (inv.status === "draft") return "draft";
    if (inv.balance_due <= 0) return "paid";
    // A posted, still-owing invoice past its due date is overdue regardless of
    // the stored status — derived live so it matches the due-reminder alerts.
    if (inv.due_date && inv.due_date < todayIso) return "overdue";
    if (inv.amount_paid > 0) return "partial";
    // Normalize the legacy "sent" status onto the canonical "posted" label.
    return inv.status === "sent" ? "posted" : inv.status;
  };

  // Whole-day signed distance from today to a due date (negative = overdue).
  // Returns a short human hint shown beside the due date for owing invoices.
  const dueHint = (inv: any): { text: string; overdue: boolean } | null => {
    if (!inv.due_date || inv.balance_due <= 0 || inv.status === "draft" || inv.status === "voided") return null;
    const due = new Date(inv.due_date + "T00:00:00");
    const days = Math.round((due.getTime() - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true };
    if (days === 0) return { text: "due today", overdue: true };
    if (days <= 7) return { text: `in ${days}d`, overdue: false };
    return null;
  };

  // True when an owing, posted invoice falls due within the next 7 days (today
  // included) but is not yet overdue — the "due soon" bucket.
  const isDueSoon = (inv: any) => {
    const hint = dueHint(inv);
    return !!hint && !hint.overdue;
  };

  const matchesStatusFilter = (inv: any) => {
    switch (statusFilter) {
      case "due_soon": return isDueSoon(inv);
      case "overdue": return getEffectiveStatus(inv) === "overdue";
      case "paid": return getEffectiveStatus(inv) === "paid";
      case "draft": return inv.status === "draft";
      default: return true;
    }
  };

  const filtered = (invoices ?? []).filter((i) =>
    (i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
      (i.customers as any)?.name?.toLowerCase().includes(search.toLowerCase())) &&
    matchesStatusFilter(i)
  );

  // Tab counts (computed on the unfiltered set so they don't change with search).
  const tabCounts = {
    all: invoices?.length ?? 0,
    due_soon: invoices?.filter(isDueSoon).length ?? 0,
    overdue: invoices?.filter((i) => getEffectiveStatus(i) === "overdue").length ?? 0,
    paid: invoices?.filter((i) => getEffectiveStatus(i) === "paid").length ?? 0,
    draft: invoices?.filter((i) => i.status === "draft").length ?? 0,
  };

  const postInvoice = usePostInvoice();
  const { data: settings } = useAccountSettings();

  // Who may approve: if specific approvers are appointed, only they qualify;
  // otherwise it falls back to the owner (Company/Primary Admin). Mirrors the
  // server-side eligible_invoice_approvers() — the RPC is the real enforcement.
  const appointedApprovers = settings?.invoice_approver_ids ?? [];
  const canApproveInvoices = appointedApprovers.length > 0
    ? appointedApprovers.includes(appUser?.id ?? "")
    : isCompanyAdmin;
  const { data: arAccountData }       = useAccountById(settings?.ar_account_id       ?? null);
  const { data: salesAccountData }    = useAccountById(settings?.sales_account_id    ?? null);
  const outputVatAccountId = settings?.vat_output_payable_account_id ?? settings?.tax_payable_account_id ?? null;
  const { data: taxPayableAccountData }= useAccountById(outputVatAccountId);

  const previewLines = useMemo((): JournalPreviewLine[] => {
    const inv = postConfirmInvoice;
    if (!inv || !settings) return [];
    const lines: JournalPreviewLine[] = [];

    // Dr: AR
    lines.push({
      side: "Dr",
      role: "Accounts Receivable",
      accountName: arAccountData?.account_name ?? null,
      isMissing: !settings.ar_account_id,
      amount: Number(inv.total_amount),
    });

    // Cr: Revenue
    const revenueAccountId = inv.invoice_items?.[0]?.account_id || settings.sales_account_id;
    lines.push({
      side: "Cr",
      role: "Sales Revenue",
      accountName: salesAccountData?.account_name ?? null,
      isMissing: !revenueAccountId,
      amount: Number(inv.subtotal),
    });

    // Cr: Tax Payable (only if tax_amount > 0)
    if (Number(inv.tax_amount || 0) > 0) {
      lines.push({
        side: "Cr",
        role: "VAT Output Payable",
        accountName: taxPayableAccountData?.account_name ?? null,
        isMissing: !outputVatAccountId,
        amount: Number(inv.tax_amount),
      });
    }

    // COGS / Inventory rows for tracked products
    const trackedItems = (inv.invoice_items || []).filter((i: any) => i.inventory_item_id);
    if (trackedItems.length > 0) {
      lines.push({ side: "Dr", role: "COGS", note: "Per product — fallback to Default COGS", isMissing: false });
      lines.push({ side: "Cr", role: "Inventory Asset", note: "Per product — fallback to Default Inventory Asset", isMissing: false });
    }

    return lines;
  }, [postConfirmInvoice, settings, arAccountData, salesAccountData, taxPayableAccountData]);

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

  const handleDeleteInvoice = async () => {
    if (!deleteDialogInvoice) return;
    setProcessing(true);
    try {
      await deleteInvoice.mutateAsync({ id: deleteDialogInvoice.id, invoice_number: deleteDialogInvoice.invoice_number });
      setDeleteDialogInvoice(null);
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

  // Statutory IRD VAT tax invoice (Gazette 2481/22) — fixed gazette layout,
  // distinct from the user-editable template above.
  const handleTaxInvoiceDownload = async (inv: any) => {
    const tenantId = inv.tenant_id ?? appUser?.tenant_id;
    if (!tenantId) return toast.error("Missing tenant for this invoice");
    setProcessing(true);
    try {
      await downloadTaxInvoicePdf(inv.id, tenantId);
      toast.success("Tax invoice downloaded");
    } catch (e: any) {
      toast.error("Failed to download: " + (e?.message || "unknown error"));
    } finally {
      setProcessing(false);
    }
  };

  const handleTaxInvoicePreview = async (inv: any) => {
    const tenantId = inv.tenant_id ?? appUser?.tenant_id;
    if (!tenantId) return toast.error("Missing tenant for this invoice");
    setProcessing(true);
    try {
      const model = await loadTaxInvoice(inv.id, tenantId);
      setTaxPreviewModel(model);
      setTaxPreviewInvoice(inv);
      setTaxPreviewOpen(true);
    } catch (e: any) {
      toast.error("Failed to load tax invoice: " + (e?.message || "unknown error"));
    } finally {
      setProcessing(false);
    }
  };

  const handleShare = async (inv: any, channel: "whatsapp" | "gmail") => {
    const tenantId = inv.tenant_id ?? appUser?.tenant_id;
    if (!tenantId) return toast.error("Missing tenant for this invoice");
    setProcessing(true);
    const args: ShareInvoiceArgs = {
      invoiceId: inv.id,
      tenantId,
      invoiceNumber: inv.invoice_number,
      customerName: (inv.customers as any)?.name,
      customerPhone: (inv.customers as any)?.phone,
      customerEmail: (inv.customers as any)?.email,
      total: Number(inv.total_amount),
      amountPaid: Number(inv.amount_paid || 0),
      balanceDue: Number(inv.balance_due || 0),
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
      setProcessing(false);
    }
  };
  const stats = {
    outstanding: invoices?.filter(i => ["posted", "partial", "overdue"].includes(getEffectiveStatus(i)))
      .reduce((s, i) => s + Number(i.balance_due), 0) || 0,
    paid: invoices?.filter(i => getEffectiveStatus(i) === "paid")
      .reduce((s, i) => s + Number(i.total_amount), 0) || 0,
    overdue: invoices?.filter(i => getEffectiveStatus(i) === "overdue")
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
          <div className="flex items-center gap-2">
            {isCompanyAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  const tiers = settings?.invoice_approval_tiers?.length
                    ? settings.invoice_approval_tiers
                    : (settings?.invoice_approval_threshold
                        ? [{ min_amount: settings.invoice_approval_threshold, required_approvals: 1 }]
                        : []);
                  setGovTiers(tiers.map((t) => ({ min_amount: String(t.min_amount), required_approvals: t.required_approvals })));
                  setGovEnforce(settings?.enforce_credit_limit !== false);
                  setGovApprovers(settings?.invoice_approver_ids ?? []);
                  setGovOpen(true);
                }}
              >
                <ShieldAlert className="w-4 h-4" /> Controls
              </Button>
            )}
            <Button onClick={() => navigate("/sales/invoices/new")}>
              <Plus className="w-4 h-4" />New Invoice
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Outstanding Balance</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.outstanding)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Fully Paid</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.paid)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Overdue</p><p className="text-xl font-semibold text-destructive mt-1">{formatCurrency(stats.overdue)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Partial Payments</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.partial)}</p></div>
      </div>

      <div className="stat-card">
        {/* Status filter tabs — focus the list on what needs chasing */}
        <div className="flex flex-wrap items-center gap-1 mb-4">
          {([
            { key: "all", label: "All" },
            { key: "due_soon", label: "Due soon" },
            { key: "overdue", label: "Overdue" },
            { key: "paid", label: "Paid" },
            { key: "draft", label: "Drafts" },
          ] as const).map((t) => {
            const active = statusFilter === t.key;
            const count = tabCounts[t.key];
            const isOverdue = t.key === "overdue";
            return (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? isOverdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t.label}
                <span className={`tabular-nums rounded-full px-1.5 text-[10px] ${active ? "bg-background/60" : "bg-muted"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

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
                  // Anything not a draft and not voided has been posted to the GL.
                  const isPosted = !isDraft && !isVoided;
                  return (
                    <tr key={inv.id} className={`border-t border-border hover:bg-muted/30 transition-colors ${isVoided ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 font-medium text-foreground">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-muted-foreground">{(inv.customers as any)?.name || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.issue_date}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span>{inv.due_date || "-"}</span>
                          {(() => {
                            const hint = dueHint(inv);
                            if (!hint) return null;
                            return (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${hint.overdue ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                                {hint.text}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || ""}`}>
                            {status}
                          </span>
                          {isDraft && (inv as any).approval_status === "pending" && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400" title="Awaiting approval">
                              <ShieldAlert className="w-3 h-3" /> {(inv as any).approvals_count ?? 0}/{(inv as any).required_approvals || 1}
                            </span>
                          )}
                          {isDraft && (inv as any).approval_status === "rejected" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive" title="Approval rejected">
                              rejected
                            </span>
                          )}
                        </div>
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
                          <Button variant="ghost" size="sm" title="Download PDF" onClick={() => handleDownload(inv)} disabled={processing}>
                            <Download className="w-4 h-4" />
                          </Button>
                          {isDraft && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title={(inv as any).approval_status === "pending" ? "Awaiting approval" : (inv as any).approval_status === "rejected" ? "Approval rejected" : "Post Invoice"}
                              onClick={() => setPostConfirmInvoice(inv)}
                              disabled={processing || (inv as any).approval_status === "pending" || (inv as any).approval_status === "rejected"}
                            >
                              <Send className="w-4 h-4 text-primary" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleDownload(inv)} disabled={processing}>
                                <Download className="w-4 h-4 mr-2" /> Invoice (Template)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleTaxInvoicePreview(inv)} disabled={processing}>
                                <Eye className="w-4 h-4 mr-2" /> View Tax Invoice
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleTaxInvoiceDownload(inv)} disabled={processing}>
                                <FileText className="w-4 h-4 mr-2" /> Tax Invoice (PDF)
                              </DropdownMenuItem>
                              {!isVoided && (
                                <>
                                  <DropdownMenuItem onClick={() => { setSelectedInvoice(inv); setDetailsOpen(true); }}>
                                    <Mail className="w-4 h-4 mr-2" /> Email Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleShare(inv, "whatsapp")} disabled={processing}>
                                    <MessageCircle className="w-4 h-4 mr-2" /> Send via WhatsApp
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleShare(inv, "gmail")} disabled={processing}>
                                    <Mail className="w-4 h-4 mr-2" /> Send via Gmail
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {isDraft && (inv as any).approval_status === "pending" && canApproveInvoices && (
                                <>
                                  <DropdownMenuItem onClick={() => approveInvoice.mutate({ id: inv.id, decision: "approved" })}>
                                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" /> Approve
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRejectInvoice(inv); setRejectReason(""); }}>
                                    <XCircle className="w-4 h-4 mr-2 text-destructive" /> Reject
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {isDraft && (
                                <>
                                  <DropdownMenuItem onClick={() => navigate(`/sales/invoices/${inv.id}/edit`)}>
                                    <Pencil className="w-4 h-4 mr-2" /> Edit Draft
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setPostConfirmInvoice(inv)} disabled={processing || (inv as any).approval_status === "pending" || (inv as any).approval_status === "rejected"}>
                                    <Send className="w-4 h-4 mr-2" /> Post & Create Journal
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialogInvoice(inv)} disabled={processing}>
                                    <Trash2 className="w-4 h-4 mr-2" /> Delete Draft
                                  </DropdownMenuItem>
                                </>
                              )}
                              {isPosted && (
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

      {/* Statutory VAT Tax Invoice preview (IRD Gazette 2481/22) */}
      <Dialog open={taxPreviewOpen} onOpenChange={setTaxPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tax Invoice — {taxPreviewModel?.invoiceNo}</DialogTitle>
            <DialogDescription>IRD Gazette 2481/22 statutory format. Review before issuing.</DialogDescription>
          </DialogHeader>
          {(!taxPreviewModel?.supplier.tin || !taxPreviewModel?.purchaser.tin) && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {!taxPreviewModel?.supplier.tin && <p>Supplier TIN is missing — set it in Settings → Company Information.</p>}
              {!taxPreviewModel?.purchaser.tin && <p>Purchaser TIN is missing — set it on the customer record.</p>}
            </div>
          )}
          {taxPreviewModel && (
            <div className="overflow-x-auto rounded border border-border bg-white">
              <TaxInvoiceDocument model={taxPreviewModel} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTaxPreviewOpen(false)}>Close</Button>
            <Button onClick={() => taxPreviewInvoice && handleTaxInvoiceDownload(taxPreviewInvoice)} disabled={processing}>
              <FileText className="w-4 h-4 mr-1.5" /> Download PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post Invoice confirmation */}
      <AlertDialog open={!!postConfirmInvoice} onOpenChange={(v) => { if (!v) setPostConfirmInvoice(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Invoice {postConfirmInvoice?.invoice_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a journal entry and mark the invoice as posted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mb-4">
            <JournalPreview
              lines={previewLines}
              title="Journal Entry to be Posted"
              description="Review the accounts this invoice will post to before confirming."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { handlePostDraft(postConfirmInvoice); setPostConfirmInvoice(null); }}
              disabled={processing}
            >
              Confirm & Post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject invoice — reason required */}
      <Dialog open={!!rejectInvoice} onOpenChange={(v) => { if (!v) setRejectInvoice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /> Reject invoice</DialogTitle>
            <DialogDescription>
              {rejectInvoice?.invoice_number} — the creator will need to amend and resubmit. A reason is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[90px]"
              placeholder="e.g. Wrong customer PO, price mismatch, missing approval from ops…"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectInvoice(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={!rejectReason.trim() || approveInvoice.isPending}
                onClick={async () => {
                  await approveInvoice.mutateAsync({ id: rejectInvoice.id, decision: "rejected", note: rejectReason.trim() });
                  setRejectInvoice(null);
                }}
              >
                {approveInvoice.isPending ? "Rejecting…" : "Reject invoice"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approval & Credit Control settings */}
      <Dialog open={govOpen} onOpenChange={setGovOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5" /> Approval &amp; Credit Control</DialogTitle>
            <DialogDescription>Tenant-wide policy applied when posting invoices.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Approval levels</label>
              <p className="text-xs text-muted-foreground mb-2">
                Add an amount and how many different approvers it needs. An invoice uses the highest level its total
                (in LKR) reaches — e.g. ≥ 500,000 needs 1 approver, ≥ 2,000,000 needs 2. No levels = no approval required.
              </p>
              <div className="space-y-2">
                {govTiers.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No approval required for any amount.</p>
                )}
                {govTiers.map((t, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">Total ≥</span>
                    <input
                      type="number"
                      value={t.min_amount}
                      onChange={(e) => setGovTiers((prev) => prev.map((x, i) => i === idx ? { ...x, min_amount: e.target.value } : x))}
                      placeholder="amount (LKR)"
                      className="flex-1 min-w-0 text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground font-mono"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">needs</span>
                    <input
                      type="number"
                      min={1}
                      value={t.required_approvals}
                      onChange={(e) => setGovTiers((prev) => prev.map((x, i) => i === idx ? { ...x, required_approvals: Number(e.target.value) } : x))}
                      className="w-16 text-sm border border-input rounded-lg px-2 py-2 bg-background text-foreground text-center"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">approver{t.required_approvals === 1 ? "" : "s"}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setGovTiers((prev) => prev.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                  onClick={() => setGovTiers((prev) => [...prev, { min_amount: "", required_approvals: 1 }])}
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Add approval level
                </Button>
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="text-sm font-medium block">Enforce customer credit limit</span>
                <span className="text-xs text-muted-foreground">Block posting when a customer's outstanding balance + this invoice exceeds their credit limit.</span>
              </span>
              <Switch checked={govEnforce} onCheckedChange={setGovEnforce} />
            </label>
            <div>
              <label className="text-sm font-medium">Appointed approvers</label>
              <p className="text-xs text-muted-foreground mb-2">
                Select who may approve invoices. If none are selected, approval falls to the owner (Primary Admin).
                Owners can always approve. An approver can never approve their own invoice (unless they are the only eligible approver).
              </p>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {(tenantUsers ?? []).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No users found</p>
                ) : (
                  (tenantUsers ?? []).map((u: any) => {
                    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;
                    const checked = govApprovers.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setGovApprovers((prev) => e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id))
                          }
                        />
                        <span className="text-foreground">{name}</span>
                        {u.email && name !== u.email && <span className="text-xs text-muted-foreground">{u.email}</span>}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGovOpen(false)}>Cancel</Button>
              <Button
                onClick={async () => {
                  const cleanTiers = govTiers
                    .map((t) => ({ min_amount: Number(t.min_amount), required_approvals: Math.max(1, Number(t.required_approvals) || 1) }))
                    .filter((t) => t.min_amount > 0)
                    .sort((a, b) => a.min_amount - b.min_amount);
                  await upsertSettings.mutateAsync({
                    invoice_approval_tiers: cleanTiers.length ? cleanTiers : null,
                    invoice_approval_threshold: cleanTiers.length ? cleanTiers[0].min_amount : null,
                    enforce_credit_limit: govEnforce,
                    invoice_approver_ids: govApprovers.length ? govApprovers : null,
                  } as any);
                  setGovOpen(false);
                }}
                disabled={upsertSettings.isPending}
              >
                {upsertSettings.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Draft confirmation */}
      <AlertDialog open={!!deleteDialogInvoice} onOpenChange={(v) => { if (!v) setDeleteDialogInvoice(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft {deleteDialogInvoice?.invoice_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the draft and its line items. No journal entry exists yet, so nothing in the ledger changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteInvoice}
              disabled={processing}
            >
              {processing ? "Deleting…" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
