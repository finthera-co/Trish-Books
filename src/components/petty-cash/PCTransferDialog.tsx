import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftRight } from "lucide-react";
import { usePettyCashAccounts, useTransferPettyCash } from "@/hooks/usePettyCash";

interface Props {
  defaultFromId?: string;
  trigger?: React.ReactNode;
}

export function PCTransferDialog({ defaultFromId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(defaultFromId || "");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");

  const { data: accounts } = usePettyCashAccounts();
  const transfer = useTransferPettyCash();

  const reset = () => {
    setFromId(defaultFromId || "");
    setToId("");
    setAmount(0);
    setMemo("");
    setDate(new Date().toISOString().slice(0, 10));
  };

  const handleSubmit = () => {
    transfer.mutate(
      { from_pc_account_id: fromId, to_pc_account_id: toId, amount, date, memo },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
      },
    );
  };

  const canSubmit = fromId && toId && fromId !== toId && amount > 0 && !transfer.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <ArrowLeftRight className="w-4 h-4 mr-1" /> Transfer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer Between Petty Cash Accounts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <Label>From</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger><SelectValue placeholder="Source account" /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {accounts?.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger><SelectValue placeholder="Target account" /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {accounts?.filter((a: any) => a.id !== fromId).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div>
            <Label>Memo (optional)</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {transfer.isPending ? "Posting..." : "Post Transfer"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Posts a balanced journal entry: Dr Target / Cr Source.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
