import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/paymentMethods";
import { useSupplierBills } from "@/hooks/useProcurement";
import { useRecordBillPayment } from "@/hooks/useAPModule";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useAccounts } from "@/hooks/useData";
import { computeBillStatus } from "@/lib/billStatus";
import AccountCombobox from "@/components/shared/AccountCombobox";
import { toast } from "sonner";

interface VendorGroup {
  vendorId: string;
  vendorName: string;
  bills: any[];
}

function incrementCheckNumber(start: string, offset: number): string {
  if (offset === 0) return start;
  const match = start.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return start;
  const [, prefix, digits, suffix] = match;
  const next = (parseInt(digits, 10) + offset).toString().padStart(digits.length, "0");
  return `${prefix}${next}${suffix}`;
}

export default function PayBillsPage() {
  const { data: allBills, isLoading } = useSupplierBills();
  const { data: accountSettings } = useAccountSettings();
  const { data: accounts } = useAccounts();
  const recordPayment = useRecordBillPayment();

  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("Cheque");
  const [printLater, setPrintLater] = useState(false);
  const [checkNumber, setCheckNumber] = useState("");
  const [reference, setReference] = useState("");
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());
  const [appliedAmounts, setAppliedAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const bankAccounts = useMemo(() =>
    (accounts as any[] ?? []).filter((a) =>
      a.is_active &&
      a.account_type === "Asset" &&
      (a.account_subtype?.toLowerCase().includes("cash") ||
        a.account_subtype?.toLowerCase().includes("bank") ||
        a.account_subtype?.toLowerCase().includes("checking") ||
        a.account_subtype?.toLowerCase().includes("savings"))
    ),
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

  const openBills = useMemo(
    () => bills.filter((b) => b.balance_due > 0.005 && ["posted", "partial", "overdue"].includes(b.computed_status)),
    [bills]
  );

  const vendorGroups: VendorGroup[] = useMemo(() => {
    const map = new Map<string, VendorGroup>();
    for (const b of openBills) {
      const vid = b.vendor_id;
      if (!map.has(vid)) {
        map.set(vid, { vendorId: vid, vendorName: b.vendor?.name ?? "Unknown", bills: [] });
      }
      map.get(vid)!.bills.push(b);
    }
    return Array.from(map.values()).sort((a, z) => a.vendorName.localeCompare(z.vendorName));
  }, [openBills]);

  const totalOutstanding = openBills.reduce((s, b) => s + b.balance_due, 0);
  const totalOverdue = openBills.filter((b) => b.computed_status === "overdue").reduce((s, b) => s + b.balance_due, 0);

  const totalApplied = useMemo(
    () => Array.from(selectedBillIds).reduce((s, id) => s + (parseFloat(appliedAmounts[id] || "0") || 0), 0),
    [selectedBillIds, appliedAmounts]
  );

  const toggleBill = (bill: any) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(bill.id)) {
        next.delete(bill.id);
        setAppliedAmounts((a) => { const n = { ...a }; delete n[bill.id]; return n; });
      } else {
        next.add(bill.id);
        setAppliedAmounts((a) => ({ ...a, [bill.id]: bill.balance_due.toFixed(2) }));
      }
      return next;
    });
  };

  const toggleVendorAll = (group: VendorGroup) => {
    const allSelected = group.bills.every((b) => selectedBillIds.has(b.id));
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      group.bills.forEach((b) => {
        if (allSelected) next.delete(b.id);
        else next.add(b.id);
      });
      return next;
    });
    setAppliedAmounts((a) => {
      const n = { ...a };
      group.bills.forEach((b) => {
        if (allSelected) delete n[b.id];
        else n[b.id] = b.balance_due.toFixed(2);
      });
      return n;
    });
  };

  const resetSelection = () => {
    setSelectedBillIds(new Set());
    setAppliedAmounts({});
    setReference("");
    setPrintLater(false);
    setCheckNumber("");
  };

  const handlePayAll = async () => {
    const apAccountId = accountSettings?.ap_account_id;
    if (!apAccountId) { toast.error("AP control account not configured. Set it in Settings → Account Mapping."); return; }
    if (!bankAccountId) { toast.error("Select a bank / cash account"); return; }
    if (selectedBillIds.size === 0) { toast.error("Select at least one bill"); return; }
    if (totalApplied <= 0) { toast.error("Total being paid must be greater than zero"); return; }
    if (paymentMethod === "Cheque" && !printLater && !checkNumber.trim()) {
      toast.error("Enter a starting check number, or check \"Print Later\"");
      return;
    }

    const groupsToPay = vendorGroups
      .map((g) => ({
        ...g,
        allocations: g.bills
          .filter((b) => selectedBillIds.has(b.id))
          .map((b) => ({ bill_id: b.id, amount_applied: parseFloat(appliedAmounts[b.id] || "0") || 0 }))
          .filter((a) => a.amount_applied > 0),
      }))
      .filter((g) => g.allocations.length > 0);

    for (const g of groupsToPay) {
      for (const alloc of g.allocations) {
        const bill = g.bills.find((b) => b.id === alloc.bill_id);
        if (bill && alloc.amount_applied > bill.balance_due + 0.005) {
          toast.error(`Amount for bill ${bill.bill_number} exceeds balance due`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      for (let i = 0; i < groupsToPay.length; i++) {
        const g = groupsToPay[i];
        const vendorTotal = g.allocations.reduce((s, a) => s + a.amount_applied, 0);
        await recordPayment.mutateAsync({
          vendor_id: g.vendorId,
          payment_date: paymentDate,
          amount: vendorTotal,
          bank_account_id: bankAccountId,
          ap_account_id: apAccountId,
          reference: reference || undefined,
          allocations: g.allocations,
          payment_method: paymentMethod,
          print_later: paymentMethod === "Cheque" ? printLater : false,
          check_number:
            paymentMethod === "Cheque" && !printLater ? incrementCheckNumber(checkNumber.trim(), i) : null,
        });
      }
      toast.success(`Paid ${groupsToPay.length} vendor${groupsToPay.length !== 1 ? "s" : ""} — ${formatCurrency(totalApplied)} total`);
      resetSelection();
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pay Bills</h1>
        <p className="text-sm text-muted-foreground">
          Select bills from any vendor below and settle them together in one batch payment run.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Outstanding</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalOverdue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Vendors with Open Bills</p>
            <p className="text-2xl font-bold">{vendorGroups.length}</p>
          </CardContent>
        </Card>
      </div>

      {vendorGroups.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="text-lg font-medium">All caught up!</p>
            <p className="text-sm">No outstanding supplier bills.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label>Payment Date *</Label>
                  <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                </div>
                <div>
                  <Label>Bank / Cash Account *</Label>
                  <AccountCombobox options={bankAccounts} value={bankAccountId} onChange={setBankAccountId} placeholder="Select account" />
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input placeholder="Transfer ref, memo…" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>

              {paymentMethod === "Cheque" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end p-3 rounded-lg border bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Checkbox id="pb-print-later" checked={printLater} onCheckedChange={(v) => setPrintLater(!!v)} />
                    <Label htmlFor="pb-print-later" className="cursor-pointer font-normal">Print Later</Label>
                  </div>
                  {!printLater && (
                    <div>
                      <Label>Starting Check Number *</Label>
                      <Input placeholder="e.g. 1001" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
                      <p className="text-xs text-muted-foreground mt-1">
                        Each vendor paid in this run gets the next check number in sequence.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Select Bills to Pay</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Withholding tax (AIT), if applicable, is calculated per vendor automatically when you submit.
                </AlertDescription>
              </Alert>

              {vendorGroups.map((group) => {
                const groupSelectedTotal = group.bills.reduce(
                  (s, b) => s + (selectedBillIds.has(b.id) ? parseFloat(appliedAmounts[b.id] || "0") || 0 : 0),
                  0
                );
                const allSelected = group.bills.every((b) => selectedBillIds.has(b.id));
                return (
                  <div key={group.vendorId} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-muted/40">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={allSelected} onCheckedChange={() => toggleVendorAll(group)} />
                        <span className="font-semibold">{group.vendorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {group.bills.length} open bill{group.bills.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {groupSelectedTotal > 0 && (
                        <span className="text-sm font-mono font-semibold text-primary">
                          {formatCurrency(groupSelectedTotal)} selected
                        </span>
                      )}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Bill #</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Amount Due</TableHead>
                          <TableHead className="text-right w-40">Amount to Apply</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.bills.map((bill) => {
                          const isSelected = selectedBillIds.has(bill.id);
                          const isOverdue = bill.computed_status === "overdue";
                          return (
                            <TableRow key={bill.id} className={isSelected ? "bg-primary/5" : ""}>
                              <TableCell>
                                <Checkbox checked={isSelected} onCheckedChange={() => toggleBill(bill)} />
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {bill.bill_number}
                                {isOverdue && <Badge variant="destructive" className="ml-2 text-xs">Overdue</Badge>}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {bill.due_date ? formatDate(bill.due_date) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(bill.balance_due)}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={bill.balance_due}
                                  className="w-32 text-right ml-auto"
                                  value={isSelected ? (appliedAmounts[bill.id] ?? "") : ""}
                                  disabled={!isSelected}
                                  onChange={(e) => setAppliedAmounts((a) => ({ ...a, [bill.id]: e.target.value }))}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
                <span className="font-medium">Total Being Paid</span>
                <span className="text-xl font-bold text-primary">{formatCurrency(totalApplied)}</span>
              </div>

              <div className="flex justify-end">
                <Button onClick={handlePayAll} disabled={submitting || selectedBillIds.size === 0 || totalApplied <= 0}>
                  {submitting ? "Posting…" : "Pay Selected Bills"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
