import { useState, useMemo } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useSupplierBillsForVendor, useRecordBillPayment, computeBillPaymentWht } from "@/hooks/useAPModule";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import AccountCombobox from "@/components/shared/AccountCombobox";
import { formatDate } from "@/lib/format";

const NATURES = ["service_fee", "rent", "interest", "dividend", "royalty", "contractor", "other"];
const prettify = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  preselectedBillId?: string;
}

export default function PayBillsDialog({ open, onOpenChange, vendorId, vendorName, preselectedBillId }: Props) {
  const { appUser } = useAuth();
  const { data: bills } = useSupplierBillsForVendor(vendorId);
  const { data: accountSettings } = useAccountSettings();
  const { data: accounts } = useAccounts();
  const recordPayment = useRecordBillPayment();

  const today = format(new Date(), "yyyy-MM-dd");
  const [paymentDate, setPaymentDate] = useState(today);
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [paymentNature, setPaymentNature] = useState("");
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [appliedAmounts, setAppliedAmounts] = useState<Record<string, string>>({});
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(
    preselectedBillId ? new Set([preselectedBillId]) : new Set()
  );

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

  const openBills = useMemo(() =>
    (bills ?? []).filter((b) => b.balance_due > 0.005 && b.status !== "draft"),
    [bills]
  );

  const totalOutstanding = openBills.reduce((s, b) => s + b.balance_due, 0);

  const totalApplied = useMemo(() =>
    Array.from(selectedBillIds).reduce((s, id) => s + (parseFloat(appliedAmounts[id] || "0") || 0), 0),
    [selectedBillIds, appliedAmounts]
  );

  // Live WHT (AIT) preview — recomputed by the shared engine. Display-only;
  // the hook recomputes server-side on submit. Disabled while overriding.
  const { data: whtPreview } = useQuery({
    queryKey: ["wht_preview", appUser?.tenant_id, vendorId, totalApplied, paymentDate, paymentNature],
    enabled: !!appUser?.tenant_id && totalApplied > 0 && !overrideOn,
    queryFn: () => computeBillPaymentWht({
      tenantId: appUser!.tenant_id,
      vendorId,
      amount: totalApplied,
      paymentDate,
      paymentNature: paymentNature || undefined,
    }),
  });

  const effectiveWht = overrideOn ? (parseFloat(overrideAmount || "0") || 0) : (whtPreview?.amount ?? 0);
  const netBank = Math.round((totalApplied - effectiveWht) * 100) / 100;

  const toggleBill = (billId: string) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
        setAppliedAmounts((a) => { const n = { ...a }; delete n[billId]; return n; });
      } else {
        next.add(billId);
        const bill = openBills.find((b) => b.id === billId);
        if (bill) {
          setAppliedAmounts((a) => ({ ...a, [billId]: bill.balance_due.toFixed(2) }));
        }
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    const apAccountId = accountSettings?.ap_account_id;
    if (!apAccountId) { toast.error("AP control account not configured. Set it in Settings → Account Mapping."); return; }
    if (!bankAccountId) { toast.error("Select a bank account"); return; }
    if (selectedBillIds.size === 0) { toast.error("Select at least one bill"); return; }
    if (totalApplied <= 0) { toast.error("Total applied must be greater than zero"); return; }

    const allocations = Array.from(selectedBillIds)
      .map((id) => ({ bill_id: id, amount_applied: parseFloat(appliedAmounts[id] || "0") || 0 }))
      .filter((a) => a.amount_applied > 0);

    if (allocations.length === 0) { toast.error("Enter amounts to apply"); return; }

    // Validate each allocation ≤ bill balance_due
    for (const alloc of allocations) {
      const bill = openBills.find((b) => b.id === alloc.bill_id);
      if (bill && alloc.amount_applied > bill.balance_due + 0.005) {
        toast.error(`Amount for bill ${bill.bill_number} exceeds balance due`);
        return;
      }
    }

    if (overrideOn && !overrideReason.trim()) {
      toast.error("A reason is required to override the computed WHT");
      return;
    }

    await recordPayment.mutateAsync({
      vendor_id: vendorId,
      payment_date: paymentDate,
      amount: totalApplied,
      bank_account_id: bankAccountId,
      ap_account_id: apAccountId,
      reference: reference || undefined,
      allocations,
      payment_nature: paymentNature || undefined,
      wht_override: overrideOn
        ? { amount: parseFloat(overrideAmount || "0") || 0, reason: overrideReason.trim() }
        : null,
    });

    setAppliedAmounts({});
    setSelectedBillIds(new Set());
    setReference("");
    setPaymentNature("");
    setOverrideOn(false);
    setOverrideAmount("");
    setOverrideReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pay Bills — {vendorName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
            <span className="text-sm text-muted-foreground">Total outstanding</span>
            <span className="text-lg font-bold">{formatCurrency(totalOutstanding)}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Payment Date *</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <Label>Bank / Cash Account *</Label>
              <AccountCombobox
                options={bankAccounts}
                value={bankAccountId}
                onChange={setBankAccountId}
                placeholder="Select account"
              />
            </div>
          </div>

          <div>
            <Label>Reference</Label>
            <Input placeholder="Cheque no., transfer ref…" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>

          <div>
            <Label className="mb-2 block">Open Bills</Label>
            {openBills.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No open bills for this vendor.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Amount Due</TableHead>
                    <TableHead className="text-right">Amount to Apply</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openBills.map((bill) => {
                    const isSelected = selectedBillIds.has(bill.id);
                    const isOverdue = bill.due_date && new Date(bill.due_date) < new Date();
                    return (
                      <TableRow key={bill.id} className={isSelected ? "bg-primary/5" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleBill(bill.id)}
                          />
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
            )}
          </div>

          {/* Payment nature drives WHT rule selection */}
          <div>
            <Label>Payment Nature (for WHT)</Label>
            <Select value={paymentNature || "auto"} onValueChange={(v) => setPaymentNature(v === "auto" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Use vendor default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Use vendor default</SelectItem>
                {NATURES.map((n) => <SelectItem key={n} value={n}>{prettify(n)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* WHT computed panel: Gross / WHT / Net bank */}
          {(effectiveWht > 0 || overrideOn) && (
            <div className="p-3 rounded-lg border bg-muted/30 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Gross settled</span><span className="font-mono">{formatCurrency(totalApplied)}</span></div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  WHT {whtPreview && !overrideOn ? `(${whtPreview.rate}%)` : "(manual)"}
                </span>
                <span className="font-mono text-destructive">-{formatCurrency(effectiveWht)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1">
                <span>Net bank amount</span><span className="font-mono">{formatCurrency(netBank)}</span>
              </div>
              {whtPreview?.certificate_no && !overrideOn && (
                <p className="text-xs text-muted-foreground">WHT certificate {whtPreview.certificate_no} will be issued.</p>
              )}
              <div className="flex items-center justify-between pt-1">
                <Label className="text-xs">Override WHT manually</Label>
                <Switch checked={overrideOn} onCheckedChange={setOverrideOn} />
              </div>
              {overrideOn && (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" step="0.01" min="0" placeholder="WHT amount"
                    value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)} />
                  <Input placeholder="Reason (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
            <span className="font-medium">Total Being Paid</span>
            <span className="text-xl font-bold text-primary">{formatCurrency(totalApplied)}</span>
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={recordPayment.isPending || selectedBillIds.size === 0 || totalApplied <= 0}
            >
              {recordPayment.isPending ? "Posting…" : "Record Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
