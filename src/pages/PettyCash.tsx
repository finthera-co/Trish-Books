import { useState } from "react";
import { Plus, FileText, RefreshCw, Wallet, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePettyCashAccounts, useCreatePCAccount, useCashAccounts, usePCBalance } from "@/hooks/usePettyCash";
import { ReimbursementBadge } from "@/components/petty-cash/ReimbursementBadge";
import { useMyPermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/lib/currency";
import { useNavigate } from "react-router-dom";
import { PCTransferDialog } from "@/components/petty-cash/PCTransferDialog";
import { PCFundDialog } from "@/components/petty-cash/PCFundDialog";

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

export default function PettyCash() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedCOAAccount, setSelectedCOAAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [floatAmount, setFloatAmount] = useState(0);

  const { data: accounts, isLoading } = usePettyCashAccounts();
  const { data: cashAccounts } = useCashAccounts();
  const createAccount = useCreatePCAccount();
  const { canEdit } = useMyPermissions();
  const navigate = useNavigate();

  const handleCreateAccount = () => {
    if (!selectedCOAAccount || !accountName || floatAmount <= 0) return;
    createAccount.mutate(
      { account_id: selectedCOAAccount, account_name: accountName, float_amount: floatAmount },
      {
        onSuccess: () => {
          setAccountOpen(false);
          setAccountName("");
          setFloatAmount(0);
          setSelectedCOAAccount("");
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash</h1>
          <p className="page-description">Manage petty cash accounts, vouchers & replenishments</p>
        </div>
        <div className="flex gap-2">
          {canEdit("banking") && (
            <>
              <PCFundDialog trigger={<Button variant="outline"><Banknote className="w-4 h-4 mr-1" /> Fund</Button>} />
              <PCTransferDialog />
              <Button variant="outline" onClick={() => navigate("/banking/petty-cash/replenishments")}>
                <RefreshCw className="w-4 h-4 mr-1" /> Replenishments
              </Button>
              <Button variant="outline" onClick={() => navigate("/banking/petty-cash/voucher/new")}>
                <FileText className="w-4 h-4 mr-1" /> New Voucher
              </Button>
              <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="w-4 h-4 mr-1" /> New Account</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Petty Cash Account</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label>Account Name</Label>
                      <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Office Petty Cash" />
                    </div>
                    <div>
                      <Label>Linked COA Account (Cash / Current Asset)</Label>
                      <Select value={selectedCOAAccount} onValueChange={setSelectedCOAAccount}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent position="popper" className="z-[9999]">
                          {(cashAccounts && cashAccounts.length > 0) ? cashAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          )) : (
                            <div className="px-3 py-2 text-sm text-muted-foreground">No cash/bank accounts found in COA</div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Float Amount (Imprest)</Label>
                      <Input type="number" value={floatAmount || ""} onChange={(e) => setFloatAmount(Number(e.target.value))} />
                    </div>
                    <Button onClick={handleCreateAccount} disabled={!accountName || !selectedCOAAccount || floatAmount <= 0} className="w-full">
                      Create Account
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground">Loading...</p>
      ) : !accounts?.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Wallet className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No petty cash accounts yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <PCAccountCard key={account.id} account={account} />
          ))}
        </div>
      )}

      {/* Vouchers list */}
      {accounts && accounts.length > 0 && <VouchersList />}
    </div>
  );
}

function PCAccountCard({ account }: { account: any }) {
  const { data: balance } = usePCBalance(account.id);
  const navigate = useNavigate();
  const replenishNeeded = Math.max(0, Number(account.float_amount || 0) - Number(balance?.remaining || 0));

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/banking/petty-cash/${account.id}/ledger`)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{account.account_name}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {(account as any).accounts?.account_code} – {(account as any).accounts?.account_name}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Float:</span>
          <span className="font-medium">{formatCurrency(account.float_amount)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Spent:</span>
          <span className="font-medium text-destructive">{formatCurrency(balance?.total_spent || 0)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Remaining:</span>
          <span className="font-semibold text-success">{formatCurrency(balance?.remaining || 0)}</span>
        </div>
        {replenishNeeded > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Replenish:</span>
            <span className="font-medium text-warning">{formatCurrency(replenishNeeded)}</span>
          </div>
        )}
        <Badge variant={account.is_active ? "default" : "secondary"} className="mt-1">
          {account.is_active ? "Active" : "Inactive"}
        </Badge>
        {Number(balance?.remaining || 0) <= 0 && (
          <div onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-warning mb-2">
              This fund holds no cash yet — vouchers can't be approved until it's funded.
            </p>
            <PCFundDialog
              defaultPcAccountId={account.id}
              trigger={
                <Button size="sm" variant="outline" className="w-full">
                  <Banknote className="w-4 h-4 mr-1" /> Fund this account
                </Button>
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VouchersList() {
  const { data: vouchers, isLoading } = usePCVouchers();
  const navigate = useNavigate();

  if (isLoading) return <p className="text-muted-foreground text-center py-4">Loading vouchers...</p>;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Recent Vouchers</h2>
      {!vouchers?.length ? (
        <p className="text-muted-foreground text-sm">No vouchers yet.</p>
      ) : (
        <div className="stat-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Voucher #</th>
                <th>Date</th>
                <th>Paid To</th>
                <th>Account</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>Reimbursement</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v: any) => (
                <tr key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/banking/petty-cash/voucher/${v.id}`)}>
                  <td className="font-mono text-sm">{v.voucher_number}</td>
                  <td className="text-muted-foreground">{new Date(v.date).toLocaleDateString()}</td>
                  <td>{v.paid_to || "—"}</td>
                  <td className="text-muted-foreground">{v.petty_cash_accounts?.account_name}</td>
                  <td className="text-right font-medium">{formatCurrency(v.total_amount)}</td>
                  <td>
                    <Badge className={statusColor[v.status] || ""}>{v.status}</Badge>
                  </td>
                  <td><ReimbursementBadge status={v.status} replenishmentId={v.replenishment_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Need to import this here since it's used in VouchersList
import { usePCVouchers } from "@/hooks/usePettyCash";
