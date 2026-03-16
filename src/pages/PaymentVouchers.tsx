import { useState } from "react";
import { usePaymentVouchers, useDeletePaymentVoucher } from "@/hooks/usePaymentVouchers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Search, Trash2, Eye, Edit, FileText } from "lucide-react";
import { useMyPermissions } from "@/hooks/usePermissions";
import PaymentVoucherForm from "@/components/payment-vouchers/PaymentVoucherForm";
import PaymentVoucherDetails from "@/components/payment-vouchers/PaymentVoucherDetails";
import { formatCurrency } from "@/lib/currency";

export default function PaymentVouchers() {
  const { data: vouchers, isLoading } = usePaymentVouchers();
  const deleteMutation = useDeletePaymentVoucher();
  const { canEdit: canEditBanking, canDelete: canDeleteBanking } = useMyPermissions();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = vouchers?.filter((v) => {
    const q = search.toLowerCase();
    return (
      v.voucher_number?.toLowerCase().includes(q) ||
      (v.customers as any)?.name?.toLowerCase().includes(q) ||
      v.cheque_number?.toLowerCase().includes(q) ||
      v.reference_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Vouchers</h1>
          <p className="text-sm text-muted-foreground">Manage payment vouchers and track disbursements</p>
        </div>
        {canEditBanking("banking") && <Button onClick={() => { setEditId(null); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" /> New Voucher
        </Button>}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search vouchers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Payment Account</TableHead>
                  <TableHead>Cheque #</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      No payment vouchers found
                    </TableCell>
                  </TableRow>
                )}
                {filtered?.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-medium">{v.voucher_number}</TableCell>
                    <TableCell>{(v.customers as any)?.name || "—"}</TableCell>
                    <TableCell>{v.payment_date}</TableCell>
                    <TableCell>{(v.accounts as any)?.account_name || "—"}</TableCell>
                    <TableCell>{v.cheque_number || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{v.payment_method}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(Number(v.total_amount))}</TableCell>
                    <TableCell>
                      <Badge variant={v.status === "posted" ? "default" : "secondary"}>{v.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setViewId(v.id)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canEditBanking("banking") && <Button variant="ghost" size="icon" onClick={() => { setEditId(v.id); setShowForm(true); }}>
                          <Edit className="w-4 h-4" />
                        </Button>}
                        {canDeleteBanking("banking") && <Button variant="ghost" size="icon" onClick={() => setDeleteId(v.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Payment Voucher" : "Create Payment Voucher"}</DialogTitle>
          </DialogHeader>
          <PaymentVoucherForm
            editId={editId}
            onClose={() => { setShowForm(false); setEditId(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <PaymentVoucherDetails voucherId={viewId} />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment Voucher?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The voucher and its line items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) deleteMutation.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
