import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecordVendorRefund } from "@/hooks/useAPModule";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useAccounts } from "@/hooks/useData";
import { toast } from "sonner";
import AccountCombobox from "@/components/shared/AccountCombobox";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  creditNotes: { id: string; credit_note_number: string; amount: number }[];
}

export default function VendorRefundDialog({ open, onOpenChange, vendorId, vendorName, creditNotes }: Props) {
  const recordRefund = useRecordVendorRefund();
  const { data: accountSettings } = useAccountSettings();
  const { data: accounts } = useAccounts();

  const [refundDate, setRefundDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [creditNoteId, setCreditNoteId] = useState("");

  const bankAccounts = (accounts as any[] ?? []).filter((a) =>
    a.is_active &&
    a.account_type === "Asset" &&
    (a.account_subtype?.toLowerCase().includes("cash") ||
      a.account_subtype?.toLowerCase().includes("bank") ||
      a.account_subtype?.toLowerCase().includes("checking") ||
      a.account_subtype?.toLowerCase().includes("savings"))
  );

  const handleSubmit = async () => {
    const apAccountId = accountSettings?.ap_account_id;
    if (!apAccountId) {
      toast.error("AP control account not configured. Set it in Settings → Account Mapping.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { toast.error("Enter a valid amount"); return; }
    if (!bankAccountId) { toast.error("Select a bank account"); return; }
    if (!refundDate) { toast.error("Enter a refund date"); return; }

    await recordRefund.mutateAsync({
      vendor_id: vendorId,
      refund_date: refundDate,
      amount: parsedAmount,
      bank_account_id: bankAccountId,
      ap_account_id: apAccountId,
      reference: reference || undefined,
      memo: memo || undefined,
      credit_note_id: creditNoteId || undefined,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Vendor Refund — {vendorName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
            </div>
            <div>
              <Label>Amount *</Label>
              <Input
                type="number" step="0.01" min="0.01" placeholder="0.00"
                value={amount} onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Deposit To *</Label>
            <AccountCombobox
              options={bankAccounts}
              value={bankAccountId}
              onChange={setBankAccountId}
              placeholder="Select bank / cash account"
            />
          </div>

          {creditNotes.length > 0 && (
            <div>
              <Label>Related Credit Note (optional)</Label>
              <Select value={creditNoteId || "none"} onValueChange={(v) => setCreditNoteId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {creditNotes.map((cn) => (
                    <SelectItem key={cn.id} value={cn.id}>{cn.credit_note_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">For traceability only — not validated against the credit note's amount.</p>
            </div>
          )}

          <div>
            <Label>Reference</Label>
            <Input placeholder="Transfer ref, cheque #…" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>

          <div>
            <Label>Memo</Label>
            <Input placeholder="Optional note" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>

          <div className="p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground space-y-0.5">
            <p><strong>Journal entry:</strong></p>
            <p>Dr Bank/Cash — cash received</p>
            <p>Cr Accounts Payable — clears the vendor's debit balance</p>
          </div>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={recordRefund.isPending}>
              {recordRefund.isPending ? "Posting…" : "Record Refund"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
