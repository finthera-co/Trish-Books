import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, XCircle, Clock, Send, Printer, RotateCcw, Upload, FileImage, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReimbursementBadge } from "@/components/petty-cash/ReimbursementBadge";
import PettyCashVoucherDocument from "@/components/petty-cash/PettyCashVoucherDocument";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import {
  usePCVoucher,
  usePCVoucherLines,
  useUpdateVoucherStatus,
  useReverseVoucher,
  useUploadReceipt,
  useUpdateVoucherReceipts,
  getReceiptSignedUrl,
} from "@/hooks/usePettyCash";
import { useMyPermissions } from "@/hooks/usePermissions";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";

const statusConfig: Record<string, { color: string; icon: any }> = {
  draft: { color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { color: "bg-warning/10 text-warning", icon: Send },
  approved: { color: "bg-success/10 text-success", icon: CheckCircle },
  rejected: { color: "bg-destructive/10 text-destructive", icon: XCircle },
  reversed: { color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: RotateCcw },
};

export default function PettyCashVoucherDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: voucher, isLoading } = usePCVoucher(id);
  const { data: lines } = usePCVoucherLines(id);
  const updateStatus = useUpdateVoucherStatus();
  const reverseVoucher = useReverseVoucher();
  const uploadReceipt = useUploadReceipt();
  const updateReceipts = useUpdateVoucherReceipts();
  const { canEdit } = useMyPermissions();
  const { data: company } = useCompanyProfile();
  const canManage = canEdit("banking");
  const fileInputRef = useRef<HTMLInputElement>(null);

  usePageTitle(voucher?.voucher_number);

  if (isLoading) return <p className="text-center py-12 text-muted-foreground">Loading...</p>;
  if (!voucher) return <p className="text-center py-12 text-muted-foreground">Voucher not found</p>;

  const sc = statusConfig[voucher.status] || statusConfig.draft;
  const StatusIcon = sc.icon;

  const handleStatusChange = (status: string) => {
    updateStatus.mutate({ id: voucher.id, status });
  };

  const handleReverse = () => {
    if (!confirm("Are you sure you want to reverse this voucher? A correcting journal entry will be created.")) return;
    reverseVoucher.mutate(voucher.id);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const newPaths: string[] = [...((voucher as any).receipt_urls || [])];
    for (const file of Array.from(files)) {
      try {
        const path = await uploadReceipt.mutateAsync({ file, voucherId: voucher.id });
        newPaths.push(path);
      } catch { /* error already toasted */ }
    }
    updateReceipts.mutate({ voucherId: voucher.id, receiptUrls: newPaths });
    e.target.value = "";
  };

  const handleViewReceipt = async (path: string) => {
    try {
      const url = await getReceiptSignedUrl(path);
      window.open(url, "_blank");
    } catch {
      toast.error("Failed to load receipt");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const receiptUrls: string[] = (voucher as any).receipt_urls || [];

  type NamedUser = { first_name?: string | null; last_name?: string | null } | null | undefined;
  const fullName = (u: NamedUser) =>
    u ? [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null : null;
  const preparedName = fullName((voucher as any).prepared_user);
  const authorizedName = fullName((voucher as any).authorized_user);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header — hidden in print */}
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="ghost" size="icon" onClick={() => navigate("/banking/petty-cash")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold font-mono">{voucher.voucher_number}</h1>
          <p className="text-sm text-muted-foreground">Petty Cash Voucher</p>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="w-4 h-4 mr-1" /> Print
        </Button>
        <Badge className={sc.color}>
          <StatusIcon className="w-3.5 h-3.5 mr-1" /> {voucher.status}
        </Badge>
        <ReimbursementBadge status={voucher.status} replenishmentId={(voucher as any).replenishment_id} />
      </div>

      {/* ─── The voucher itself ─── */}
      <div className="rounded-lg border shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none">
        <PettyCashVoucherDocument
          model={{
            voucherNumber: voucher.voucher_number,
            date: voucher.date,
            paidTo: voucher.paid_to,
            fundName: voucher.petty_cash_accounts?.account_name,
            status: voucher.status,
            totalAmount: Number(voucher.total_amount) || 0,
            preparedBy: preparedName,
            authorizedBy: authorizedName,
            approvedAt: voucher.approved_at,
            reversedAt: (voucher as any).reversed_at,
            lines: (lines ?? []).map((l) => ({
              id: l.id,
              date: l.date,
              description: l.description,
              amount: Number(l.amount) || 0,
              accountCode: l.accounts?.account_code ?? null,
              accountName: l.accounts?.account_name ?? null,
            })),
          }}
          company={company}
        />
      </div>

      {voucher.journal_entry_id && (
        <div className="print:hidden">
          {/* Straight to the entry this voucher posted, matching how payroll
              runs and vendor payments link to theirs. Landing on the unfiltered
              journal list left the user to hunt for it. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/accounting/journals/${voucher.journal_entry_id}`)}
          >
            <FileText className="w-3.5 h-3.5 mr-1" /> View journal entry
          </Button>
        </div>
      )}

      {/* ─── Receipts (not printed) ─── */}
      <Card className="print:hidden">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Receipt Attachments</CardTitle>
            {canManage && voucher.status !== "approved" && voucher.status !== "reversed" && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadReceipt.isPending}>
                  <Upload className="w-3.5 h-3.5 mr-1" /> {uploadReceipt.isPending ? "Uploading..." : "Upload Receipt"}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!receiptUrls.length ? (
            <p className="text-sm text-muted-foreground">No receipts attached</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {receiptUrls.map((path, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleViewReceipt(path)}
                >
                  <FileImage className="w-3.5 h-3.5" />
                  Receipt {idx + 1}
                  <ExternalLink className="w-3 h-3" />
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Actions (not printed) ─── */}
      {canManage && (
        <div className="flex gap-2 justify-end print:hidden">
          {voucher.status === "draft" && (
            <Button onClick={() => handleStatusChange("pending")} disabled={updateStatus.isPending}>
              <Send className="w-4 h-4 mr-1" /> Submit for Approval
            </Button>
          )}
          {voucher.status === "pending" && (
            <>
              <Button variant="destructive" onClick={() => handleStatusChange("rejected")} disabled={updateStatus.isPending}>
                <XCircle className="w-4 h-4 mr-1" /> Reject
              </Button>
              <Button onClick={() => handleStatusChange("approved")} disabled={updateStatus.isPending}>
                <CheckCircle className="w-4 h-4 mr-1" /> Approve & Post
              </Button>
            </>
          )}
          {voucher.status === "rejected" && (
            <Button variant="outline" onClick={() => handleStatusChange("draft")} disabled={updateStatus.isPending}>
              Revert to Draft
            </Button>
          )}
          {voucher.status === "approved" && !(voucher as any).reversed_at && (
            <Button variant="destructive" onClick={handleReverse} disabled={reverseVoucher.isPending}>
              <RotateCcw className="w-4 h-4 mr-1" /> {reverseVoucher.isPending ? "Reversing..." : "Reverse Voucher"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
