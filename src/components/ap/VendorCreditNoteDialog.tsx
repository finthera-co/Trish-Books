import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateVendorCreditNote } from "@/hooks/useAPModule";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useAccounts } from "@/hooks/useData";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
}

function generateCreditNoteNumber(): string {
  const date = format(new Date(), "yyyyMMdd");
  const rand = Math.floor(Math.random() * 900 + 100);
  return `VCN-${date}-${rand}`;
}

export default function VendorCreditNoteDialog({ open, onOpenChange, vendorId, vendorName }: Props) {
  const createCN = useCreateVendorCreditNote();
  const { data: accountSettings } = useAccountSettings();
  const { data: accounts } = useAccounts();

  const [creditNoteNumber] = useState(generateCreditNoteNumber);
  const [creditDate, setCreditDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");

  const expenseAccounts = useMemo(() =>
    (accounts as any[] ?? []).filter((a) =>
      a.is_active && (a.account_type === "Expense" || a.account_type === "Cost of Goods Sold")
    ),
    [accounts]
  );

  const handleSubmit = async () => {
    const apAccountId = accountSettings?.ap_account_id;
    if (!apAccountId) {
      toast.error("AP control account not configured. Set it in Settings → Account Mapping.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { toast.error("Enter a valid amount"); return; }
    if (!expenseAccountId) { toast.error("Select an expense account"); return; }
    if (!creditDate) { toast.error("Enter a credit date"); return; }

    await createCN.mutateAsync({
      vendor_id: vendorId,
      credit_note_number: creditNoteNumber,
      credit_date: creditDate,
      amount: parsedAmount,
      reason: reason || undefined,
      expense_account_id: expenseAccountId,
      ap_account_id: apAccountId,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Vendor Credit Note — {vendorName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Credit Note #</Label>
              <Input value={creditNoteNumber} readOnly className="bg-muted/30 font-mono text-sm" />
            </div>
            <div>
              <Label>Date *</Label>
              <Input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Amount *</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div>
            <Label>Expense Account *</Label>
            <Select value={expenseAccountId} onValueChange={setExpenseAccountId}>
              <SelectTrigger><SelectValue placeholder="Select expense account" /></SelectTrigger>
              <SelectContent>
                {expenseAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Cr on credit note (reduces the original expense)</p>
          </div>

          <div>
            <Label>Reason</Label>
            <Textarea
              placeholder="Price adjustment, returned goods…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          <div className="p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground space-y-0.5">
            <p><strong>Journal entry:</strong></p>
            <p>Dr Accounts Payable — reduces what we owe</p>
            <p>Cr Expense Account — reverses/reduces original expense</p>
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createCN.isPending}>
              {createCN.isPending ? "Posting…" : "Create Credit Note"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
