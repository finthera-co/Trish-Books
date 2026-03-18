import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, XCircle, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { usePCVoucher, usePCVoucherLines, useUpdateVoucherStatus } from "@/hooks/usePettyCash";
import { useMyPermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/lib/currency";

const statusConfig: Record<string, { color: string; icon: any }> = {
  draft: { color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { color: "bg-warning/10 text-warning", icon: Send },
  approved: { color: "bg-success/10 text-success", icon: CheckCircle },
  rejected: { color: "bg-destructive/10 text-destructive", icon: XCircle },
};

export default function PettyCashVoucherDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: voucher, isLoading } = usePCVoucher(id);
  const { data: lines } = usePCVoucherLines(id);
  const updateStatus = useUpdateVoucherStatus();
  const { canEdit } = useMyPermissions();
  const canManage = canEdit("banking");

  if (isLoading) return <p className="text-center py-12 text-muted-foreground">Loading...</p>;
  if (!voucher) return <p className="text-center py-12 text-muted-foreground">Voucher not found</p>;

  const sc = statusConfig[voucher.status] || statusConfig.draft;
  const StatusIcon = sc.icon;

  const handleStatusChange = (status: string) => {
    updateStatus.mutate({ id: voucher.id, status });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/banking/petty-cash")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold font-mono">{voucher.voucher_number}</h1>
          <p className="text-sm text-muted-foreground">Petty Cash Voucher</p>
        </div>
        <Badge className={sc.color}>
          <StatusIcon className="w-3.5 h-3.5 mr-1" /> {voucher.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voucher Details</CardTitle>
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
              <p className="font-medium">{(voucher as any).prepared_user?.full_name || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Authorized By</span>
              <p className="font-medium">{(voucher as any).authorized_user?.full_name || "—"}</p>
            </div>
            {voucher.approved_at && (
              <div>
                <span className="text-muted-foreground">Approved At</span>
                <p className="font-medium">{new Date(voucher.approved_at).toLocaleString()}</p>
              </div>
            )}
            {voucher.journal_entry_id && (
              <div>
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-muted">
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
              <tr className="border-t bg-muted/50">
                <td colSpan={4} className="px-3 py-2 text-right font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-bold">{formatCurrency(voucher.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* Actions */}
      {canManage && (
        <div className="flex gap-2 justify-end">
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
        </div>
      )}
    </div>
  );
}
