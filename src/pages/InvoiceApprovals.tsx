import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useApproveInvoice } from "@/hooks/useData";
import { useApprovalQueue, useApprovalLog } from "@/hooks/useApprovals";

const who = (u: any) => u ? ([u.first_name, u.last_name].filter(Boolean).join(" ") || u.email) : "System";

export default function InvoiceApprovals() {
  const navigate = useNavigate();
  const { appUser, isCompanyAdmin } = useAuth();
  const { data: settings } = useAccountSettings();
  const { data: queue } = useApprovalQueue();
  const { data: log } = useApprovalLog();
  const approveInvoice = useApproveInvoice();

  const [rejectRow, setRejectRow] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");

  const appointed = settings?.invoice_approver_ids ?? [];
  const canApprove = appointed.length > 0 ? appointed.includes(appUser?.id ?? "") : isCompanyAdmin;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoice Approvals</h1>
          <p className="text-sm text-muted-foreground">Pending sign-offs and the full approval trail for your company</p>
        </div>
      </div>

      {/* Pending queue */}
      <Card>
        <CardHeader><CardTitle className="text-base">Awaiting approval</CardTitle></CardHeader>
        <CardContent className="p-0">
          {(queue ?? []).filter((q) => q.approval_status === "pending").length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nothing awaiting approval</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Progress</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(queue ?? []).filter((q) => q.approval_status === "pending").map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium cursor-pointer hover:underline" onClick={() => navigate("/sales/invoices")}>{q.invoice_number}</TableCell>
                    <TableCell className="text-muted-foreground">{(q.customers as any)?.name || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(Number(q.total_amount))} {q.currency !== "LKR" ? q.currency : ""}</TableCell>
                    <TableCell><Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">{q.approvals_count ?? 0} of {q.required_approvals || 1}</Badge></TableCell>
                    <TableCell className="text-right">
                      {canApprove ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => approveInvoice.mutate({ id: q.id, decision: "approved" })}>
                            <CheckCircle2 className="w-4 h-4 mr-1 text-green-600" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setRejectRow(q); setRejectReason(""); }}>
                            <XCircle className="w-4 h-4 mr-1 text-destructive" /> Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not an approver</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Full log */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Approval history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {(log ?? []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No approval activity yet</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Action</TableHead>
                <TableHead>By</TableHead><TableHead className="text-right">Amount (LKR)</TableHead><TableHead>Note</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(log ?? []).map((h: any) => {
                  const color = h.action === "approved" ? "text-green-600 dark:text-green-400"
                    : h.action === "rejected" ? "text-destructive" : "text-muted-foreground";
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{new Date(h.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                      <TableCell className="font-medium">{(h.invoices as any)?.invoice_number || "—"}</TableCell>
                      <TableCell className={`capitalize font-medium ${color}`}>{h.action}</TableCell>
                      <TableCell className="text-muted-foreground">{who(h.users)}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.amount_base != null ? formatCurrency(Number(h.amount_base)) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[240px] truncate">{h.note || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={!!rejectRow} onOpenChange={(v) => { if (!v) setRejectRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /> Reject invoice</DialogTitle>
            <DialogDescription>{rejectRow?.invoice_number} — a reason is required.</DialogDescription>
          </DialogHeader>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[90px]"
            placeholder="Reason for rejection…"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectRow(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || approveInvoice.isPending}
              onClick={async () => { await approveInvoice.mutateAsync({ id: rejectRow.id, decision: "rejected", note: rejectReason.trim() }); setRejectRow(null); }}>
              {approveInvoice.isPending ? "Rejecting…" : "Reject invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
