import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useAccounts, useCustomers } from "@/hooks/useData";
import { useCreatePaymentVoucher, useUpdatePaymentVoucher, usePaymentVoucher, VoucherLine } from "@/hooks/usePaymentVouchers";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Cheque", "Credit Card"];

interface Props {
  editId: string | null;
  onClose: () => void;
}

export default function PaymentVoucherForm({ editId, onClose }: Props) {
  const { data: accounts } = useAccounts();
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

  // Payment accounts: Cash, Bank type accounts
  const paymentAccounts = accounts?.filter((a) =>
    a.is_active && ["Asset"].includes(a.account_type) &&
    (a.account_name.toLowerCase().includes("cash") ||
     a.account_name.toLowerCase().includes("bank") ||
     a.account_name.toLowerCase().includes("credit card"))
  ) || [];

  // Expense/liability accounts for line items
  const lineAccounts = accounts?.filter((a) => a.is_active) || [];

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
      if ((existing as any).payment_voucher_lines?.length) {
        setLines(
          (existing as any).payment_voucher_lines.map((l: any) => ({
            id: l.id,
            account_id: l.account_id,
            description: l.description || "",
            amount: Number(l.amount),
          }))
        );
      }
    }
  }, [existing, editId]);

  const totalAmount = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  const addLine = () => setLines([...lines, { account_id: "", description: "", amount: 0 }]);

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof VoucherLine, value: any) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const handleSubmit = () => {
    if (!paymentAccountId) return toast.error("Payment account is required");
    if (lines.some((l) => !l.account_id)) return toast.error("All lines must have a category/account");
    if (lines.some((l) => !l.amount || l.amount <= 0)) return toast.error("All line amounts must be greater than zero");
    if (totalAmount <= 0) return toast.error("Total must be greater than zero");

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
      lines,
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
      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Payee / Vendor</Label>
          <Select value={payeeId} onValueChange={setPayeeId}>
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
          <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {paymentAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Payment Method</Label>
          <Select value={paymentMethod} onValueChange={setPaymentMethod}>
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
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !paymentDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {paymentDate ? format(paymentDate, "PPP") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>Account Number</Label>
          <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account #" />
        </div>
        <div>
          <Label>Cheque Number</Label>
          <Input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} placeholder="Cheque #" />
        </div>
        <div>
          <Label>Reference Number</Label>
          <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Reference" />
        </div>
        <div>
          <Label>Bills Attached</Label>
          <Input type="number" min={0} value={billsAttached} onChange={(e) => setBillsAttached(parseInt(e.target.value) || 0)} />
        </div>
      </div>

      <div>
        <Label>Memo</Label>
        <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional notes..." rows={2} />
      </div>

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Expense / Account Lines</Label>
          <Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4 mr-1" /> Add Row</Button>
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
            {lines.map((line, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  <Select value={line.account_id} onValueChange={(v) => updateLine(idx, "account_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {lineAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} placeholder="Description" />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} step="0.01" className="text-right" value={line.amount || ""} onChange={(e) => updateLine(idx, "amount", parseFloat(e.target.value) || 0)} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={2} className="text-right font-semibold">Total Amount:</TableCell>
              <TableCell className="text-right font-mono font-bold text-lg">{formatCurrency(totalAmount)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Approval fields */}
      <div>
        <Label className="text-base font-semibold mb-2 block">Approval Details</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Made By</Label>
            <Input value={madeBy} onChange={(e) => setMadeBy(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Checked By</Label>
            <Input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Accountant</Label>
            <Input value={accountant} onChange={(e) => setAccountant(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Approved By</Label>
            <Input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Saving..." : editId ? "Update Voucher" : "Create Voucher"}
        </Button>
      </div>
    </div>
  );
}
