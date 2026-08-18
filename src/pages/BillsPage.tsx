import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Eye, Play, CreditCard, CheckCircle2, Info } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/currency";
import { computeBillStatus, BILL_STATUS_BADGE, type BillStatus } from "@/lib/billStatus";
import { useSupplierBills, useCreateSupplierBill } from "@/hooks/useProcurement";
import { usePostSupplierBill } from "@/hooks/useAPModule";
import { useVendorsWithBalance } from "@/hooks/useSubledgerData";
import { useAccounts } from "@/hooks/useData";
import PayBillsDialog from "@/components/ap/PayBillsDialog";
import { toast } from "sonner";
import AccountCombobox from "@/components/shared/AccountCombobox";
import { formatDate } from "@/lib/format";

interface BillLineInput { account_id?: string; description?: string; qty: number; unit_cost: number }

export default function BillsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get("filter") === "unpaid" ? "posted" : "all";

  const { data: allBills, isLoading } = useSupplierBills();
  const { data: vendors } = useVendorsWithBalance();
  const { data: accounts } = useAccounts();
  const postBill = usePostSupplierBill();
  const createBill = useCreateSupplierBill();

  const [statusFilter, setStatusFilter] = useState<BillStatus | "all">(initialFilter as BillStatus | "all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [newBillOpen, setNewBillOpen] = useState(false);
  const [payDialog, setPayDialog] = useState<{ vendorId: string; vendorName: string; billId: string } | null>(null);

  // New bill form state
  const [nbVendorId, setNbVendorId] = useState("");
  const [nbBillDate, setNbBillDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [nbDueDate, setNbDueDate] = useState("");
  const [nbVendorRef, setNbVendorRef] = useState("");
  const [nbTax, setNbTax] = useState("0");
  const [nbNotes, setNbNotes] = useState("");
  const [nbLines, setNbLines] = useState<BillLineInput[]>([{ qty: 1, unit_cost: 0 }]);

  const expenseAccounts = useMemo(() =>
    (accounts as any[] ?? []).filter((a) => a.is_active && (a.account_type === "Expense" || a.account_type === "Asset")),
    [accounts]
  );

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

  const resetNewBillForm = () => {
    setNbVendorId(""); setNbBillDate(format(new Date(), "yyyy-MM-dd"));
    setNbDueDate(""); setNbVendorRef(""); setNbTax("0"); setNbNotes("");
    setNbLines([{ qty: 1, unit_cost: 0 }]);
  };

  const updateLine = (i: number, patch: Partial<BillLineInput>) =>
    setNbLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const subtotal = nbLines.reduce((s, l) => s + (l.qty || 0) * (l.unit_cost || 0), 0);
  const total = subtotal + (parseFloat(nbTax) || 0);

  const handleCreateDraft = async () => {
    if (!nbVendorId) { toast.error("Select a vendor"); return; }
    const validLines = nbLines.filter((l) => l.qty > 0 && l.unit_cost > 0 && l.account_id);
    if (validLines.length === 0) { toast.error("Add at least one valid line with an account"); return; }
    await createBill.mutateAsync({
      vendor_id: nbVendorId,
      bill_date: nbBillDate,
      due_date: nbDueDate || undefined,
      vendor_ref: nbVendorRef || undefined,
      tax_amount: parseFloat(nbTax) || 0,
      notes: nbNotes || undefined,
      lines: validLines,
    });
    resetNewBillForm();
    setNewBillOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Supplier Bills</h1>
          <p className="text-sm text-muted-foreground">Manage all supplier invoices and payments</p>
        </div>
        <Button onClick={() => setNewBillOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Bill
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
                  {(["draft", "posted", "partial", "paid", "overdue"] as BillStatus[]).map((s) => (
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
                  <TableHead className="w-28">Actions</TableHead>
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
                      <TableCell className="text-muted-foreground text-sm">{bill.due_date || "—"}</TableCell>
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
                            title="View vendor"
                            onClick={() => navigate(`/accounting/vendors/${bill.vendor_id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {bill.computed_status === "draft" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Post bill"
                              disabled={postBill.isPending}
                              onClick={() => postBill.mutate(bill.id)}
                            >
                              <Play className="w-4 h-4" />
                            </Button>
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

      {/* New Expense Bill Dialog */}
      <Dialog open={newBillOpen} onOpenChange={(v) => { setNewBillOpen(v); if (!v) resetNewBillForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Expense Bill</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Info banner */}
            <Alert className="border-blue-200 bg-blue-50 text-blue-900">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-sm">
                This form is for <strong>direct expense bills</strong> (e.g. rent, utilities, services).
                For inventory purchases received via a GRN, create bills from{" "}
                <strong>Procurement &amp; Inventory → Goods Receipts → Create Bill</strong>.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Vendor *</Label>
                <Select value={nbVendorId} onValueChange={setNbVendorId}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {(vendors ?? []).map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vendor Reference</Label>
                <Input placeholder="Vendor invoice #" value={nbVendorRef} onChange={(e) => setNbVendorRef(e.target.value)} />
              </div>
              <div>
                <Label>Bill Date *</Label>
                <Input type="date" value={nbBillDate} onChange={(e) => setNbBillDate(e.target.value)} />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={nbDueDate} onChange={(e) => setNbDueDate(e.target.value)} />
              </div>
            </div>

            {/* Bill Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Bill Lines</Label>
                <Button size="sm" variant="outline" onClick={() => setNbLines((ls) => [...ls, { qty: 1, unit_cost: 0 }])}>
                  <Plus className="w-3 h-3 mr-1" /> Add Line
                </Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-20">Qty</TableHead>
                      <TableHead className="w-28">Unit Cost</TableHead>
                      <TableHead className="text-right w-28">Total</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nbLines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <AccountCombobox
                            options={expenseAccounts}
                            value={line.account_id ?? ""}
                            onChange={(v) => updateLine(i, { account_id: v })}
                            placeholder="Select"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input className="h-8" placeholder="Description" value={line.description ?? ""} onChange={(e) => updateLine(i, { description: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-8" type="number" min="0" step="1" value={line.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-8" type="number" min="0" step="0.01" value={line.unit_cost} onChange={(e) => updateLine(i, { unit_cost: parseFloat(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{formatCurrency(line.qty * line.unit_cost)}</TableCell>
                        <TableCell>
                          {nbLines.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setNbLines((ls) => ls.filter((_, idx) => idx !== i))}>
                              ×
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Notes</Label>
                <Input placeholder="Internal notes" value={nbNotes} onChange={(e) => setNbNotes(e.target.value)} />
              </div>
              <div>
                <Label>Tax Amount</Label>
                <Input type="number" min="0" step="0.01" value={nbTax} onChange={(e) => setNbTax(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
              <span className="font-medium">Total</span>
              <span className="text-xl font-bold">{formatCurrency(total)}</span>
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { setNewBillOpen(false); resetNewBillForm(); }}>Cancel</Button>
              <Button
                onClick={handleCreateDraft}
                disabled={createBill.isPending || !nbVendorId}
              >
                {createBill.isPending ? "Saving…" : "Save as Draft"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
