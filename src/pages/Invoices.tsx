import { Plus, Search, MoreHorizontal, Eye, Send, Ban, Download, MessageCircle, Mail, FileText, Pencil, Trash2, CheckCircle2, XCircle, ShieldAlert, Receipt, CornerUpLeft, RotateCcw, ArrowDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useInvoices, useUpdateInvoice, useAccounts, useDeleteInvoice } from "@/hooks/useData";
import { useApprovalQueue, useDecideInvoice, useResubmitInvoice } from "@/hooks/useApprovals";
import { usePostInvoice } from "@/hooks/useAccountSettings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import JournalPreview, { type JournalPreviewLine } from "@/components/accounting/JournalPreview";
import { useAccountSettings, useUpsertAccountSettings, type AccountSettings } from "@/hooks/useAccountSettings";
import { useTenantUsers } from "@/hooks/usePettyCash";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountById } from "@/hooks/useAccountSearch";
import { formatCurrency } from "@/lib/currency";
import InvoiceDetails from "@/components/invoices/InvoiceDetails";
import InvoiceDocumentViewer from "@/components/invoices/InvoiceDocumentViewer";
import { useReceiptedInvoiceIds } from "@/hooks/useInvoiceReceipts";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoiceDownload";
import { downloadTaxInvoicePdf } from "@/lib/taxInvoicePdf";
import { loadTaxInvoice, type TaxInvoiceModel } from "@/lib/taxInvoiceData";
import TaxInvoiceDocument from "@/components/invoices/TaxInvoiceDocument";
import { shareInvoiceViaWhatsApp, shareInvoiceViaGmail, type ShareInvoiceArgs } from "@/lib/invoiceShare";
import { formatDate } from "@/lib/format";

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

// One editable level of the approval chain (amounts stay strings while typing).
type GovLevel = { name: string; min_amount: string; required_approvals: number; approver_ids: string[] };

// Read the saved policy back into the editor. Tenants still on the flat tier
// model see each tier as a level, so saving migrates them to a real chain.
function levelsFromSettings(settings: AccountSettings | null | undefined): GovLevel[] {
  const chain = settings?.invoice_approval_workflow;
  if (chain?.length) {
    return chain.map((s) => ({
      name: s.name ?? "",
      min_amount: String(s.min_amount ?? ""),
      required_approvals: Math.max(1, Number(s.required_approvals) || 1),
      approver_ids: s.approver_ids ?? [],
    }));
  }
  const tiers = settings?.invoice_approval_tiers?.length
    ? settings.invoice_approval_tiers
    : (settings?.invoice_approval_threshold
        ? [{ min_amount: settings.invoice_approval_threshold, required_approvals: 1 }]
        : []);
  return [...tiers]
    .sort((a, b) => a.min_amount - b.min_amount)
    .map((t, i) => ({
      name: `Level ${i + 1}`,
      min_amount: String(t.min_amount),
      required_approvals: Math.max(1, Number(t.required_approvals) || 1),
      approver_ids: [],
    }));
}

export default function Invoices() {
  const navigate = useNavigate();
  const { appUser, isCompanyAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "due_soon" | "overdue" | "paid" | "draft">("all");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The rendered invoice document (the customer's view), separate from the
  // details dialog, which is the internal payment/approval workspace.
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [voidDialogInvoice, setVoidDialogInvoice] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [postConfirmInvoice, setPostConfirmInvoice] = useState<any>(null);
  const [deleteDialogInvoice, setDeleteDialogInvoice] = useState<any>(null);
  const [govOpen, setGovOpen] = useState(false);
  // The approval chain being edited: ordered levels, each with its own approvers.
  const [govLevels, setGovLevels] = useState<GovLevel[]>([]);
  const [govEnforce, setGovEnforce] = useState(true);
  const [govApprovers, setGovApprovers] = useState<string[]>([]);
  const [govDistinct, setGovDistinct] = useState(false);
  const [rejectInvoice, setRejectInvoice] = useState<any>(null);
  const [rejectDecision, setRejectDecision] = useState<"rejected" | "changes_requested">("rejected");
  const [rejectReason, setRejectReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const upsertSettings = useUpsertAccountSettings();
  const { data: tenantUsers } = useTenantUsers();
  const [taxPreviewOpen, setTaxPreviewOpen] = useState(false);
  const [taxPreviewModel, setTaxPreviewModel] = useState<TaxInvoiceModel | null>(null);
  const [taxPreviewInvoice, setTaxPreviewInvoice] = useState<any>(null);

  const { data: invoices, isLoading } = useInvoices();
  const { data: accounts } = useAccounts();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const decide = useDecideInvoice();
  const resubmit = useResubmitInvoice();
  const { data: approvalQueue } = useApprovalQueue();
  const { canEdit: canEditSales } = useMyPermissions();
  // Which invoices already carry an issued receipt — one set read rather than a
  // query per row. Drives both the row badge and the "only one receipt" guard.
  const { data: receiptedIds } = useReceiptedInvoiceIds();

  // The queue RPC already answers "may this user act on this invoice, at its
  // current level?" — reuse that verdict rather than re-deriving it here.
  const approvalRow = (id: string) => (approvalQueue ?? []).find((r) => r.id === id);

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
  // ── Bulk selection + actions ──────────────────────────────────────
  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());
  const selectedInvoices = filtered.filter((i) => selected.has(i.id));
  const selectedDrafts = selectedInvoices.filter((i) =>
    i.status === "draft" && !["pending", "rejected", "changes_requested"].includes((i as any).approval_status));
  const selectedPosted = selectedInvoices.filter((i) => !["draft", "voided"].includes(i.status));

  const csvCell = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const exportCsv = () => {
    const rows = selected.size > 0 ? selectedInvoices : filtered;
    const header = ["Invoice", "Customer", "Issue Date", "Due Date", "Status", "Currency", "Total", "Paid", "Balance"];
    const bodyRows = rows.map((i) => [
      i.invoice_number, (i.customers as any)?.name || "", i.issue_date, i.due_date || "",
      getEffectiveStatus(i), i.currency || "LKR", Number(i.total_amount), Number(i.amount_paid || 0), Number(i.balance_due || 0),
    ]);
    const csv = [header, ...bodyRows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} invoice(s)`);
  };
  const bulkPost = async () => {
    if (selectedDrafts.length === 0) return;
    setProcessing(true);
    let ok = 0;
    for (const inv of selectedDrafts) {
      try { await postInvoice.mutateAsync({ invoice_id: inv.id, action: "post" }); ok++; } catch { /* per-invoice toast */ }
    }
    setProcessing(false); clearSelection();
    toast.success(`Posted ${ok} of ${selectedDrafts.length} draft(s)`);
  };
  const bulkVoid = async () => {
    if (selectedPosted.length === 0) return;
    if (!window.confirm(`Void ${selectedPosted.length} posted invoice(s)? This creates reversing journals and cannot be undone.`)) return;
    setProcessing(true);
    let ok = 0;
    for (const inv of selectedPosted) {
      try { await postInvoice.mutateAsync({ invoice_id: inv.id, action: "void" }); ok++; } catch { /* */ }
    }
    setProcessing(false); clearSelection();
    toast.success(`Voided ${ok} of ${selectedPosted.length} invoice(s)`);
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
                  setGovLevels(levelsFromSettings(settings));
                  setGovEnforce(settings?.enforce_credit_limit !== false);
                  setGovApprovers(settings?.invoice_approver_ids ?? []);
                  setGovDistinct(!!settings?.invoice_approval_require_distinct);
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
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="flex-1" />
            {selectedDrafts.length > 0 && (
              <Button size="sm" variant="outline" onClick={bulkPost} disabled={processing}>
                <Send className="w-4 h-4 mr-1.5" /> Post {selectedDrafts.length} draft{selectedDrafts.length === 1 ? "" : "s"}
              </Button>
            )}
            {selectedPosted.length > 0 && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={bulkVoid} disabled={processing}>
                <Ban className="w-4 h-4 mr-1.5" /> Void {selectedPosted.length}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No invoices found</p>
        ) : (
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 w-10"><Checkbox checked={allFilteredSelected} onCheckedChange={toggleAll} aria-label="Select all" /></th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Invoice</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Due Date</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground whitespace-nowrap">Total</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground whitespace-nowrap">Paid</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground whitespace-nowrap">Balance</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const status = getEffectiveStatus(inv);
                  const isDraft = inv.status === "draft";
                  const isVoided = inv.status === "voided";
                  // Anything not a draft and not voided has been posted to the GL.
                  const isPosted = !isDraft && !isVoided;
                  const hasReceipt = !!receiptedIds?.has(inv.id);
                  return (
                    <tr key={inv.id} className={`border-t border-border hover:bg-muted/30 transition-colors ${isVoided ? "opacity-50" : ""} ${selected.has(inv.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3"><Checkbox checked={selected.has(inv.id)} onCheckedChange={() => toggleSelect(inv.id)} aria-label={`Select ${inv.invoice_number}`} /></td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {/* The number is the handle on the document itself — click it to read the invoice. */}
                        <button
                          onClick={() => setViewInvoice(inv)}
                          className="text-left font-medium text-foreground hover:text-primary hover:underline"
                          title="View invoice"
                        >
                          {inv.invoice_number}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{(inv.customers as any)?.name || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(inv.issue_date)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{formatDate(inv.due_date)}</span>
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
                          {hasReceipt && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              title="A settlement receipt has been issued — the invoice document carries the PAID stamp"
                            >
                              <Receipt className="w-3 h-3" /> receipted
                            </span>
                          )}
                          {isDraft && (inv as any).approval_status === "pending" && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              title={`${(inv as any).approval_step_name || "Approval"} — ${(inv as any).approvals_count ?? 0} of ${(inv as any).required_approvals || 1} sign-offs at this level`}
                            >
                              <ShieldAlert className="w-3 h-3" />
                              L{(inv as any).approval_step || 1}/{(inv as any).approval_steps_total || 1}
                              {" · "}{(inv as any).approvals_count ?? 0}/{(inv as any).required_approvals || 1}
                            </span>
                          )}
                          {isDraft && (inv as any).approval_status === "changes_requested" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400" title={(inv as any).approval_note || "Sent back for changes"}>
                              changes requested
                            </span>
                          )}
                          {isDraft && (inv as any).approval_status === "rejected" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive" title={(inv as any).approval_note || "Approval rejected"}>
                              rejected
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">{formatCurrency(Number(inv.total_amount), inv.currency)}</td>
                      <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">
                        {inv.amount_paid > 0 ? formatCurrency(inv.amount_paid, inv.currency) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${inv.balance_due > 0 ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(inv.balance_due, inv.currency)}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex flex-nowrap items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" title="View invoice" onClick={() => setViewInvoice(inv)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Payments, approvals & attachments" onClick={() => { setSelectedInvoice(inv); setDetailsOpen(true); }}>
                            <FileText className="w-4 h-4" />
                          </Button>
                          {isDraft && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title={
                                (inv as any).approval_status === "pending"
                                  ? `Awaiting ${(inv as any).approval_step_name || "approval"}`
                                  : (inv as any).approval_status === "changes_requested" ? "Sent back for changes"
                                  : (inv as any).approval_status === "rejected" ? "Approval rejected"
                                  : "Post Invoice"
                              }
                              onClick={() => setPostConfirmInvoice(inv)}
                              disabled={processing || ["pending", "rejected", "changes_requested"].includes((inv as any).approval_status)}
                            >
                              <Send className="w-4 h-4 text-primary" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => setViewInvoice(inv)}>
                                <Eye className="w-4 h-4 mr-2" /> View Invoice
                              </DropdownMenuItem>
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
                              {isDraft && approvalRow(inv.id)?.can_act && (
                                <>
                                  <DropdownMenuItem onClick={() => decide.mutate({ id: inv.id, decision: "approved" })}>
                                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                                    Approve · {approvalRow(inv.id)?.step_name}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRejectInvoice(inv); setRejectDecision("changes_requested"); setRejectReason(""); }}>
                                    <CornerUpLeft className="w-4 h-4 mr-2 text-amber-600" /> Request changes
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRejectInvoice(inv); setRejectDecision("rejected"); setRejectReason(""); }}>
                                    <XCircle className="w-4 h-4 mr-2 text-destructive" /> Reject
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {isDraft && ["changes_requested", "rejected"].includes((inv as any).approval_status) && (
                                <>
                                  <DropdownMenuItem onClick={() => resubmit.mutate({ id: inv.id })} disabled={resubmit.isPending}>
                                    <RotateCcw className="w-4 h-4 mr-2 text-primary" /> Resubmit for approval
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
                                  {/* One receipt per invoice, and only once it is settled in
                                      full — the server enforces both; this just says so up front. */}
                                  <DropdownMenuItem
                                    onClick={() => navigate(`/sales/receipts?invoice_id=${inv.id}`)}
                                    disabled={!hasReceipt && inv.balance_due > 0.005}
                                    title={
                                      hasReceipt ? "Receipt already issued — open it"
                                        : inv.balance_due > 0.005 ? "A receipt can only be issued once the invoice is paid in full"
                                        : "Issue the settlement receipt"
                                    }
                                  >
                                    <Receipt className="w-4 h-4 mr-2" />
                                    {hasReceipt ? "View Receipt" : "Issue Receipt"}
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

      {/* The invoice as the customer reads it */}
      <InvoiceDocumentViewer
        invoiceId={viewInvoice?.id}
        tenantId={viewInvoice?.tenant_id ?? appUser?.tenant_id}
        invoiceNumber={viewInvoice?.invoice_number}
        open={!!viewInvoice}
        onOpenChange={(v) => { if (!v) setViewInvoice(null); }}
      />

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

      {/* Reject / request changes — reason required either way */}
      <Dialog open={!!rejectInvoice} onOpenChange={(v) => { if (!v) setRejectInvoice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${rejectDecision === "rejected" ? "text-destructive" : ""}`}>
              {rejectDecision === "rejected"
                ? <><XCircle className="w-5 h-5" /> Reject invoice</>
                : <><CornerUpLeft className="w-5 h-5" /> Request changes</>}
            </DialogTitle>
            <DialogDescription>
              {rejectInvoice?.invoice_number}
              {rejectDecision === "rejected"
                ? " — this ends the approval round; the invoice must be resubmitted from level 1. A reason is required."
                : " — the invoice goes back to the raiser to edit and resubmit. Say what needs to change."}
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
                variant={rejectDecision === "rejected" ? "destructive" : "default"}
                disabled={!rejectReason.trim() || decide.isPending}
                onClick={async () => {
                  await decide.mutateAsync({ id: rejectInvoice.id, decision: rejectDecision, note: rejectReason.trim() });
                  setRejectInvoice(null);
                }}
              >
                {decide.isPending ? "Saving…" : rejectDecision === "rejected" ? "Reject invoice" : "Send back"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approval & Credit Control settings */}
      <Dialog open={govOpen} onOpenChange={setGovOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5" /> Approval &amp; Credit Control</DialogTitle>
            <DialogDescription>Tenant-wide policy applied when posting invoices.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            <div>
              <label className="text-sm font-medium">Approval chain</label>
              <p className="text-xs text-muted-foreground mb-3">
                Levels run in order — each one only opens once the level above it has signed off. A level applies
                only when the invoice total (in LKR) reaches its threshold, so bigger invoices travel further up the
                chain. No levels = no approval required.
              </p>
              <div className="space-y-2">
                {govLevels.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No approval required for any amount.</p>
                )}
                {govLevels.map((lv, idx) => (
                  <div key={idx}>
                    <div className="rounded-lg border border-border p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground shrink-0 w-12">Level {idx + 1}</span>
                        <input
                          value={lv.name}
                          onChange={(e) => setGovLevels((p) => p.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                          placeholder="e.g. Finance Manager"
                          className="flex-1 min-w-0 text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground"
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                          onClick={() => setGovLevels((p) => p.filter((_, i) => i !== idx))}>
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-14">
                        <span className="text-xs text-muted-foreground">Applies from</span>
                        <input
                          type="number"
                          value={lv.min_amount}
                          onChange={(e) => setGovLevels((p) => p.map((x, i) => i === idx ? { ...x, min_amount: e.target.value } : x))}
                          placeholder="0"
                          className="w-32 text-sm border border-input rounded-lg px-3 py-1.5 bg-background text-foreground font-mono"
                        />
                        <span className="text-xs text-muted-foreground">LKR · needs</span>
                        <input
                          type="number"
                          min={1}
                          value={lv.required_approvals}
                          onChange={(e) => setGovLevels((p) => p.map((x, i) => i === idx ? { ...x, required_approvals: Number(e.target.value) } : x))}
                          className="w-14 text-sm border border-input rounded-lg px-2 py-1.5 bg-background text-foreground text-center"
                        />
                        <span className="text-xs text-muted-foreground">
                          sign-off{lv.required_approvals === 1 ? "" : "s"} at this level
                        </span>
                      </div>
                      <div className="pl-14">
                        <div className="max-h-32 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                          {(tenantUsers ?? []).length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No users found</p>
                          ) : (
                            (tenantUsers ?? []).map((u: any) => {
                              const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;
                              return (
                                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                                  <input
                                    type="checkbox"
                                    checked={lv.approver_ids.includes(u.id)}
                                    onChange={(e) => setGovLevels((p) => p.map((x, i) => i === idx ? {
                                      ...x,
                                      approver_ids: e.target.checked
                                        ? [...x.approver_ids, u.id]
                                        : x.approver_ids.filter((id) => id !== u.id),
                                    } : x))}
                                  />
                                  <span className="text-foreground">{name}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                        {lv.approver_ids.length === 0 && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Nobody picked — this level falls back to the appointed approvers below.
                          </p>
                        )}
                        {lv.approver_ids.length > 0 && lv.approver_ids.length < lv.required_approvals && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                            Only {lv.approver_ids.length} approver{lv.approver_ids.length === 1 ? "" : "s"} selected but{" "}
                            {lv.required_approvals} sign-offs required — this level can never clear.
                          </p>
                        )}
                      </div>
                    </div>
                    {idx < govLevels.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowDown className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                  onClick={() => setGovLevels((p) => [...p, {
                    name: "", min_amount: p.length === 0 ? "" : String(p[p.length - 1].min_amount || ""),
                    required_approvals: 1, approver_ids: [],
                  }])}
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Add level
                </Button>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="text-sm font-medium block">One person, one level</span>
                <span className="text-xs text-muted-foreground">
                  Someone who signs one level cannot also sign another level of the same invoice.
                </span>
              </span>
              <Switch checked={govDistinct} onCheckedChange={setGovDistinct} />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="text-sm font-medium block">Enforce customer credit limit</span>
                <span className="text-xs text-muted-foreground">Block posting when a customer's outstanding balance + this invoice exceeds their credit limit.</span>
              </span>
              <Switch checked={govEnforce} onCheckedChange={setGovEnforce} />
            </label>

            <div>
              <label className="text-sm font-medium">Fallback approvers</label>
              <p className="text-xs text-muted-foreground mb-2">
                Used by any level that names nobody. If this is empty too, approval falls to the owner (Primary Admin).
                An approver can never approve their own invoice unless they are the only eligible approver.
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
                  // Levels keep their order; thresholds only ever climb, so a level
                  // can never apply to an invoice that skipped the one above it.
                  let floor = 0;
                  const chain = govLevels.map((lv, i) => {
                    const min = Math.max(floor, Number(lv.min_amount) || 0);
                    floor = min;
                    return {
                      name: lv.name.trim() || `Level ${i + 1}`,
                      min_amount: min,
                      required_approvals: Math.max(1, Number(lv.required_approvals) || 1),
                      approver_ids: lv.approver_ids,
                    };
                  });
                  await upsertSettings.mutateAsync({
                    invoice_approval_workflow: chain.length ? chain : null,
                    // The chain supersedes the flat tiers — clear them so there is
                    // exactly one definition of the policy.
                    invoice_approval_tiers: null,
                    invoice_approval_threshold: chain.length ? chain[0].min_amount : null,
                    invoice_approval_require_distinct: govDistinct,
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
