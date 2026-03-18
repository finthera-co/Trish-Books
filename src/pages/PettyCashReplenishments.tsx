import { useState } from "react";
import { Plus, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  usePettyCashAccounts,
  useBankAccounts,
  usePCReplenishments,
  usePCBalance,
  useGenerateReplenishmentNumber,
  useCreateReplenishment,
  useApproveReplenishment,
} from "@/hooks/usePettyCash";
import { useMyPermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/lib/currency";

export default function PettyCashReplenishments() {
  const [open, setOpen] = useState(false);
  const [pcAccountId, setPcAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const { data: pcAccounts } = usePettyCashAccounts();
  const { data: bankAccounts } = useBankAccounts();
  const { data: replenishments } = usePCReplenishments();
  const { data: balance } = usePCBalance(pcAccountId || undefined);
  const { data: replNumber } = useGenerateReplenishmentNumber();
  const createRepl = useCreateReplenishment();
  const approveRepl = useApproveReplenishment();
  const { canEdit } = useMyPermissions();

  // Suggest replenishment = total spent
  const suggestedAmount = balance ? balance.total_spent - balance.total_replenished : 0;

  const handleCreate = () => {
    if (!pcAccountId || !bankAccountId || !replNumber || amount <= 0) return;
    createRepl.mutate(
      {
        replenishment_number: replNumber,
        date,
        petty_cash_account_id: pcAccountId,
        bank_account_id: bankAccountId,
        amount,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setAmount(0);
          setPcAccountId("");
          setBankAccountId("");
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash Replenishments</h1>
          <p className="page-description">Restore petty cash float from bank account</p>
        </div>
        {canEdit("banking") && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-1" /> New Replenishment</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Replenishment</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label>Petty Cash Account</Label>
                  <Select value={pcAccountId} onValueChange={(v) => { setPcAccountId(v); setAmount(0); }}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {pcAccounts?.filter((a) => a.is_active).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {pcAccountId && balance && (
                  <div className="p-3 bg-muted rounded-md text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Float:</span> <span className="font-medium">{formatCurrency(balance.float_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Spent:</span> <span className="font-medium text-destructive">{formatCurrency(balance.total_spent)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Remaining:</span> <span className="font-semibold text-success">{formatCurrency(balance.remaining)}</span>
                    </div>
                    {suggestedAmount > 0 && (
                      <Button variant="link" className="px-0 h-auto text-xs" onClick={() => setAmount(suggestedAmount)}>
                        Suggest: {formatCurrency(suggestedAmount)}
                      </Button>
                    )}
                  </div>
                )}
                <div>
                  <Label>Bank Account</Label>
                  <Select value={bankAccountId} onValueChange={setBankAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                    <SelectContent>
                      {bankAccounts?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount</Label>
                  <Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} min={0} step="0.01" />
                </div>
                <p className="text-xs text-muted-foreground font-mono">{replNumber || "Generating number..."}</p>
                <Button onClick={handleCreate} disabled={!pcAccountId || !bankAccountId || amount <= 0 || createRepl.isPending} className="w-full">
                  {createRepl.isPending ? "Creating..." : "Create Replenishment"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* List */}
      <Card>
        <CardContent className="pt-6">
          {!replenishments?.length ? (
            <p className="text-center py-8 text-muted-foreground">No replenishments yet</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>PC Account</th>
                  <th>Bank Account</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {replenishments.map((r: any) => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm">{r.replenishment_number}</td>
                    <td className="text-muted-foreground">{new Date(r.date).toLocaleDateString()}</td>
                    <td>{r.petty_cash_accounts?.account_name}</td>
                    <td className="text-muted-foreground">{r.bank_account?.account_code} – {r.bank_account?.account_name}</td>
                    <td className="text-right font-medium">{formatCurrency(r.amount)}</td>
                    <td>
                      <Badge variant={r.status === "approved" ? "default" : "secondary"}>{r.status}</Badge>
                    </td>
                    <td>
                      {r.status === "draft" && canEdit("banking") && (
                        <Button size="sm" variant="outline" onClick={() => approveRepl.mutate(r.id)} disabled={approveRepl.isPending}>
                          <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
