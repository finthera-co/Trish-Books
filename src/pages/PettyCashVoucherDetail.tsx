import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, XCircle, Clock, Send, Printer, RotateCcw, Upload, FileImage, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { formatCurrency } from "@/lib/currency";
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
  const canManage = canEdit("banking");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      </div>

      {/* ─── PRINTABLE VOUCHER ─── */}
      <div className="print:p-0" id="voucher-print">
        {/* Print header */}
        <div className="hidden print:block text-center mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-wider">Petty Cash Voucher</h1>
          <p className="text-sm text-muted-foreground mt-1">Voucher No: {voucher.voucher_number}</p>
        </div>

        <Card className="print:shadow-none print:border">
          <CardHeader className="print:pb-2">
            <CardTitle className="text-base print:text-lg">Voucher Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Date</span>
                <p className="font-medium">{new Date(voucher.date).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Paid To</span>
                <p className="font-medium">{voucher.paid_to || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Account</span>
                <p className="font-medium">{voucher.petty_cash_accounts?.account_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total</span>
                <p className="font-bold text-lg">{formatCurrency(voucher.total_amount)}</p>
              </div>
            </div>

            <Separator className="my-4" />

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Prepared By</span>
                <p className="font-medium">
                  {(voucher as any).prepared_user
                    ? `${(voucher as any).prepared_user.first_name} ${(voucher as any).prepared_user.last_name}`
                    : "—"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Authorized By</span>
                <p className="font-medium">
                  {(voucher as any).authorized_user
                    ? `${(voucher as any).authorized_user.first_name} ${(voucher as any).authorized_user.last_name}`
                    : "—"}
                </p>
              </div>
              {voucher.approved_at && (
                <div>
                  <span className="text-muted-foreground">Approved At</span>
                  <p className="font-medium">{new Date(voucher.approved_at).toLocaleString()}</p>
                </div>
              )}
              {voucher.journal_entry_id && (
                <div className="print:hidden">
                  <span className="text-muted-foreground">Journal Entry</span>
                  <p className="font-medium text-primary cursor-pointer" onClick={() => navigate("/accounting/journals")}>
                    View Entry →
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Lines */}
        <Card className="print:shadow-none print:border mt-4">
          <CardHeader className="print:pb-2">
            <CardTitle className="text-base">Expense Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="bg-muted print:bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left w-12">S.No</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines?.map((line: any, idx: number) => (
                  <tr key={line.id} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2">{new Date(line.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{line.description || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{line.accounts?.account_code} – {line.accounts?.account_name}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 print:bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 text-right font-semibold">Total</td>
                  <td className="px-3 py-2 text-right font-bold">{formatCurrency(voucher.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        {/* Signature block — visible in print */}
        <div className="hidden print:grid grid-cols-3 gap-8 mt-12 text-sm">
          <div className="text-center">
            <div className="border-t border-foreground pt-2 mt-12">Prepared By</div>
          </div>
          <div className="text-center">
            <div className="border-t border-foreground pt-2 mt-12">Authorized By</div>
          </div>
          <div className="text-center">
            <div className="border-t border-foreground pt-2 mt-12">Received By</div>
          </div>
        </div>
      </div>

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
