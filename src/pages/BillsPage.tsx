import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Eye, Play, CreditCard, CheckCircle2, Pencil, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/currency";
import { computeBillStatus, BILL_STATUS_BADGE, type BillStatus } from "@/lib/billStatus";
import { useSupplierBills } from "@/hooks/useProcurement";
import { usePostSupplierBill, useVoidSupplierBill } from "@/hooks/useAPModule";
import { useVendorsWithBalance } from "@/hooks/useSubledgerData";
import PayBillsDialog from "@/components/ap/PayBillsDialog";
import { formatDate } from "@/lib/format";

export default function BillsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get("filter") === "unpaid" ? "posted" : "all";

  const { data: allBills, isLoading } = useSupplierBills();
  const { data: vendors } = useVendorsWithBalance();
  const postBill = usePostSupplierBill();
  const voidBill = useVoidSupplierBill();

  const [statusFilter, setStatusFilter] = useState<BillStatus | "all">(initialFilter as BillStatus | "all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [payDialog, setPayDialog] = useState<{ vendorId: string; vendorName: string; billId: string } | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ id: string; bill_number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const bills = useMemo(() => {
    return (allBills ?? []).map((b: any) => ({
      ...b,
      amount_paid: Number(b.amount_paid ?? 0),
      balance_due: Number(b.total_amount) - Number(b.amount_paid ?? 0),
      computed_status: computeBillStatus(b),
    }));
  }, [allBills]);

  const filtered = useMemo(() => {
    return bills.filter((b) => {
      if (statusFilter !== "all" && b.computed_status !== statusFilter) return false;
      if (vendorFilter !== "all" && b.vendor_id !== vendorFilter) return false;
      if (dateFrom && b.bill_date < dateFrom) return false;
      if (dateTo && b.bill_date > dateTo) return false;
      return true;
    });
  }, [bills, statusFilter, vendorFilter, dateFrom, dateTo]);

  const totalOutstanding = bills
    .filter((b) => ["posted", "partial", "overdue"].includes(b.computed_status))
    .reduce((s, b) => s + b.balance_due, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bills</h1>
          <p className="text-sm text-muted-foreground">Manage all supplier bills and payments</p>
        </div>
        <Button onClick={() => navigate("/accounting/bills/new")}>
          <Plus className="w-4 h-4 mr-2" /> Enter Bill
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Bills</p>
            <p className="text-2xl font-bold">{bills.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Outstanding</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold text-destructive">
              {bills.filter((b) => b.computed_status === "overdue").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs mb-1 block">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BillStatus | "all")}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(["draft", "posted", "partial", "paid", "overdue", "voided"] as BillStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{BILL_STATUS_BADGE[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Vendor</Label>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="All vendors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  {(vendors ?? []).map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">From</Label>
              <Input type="date" className="w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">To</Label>
              <Input type="date" className="w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            {(statusFilter !== "all" || vendorFilter !== "all" || dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setVendorFilter("all"); setDateFrom(""); setDateTo(""); }}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bills Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-12 text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No bills match the current filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((bill) => {
                  const { label, variant } = BILL_STATUS_BADGE[bill.computed_status] ?? BILL_STATUS_BADGE.posted;
                  const vendorName = bill.vendor?.name ?? (vendors ?? []).find((v: any) => v.id === bill.vendor_id)?.name ?? "—";
                  return (
                    <TableRow key={bill.id}>
                      <TableCell className="font-mono font-medium">{bill.bill_number}</TableCell>
                      <TableCell>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 font-medium"
                          onClick={() => navigate(`/accounting/vendors/${bill.vendor_id}`)}
                        >
                          {vendorName}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(bill.bill_date)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{bill.due_date ? formatDate(bill.due_date) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(bill.total_amount))}</TableCell>
                      <TableCell className="text-right tabular-nums text-primary">{formatCurrency(bill.amount_paid)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${bill.balance_due > 0.005 ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(bill.balance_due)}
                      </TableCell>
                      <TableCell>
                        {bill.computed_status === "paid" ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge className="bg-green-100 text-green-800 border-green-200 w-fit gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Paid
                            </Badge>
                            <span className="text-xs text-green-700 font-medium">Posted to GL</span>
                          </div>
                        ) : (
                          <Badge variant={variant}>{label}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View bill"
                            onClick={() => navigate(`/accounting/bills/${bill.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {bill.computed_status === "draft" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit draft"
                                onClick={() => navigate(`/accounting/bills/${bill.id}`)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Post bill"
                                disabled={postBill.isPending}
                                onClick={() => postBill.mutate(bill.id)}
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {(bill.computed_status === "posted" || bill.computed_status === "partial" || bill.computed_status === "overdue") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Pay bill"
                              onClick={() => setPayDialog({ vendorId: bill.vendor_id, vendorName, billId: bill.id })}
                            >
                              <CreditCard className="w-4 h-4" />
                            </Button>
                          )}
                          {(bill.computed_status === "posted" || bill.computed_status === "partial" || bill.computed_status === "overdue" || bill.computed_status === "paid") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Void bill"
                              className="text-destructive hover:text-destructive"
                              onClick={() => { setVoidTarget({ id: bill.id, bill_number: bill.bill_number }); setVoidReason(""); }}
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {filtered.length > 0 && (
          <div className="px-6 py-3 border-t flex justify-between text-sm">
            <span className="text-muted-foreground">{filtered.length} bill{filtered.length !== 1 ? "s" : ""}</span>
            <span className="font-semibold">
              Outstanding: <span className="text-destructive">{formatCurrency(filtered.reduce((s, b) => s + (b.balance_due > 0.005 ? b.balance_due : 0), 0))}</span>
            </span>
          </div>
        )}
      </Card>

      {/* Pay Bills Dialog */}
      {payDialog && (
        <PayBillsDialog
          open={!!payDialog}
          onOpenChange={(v) => { if (!v) setPayDialog(null); }}
          vendorId={payDialog.vendorId}
          vendorName={payDialog.vendorName}
          preselectedBillId={payDialog.billId}
        />
      )}

      {/* Void confirmation */}
      <AlertDialog open={!!voidTarget} onOpenChange={(v) => { if (!v) { setVoidTarget(null); setVoidReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void bill {voidTarget?.bill_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts a reversing journal entry and marks the bill voided. If the bill has payments applied,
              void the payment(s) first. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Entered in error" className="mt-1" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={voidBill.isPending}
              onClick={async () => {
                if (!voidTarget) return;
                await voidBill.mutateAsync({ bill_id: voidTarget.id, reason: voidReason.trim() || undefined });
                setVoidTarget(null);
                setVoidReason("");
              }}
            >
              {voidBill.isPending ? "Voiding…" : "Void Bill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
