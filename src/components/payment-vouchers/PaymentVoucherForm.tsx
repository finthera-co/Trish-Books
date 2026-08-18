import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, Trash2, AlertCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useCustomers } from "@/hooks/useData";
import {
  useCreatePaymentVoucher,
  useUpdatePaymentVoucher,
  usePaymentVoucher,
  VoucherLine,
} from "@/hooks/usePaymentVouchers";
import AccountSelector from "@/components/shared/AccountSelector";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Cheque", "Credit Card"];

// Account-type rules — must mirror the server-side `create_payment_voucher` RPC.
const PAYMENT_ACCOUNT_TYPES = ["Asset"];
const LINE_ACCOUNT_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense", "Liability"];

interface Props {
  editId: string | null;
  onClose: () => void;
}

export default function PaymentVoucherForm({ editId, onClose }: Props) {
  const { data: customers } = useCustomers();
  const { data: existing } = usePaymentVoucher(editId || undefined);
  const createMutation = useCreatePaymentVoucher();
  const updateMutation = useUpdatePaymentVoucher();

  const [accountNumber, setAccountNumber] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [memo, setMemo] = useState("");
  const [billsAttached, setBillsAttached] = useState(0);
  const [approvedBy, setApprovedBy] = useState("");
  const [accountant, setAccountant] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [madeBy, setMadeBy] = useState("");
  const [lines, setLines] = useState<VoucherLine[]>([{ account_id: "", description: "", amount: 0 }]);
  const [showConfirm, setShowConfirm] = useState(false);

  const isPosted = existing?.status === "posted";

  useEffect(() => {
    if (existing && editId) {
      setAccountNumber(existing.account_number || "");
      setChequeNumber(existing.cheque_number || "");
      setPayeeId(existing.payee_id || "");
      setPaymentAccountId(existing.payment_account_id);
      setPaymentMethod(existing.payment_method);
      setReferenceNumber(existing.reference_number || "");
      setPaymentDate(new Date(existing.payment_date));
      setMemo(existing.memo || "");
      setBillsAttached(existing.bills_attached || 0);
      setApprovedBy(existing.approved_by || "");
      setAccountant(existing.accountant || "");
      setCheckedBy(existing.checked_by || "");
      setMadeBy(existing.made_by || "");
      const ln = (existing as { payment_voucher_lines?: Array<{ id: string; account_id: string; description: string | null; amount: number }> }).payment_voucher_lines;
      if (ln?.length) {
        setLines(
          ln.map((l) => ({
            id: l.id,
            account_id: l.account_id,
            description: l.description || "",
            amount: Number(l.amount),
          }))
        );
      }
    }
  }, [existing, editId]);

  // Server rounds to 2dp; mirror that for display.
  const totalAmount = useMemo(
    () => Math.round(lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) * 100) / 100,
    [lines]
  );

  // ----- Validation (mirrors server rules so submit is gated client-side too) -----
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!paymentAccountId) errs.paymentAccount = "Payment account is required";
    if (!paymentDate) errs.paymentDate = "Payment date is required";
    if (lines.length === 0) errs.lines = "At least one line is required";

    lines.forEach((l, idx) => {
      if (!l.account_id) errs[`line-${idx}-account`] = "Account is required";
      if (l.account_id && l.account_id === paymentAccountId)
        errs[`line-${idx}-account`] = "Cannot match the payment account";
      const amt = Number(l.amount);
      if (!amt || amt <= 0) errs[`line-${idx}-amount`] = "Amount must be > 0";
      if (amt && Math.round(amt * 100) / 100 !== amt)
        errs[`line-${idx}-amount`] = "Max 2 decimal places";
    });

    if (totalAmount <= 0) errs.total = "Total must be greater than zero";
    return errs;
  }, [paymentAccountId, paymentDate, lines, totalAmount]);

  const isValid = Object.keys(errors).length === 0;

  const addLine = () => setLines([...lines, { account_id: "", description: "", amount: 0 }]);

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof VoucherLine, value: string | number) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const handleAttemptSubmit = () => {
    if (!isValid) {
      const first = Object.values(errors)[0];
      toast.error(first || "Please fix validation errors");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmedSubmit = () => {
    setShowConfirm(false);
    const formData = {
      account_number: accountNumber,
      cheque_number: chequeNumber,
      payee_id: payeeId || undefined,
      payment_account_id: paymentAccountId,
      payment_method: paymentMethod,
      reference_number: referenceNumber,
      payment_date: format(paymentDate, "yyyy-MM-dd"),
      memo,
      bills_attached: billsAttached,
      approved_by: approvedBy,
      accountant,
      checked_by: checkedBy,
      made_by: madeBy,
      lines: lines.map((l) => ({
        ...l,
        amount: Math.round(Number(l.amount) * 100) / 100,
      })),
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...formData }, { onSuccess: onClose });
    } else {
      createMutation.mutate(formData, { onSuccess: onClose });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {isPosted && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
          <div>
            This voucher is <strong>posted</strong> and immutable. Create a reversal to make adjustments.
          </div>
        </div>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Payee / Vendor</Label>
          <Select value={payeeId} onValueChange={setPayeeId} disabled={isPosted}>
            <SelectTrigger><SelectValue placeholder="Select payee" /></SelectTrigger>
            <SelectContent>
              {customers?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Payment Account *</Label>
          <AccountSelector
            value={paymentAccountId}
            onChange={(v) => setPaymentAccountId(v)}
            types={PAYMENT_ACCOUNT_TYPES}
            placeholder="Search cash / bank account…"
            disabled={isPosted}
          />
          <p className="text-xs text-muted-foreground mt-1">Cash or Bank assets only</p>
        </div>
        <div>
          <Label>Payment Method</Label>
          <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={isPosted}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Payment Date *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={isPosted}
                className={cn("w-full justify-start text-left font-normal", !paymentDate && "text-muted-foreground")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {paymentDate ? formatDate(paymentDate) : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>Account Number</Label>
          <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account #" disabled={isPosted} />
        </div>
        <div>
          <Label>Cheque Number</Label>
          <Input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} placeholder="Cheque #" disabled={isPosted} />
        </div>
        <div>
          <Label>Reference Number</Label>
          <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Reference (must be unique)" disabled={isPosted} />
        </div>
        <div>
          <Label>Bills Attached</Label>
          <Input type="number" min={0} value={billsAttached} onChange={(e) => setBillsAttached(parseInt(e.target.value) || 0)} disabled={isPosted} />
        </div>
      </div>

      <div>
        <Label>Memo</Label>
        <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional notes..." rows={2} disabled={isPosted} />
      </div>

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Expense / Liability Lines</Label>
          <Button variant="outline" size="sm" onClick={addLine} disabled={isPosted}>
            <Plus className="w-4 h-4 mr-1" /> Add Row
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Category (Account)</TableHead>
              <TableHead className="w-[35%]">Description</TableHead>
              <TableHead className="w-[20%] text-right">Amount</TableHead>
              <TableHead className="w-[5%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, idx) => {
              const accErr = errors[`line-${idx}-account`];
              const amtErr = errors[`line-${idx}-amount`];
              const rowInvalid = !!accErr || !!amtErr;
              return (
                <TableRow key={idx} className={rowInvalid ? "bg-destructive/5" : undefined}>
                  <TableCell>
                    <AccountSelector
                      value={line.account_id}
                      onChange={(v) => updateLine(idx, "account_id", v)}
                      types={LINE_ACCOUNT_TYPES}
                      placeholder="Search expense / liability…"
                      disabled={isPosted}
                    />
                    {accErr && <p className="text-xs text-destructive mt-1">{accErr}</p>}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.description}
                      onChange={(e) => updateLine(idx, "description", e.target.value)}
                      placeholder="Description"
                      disabled={isPosted}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="text-right"
                      value={line.amount || ""}
                      onChange={(e) => updateLine(idx, "amount", parseFloat(e.target.value) || 0)}
                      disabled={isPosted}
                    />
                    {amtErr && <p className="text-xs text-destructive mt-1">{amtErr}</p>}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1 || isPosted}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={2} className="text-right font-semibold">Total Amount:</TableCell>
              <TableCell className="text-right font-mono font-bold text-lg">{formatCurrency(totalAmount)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Budget Warnings */}
      {lines.filter((l) => l.account_id && l.amount > 0).map((line, idx) => (
        <BudgetWarningBanner
          key={`budget-pv-${idx}-${line.account_id}`}
          accountId={line.account_id}
          amount={line.amount}
          transactionDate={format(paymentDate, "yyyy-MM-dd")}
        />
      ))}

      {/* Approval fields */}
      <div>
        <Label className="text-base font-semibold mb-2 block">Approval Details</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Made By</Label>
            <Input value={madeBy} onChange={(e) => setMadeBy(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Checked By</Label>
            <Input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Accountant</Label>
            <Input value={accountant} onChange={(e) => setAccountant(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Approved By</Label>
            <Input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} disabled={isPosted} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleAttemptSubmit} disabled={isPending || !isValid || isPosted}>
          {isPending ? "Saving..." : editId ? "Update Voucher" : "Create & Post Voucher"}
        </Button>
      </div>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Payment Voucher?</AlertDialogTitle>
            <AlertDialogDescription>
              Total <strong>{formatCurrency(totalAmount)}</strong> will be posted to the ledger as a balanced
              journal entry. Once posted, this voucher becomes immutable — only a reversal can adjust it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedSubmit}>Post Voucher</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
