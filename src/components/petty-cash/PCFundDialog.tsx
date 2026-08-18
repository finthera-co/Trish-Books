import { useState } from "react";
import { Banknote } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  usePettyCashAccounts,
  useBankAccounts,
  usePCBalance,
  useFundPettyCash,
} from "@/hooks/usePettyCash";
import { formatCurrency } from "@/lib/currency";
import AccountCombobox from "@/components/shared/AccountCombobox";

interface Props {
  defaultPcAccountId?: string;
  trigger?: React.ReactNode;
}

// Puts cash into a fund without requiring vouchers to reimburse — the initial
// float for a new fund, or a straight top-up back to the imprest ceiling.
export function PCFundDialog({ defaultPcAccountId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [pcAccountId, setPcAccountId] = useState(defaultPcAccountId || "");
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: pcAccounts } = usePettyCashAccounts();
  const { data: bankAccounts } = useBankAccounts();
  const { data: balance } = usePCBalance(pcAccountId || undefined);
  const fund = useFundPettyCash();

  const float = Number(balance?.float_amount || 0);
  const current = Number(balance?.remaining || 0);
  const headroom = Math.max(0, Number((float - current).toFixed(2)));
  const overHeadroom = !!pcAccountId && amount > headroom + 0.01;

  const reset = () => {
    setPcAccountId(defaultPcAccountId || "");
    setBankAccountId("");
    setAmount(0);
    setDate(new Date().toISOString().slice(0, 10));
  };

  const handleSubmit = () => {
    fund.mutate(
      { pc_account_id: pcAccountId, bank_account_id: bankAccountId, amount, date },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
      },
    );
  };

  const canSubmit = pcAccountId && bankAccountId && amount > 0 && !overHeadroom && !fund.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Banknote className="w-4 h-4 mr-1" /> Fund
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fund Petty Cash</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <Label>Petty Cash Fund</Label>
            <Select value={pcAccountId} onValueChange={setPcAccountId}>
              <SelectTrigger><SelectValue placeholder="Select fund" /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {pcAccounts?.filter((a: any) => a.is_active).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Fund From (Bank / Cash Account)</Label>
            <AccountCombobox
              options={bankAccounts ?? []}
              value={bankAccountId}
              onChange={setBankAccountId}
              placeholder="Select bank account"
              emptyText="No Bank-subtype accounts in the COA"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
          </div>

          {pcAccountId && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current balance</span>
                <span className="font-medium">{formatCurrency(current)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Defined float</span>
                <span className="font-medium">{formatCurrency(float)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Maximum top-up</span>
                <span className="font-medium">{formatCurrency(headroom)}</span>
              </div>
              {headroom > 0 && amount !== headroom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0 h-auto text-xs"
                  onClick={() => setAmount(headroom)}
                >
                  Use maximum
                </Button>
              )}
            </div>
          )}

          {overHeadroom && (
            <p className="text-xs text-destructive">
              This would push the fund above its defined float of {formatCurrency(float)}. Reduce the
              amount, or raise the float on the fund.
            </p>
          )}

          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {fund.isPending ? "Posting…" : "Post Funding"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Posts a balanced journal entry: Dr Petty Cash / Cr Bank.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
