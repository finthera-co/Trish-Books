import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateRecurringCheckTemplate } from "@/hooks/useRecurringChecks";
import type { VoucherLine } from "@/hooks/usePaymentVouchers";

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentAccountId: string;
  payeeId?: string;
  payeeVendorId?: string;
  memo?: string;
  lines: VoucherLine[];
}

// Seeds a recurring_check_templates row from the current check's payee /
// bank account / lines — the template then generates and posts future
// checks on its own schedule via generate_recurring_checks().
export default function CheckRecurringDialog({ open, onOpenChange, paymentAccountId, payeeId, payeeVendorId, memo, lines }: Props) {
  const createTemplate = useCreateRecurringCheckTemplate();
  const [templateName, setTemplateName] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [intervalCount, setIntervalCount] = useState("1");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const handleCreate = async () => {
    if (!templateName.trim()) return;
    await createTemplate.mutateAsync({
      payment_account_id: paymentAccountId,
      payee_id: payeeId,
      payee_vendor_id: payeeVendorId,
      template_name: templateName.trim(),
      frequency,
      interval_count: Math.max(1, parseInt(intervalCount) || 1),
      start_date: startDate,
      memo,
      lines,
    });
    onOpenChange(false);
    setTemplateName("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Make recurring</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Template name *</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Monthly Rent" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Every N periods</Label>
              <Input type="number" min="1" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
          </div>
          <p className="text-xs text-muted-foreground">
            Every generated check posts immediately to the ledger on its scheduled date.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createTemplate.isPending || !templateName.trim()}>
            {createTemplate.isPending ? "Creating…" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
