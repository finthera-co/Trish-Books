import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { usePettyCashAccounts, usePettyCashTransactions, useCreatePettyCashTransaction } from "@/hooks/useData";
import { useMyPermissions } from "@/hooks/usePermissions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const typeColors: Record<string, string> = {
  expense: "bg-destructive/10 text-destructive",
  topup: "bg-success/10 text-success",
  issue: "bg-info/10 text-info",
};

export default function PettyCash() {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [amount, setAmount] = useState(0);
  const [transactionType, setTransactionType] = useState("expense");
  const [description, setDescription] = useState("");
  const [accountName, setAccountName] = useState("");

  const { data: accounts, isLoading: accountsLoading } = usePettyCashAccounts();
  const { data: transactions, isLoading: txnLoading } = usePettyCashTransactions(selectedAccount || accounts?.[0]?.id);
  const createTransaction = useCreatePettyCashTransaction();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { canEdit: canEditBanking } = useMyPermissions();

  const currentAccount = accounts?.find(a => a.id === (selectedAccount || accounts?.[0]?.id));

  const handleCreate = async () => {
    const accountId = selectedAccount || accounts?.[0]?.id;
    if (!accountId) return;
    
    await createTransaction.mutateAsync({
      petty_cash_account_id: accountId,
      amount: transactionType === "expense" ? -Math.abs(amount) : Math.abs(amount),
      transaction_type: transactionType,
      description,
    });
    
    // Update balance
    const newBalance = Number(currentAccount?.balance || 0) + (transactionType === "expense" ? -Math.abs(amount) : Math.abs(amount));
    await supabase.from("petty_cash_accounts").update({ balance: newBalance }).eq("id", accountId);
    queryClient.invalidateQueries({ queryKey: ["petty_cash_accounts"] });
    
    setOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handleCreateAccount = async () => {
    const { error } = await supabase.from("petty_cash_accounts").insert({
      tenant_id: appUser?.tenant_id,
      account_name: accountName,
      balance: 0,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Petty cash account created");
      queryClient.invalidateQueries({ queryKey: ["petty_cash_accounts"] });
      setAccountOpen(false);
      setAccountName("");
    }
  };

  const totalIssued = transactions?.filter(t => t.transaction_type === "issue" || t.transaction_type === "topup").reduce((s, t) => s + Math.abs(Number(t.amount)), 0) || 0;
  const totalSpent = transactions?.filter(t => t.transaction_type === "expense").reduce((s, t) => s + Math.abs(Number(t.amount)), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash</h1>
          <p className="page-description">Manage petty cash accounts and transactions</p>
        </div>
        <div className="flex gap-2">
          {canEditBanking("banking") && <>
            <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">New Account</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Petty Cash Account</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <label className="text-sm font-medium">Account Name</label>
                    <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Office Petty Cash" />
                  </div>
                  <Button onClick={handleCreateAccount} disabled={!accountName} className="w-full">Create Account</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button disabled={!accounts?.length}><Plus className="w-4 h-4" />New Transaction</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Transaction</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Type</label>
                      <select value={transactionType} onChange={(e) => setTransactionType(e.target.value)}
                        className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                        <option value="expense">Expense</option>
                        <option value="topup">Top-up</option>
                        <option value="issue">Issue</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Amount</label>
                      <input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))}
                        className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Office snacks" />
                  </div>
                  <Button onClick={handleCreate} disabled={!amount || createTransaction.isPending} className="w-full">
                    {createTransaction.isPending ? "Recording..." : "Record Transaction"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>}
        </div>
      </div>

      {accounts && accounts.length > 1 && (
        <div>
          <select value={selectedAccount || accounts[0]?.id} onChange={(e) => setSelectedAccount(e.target.value)}
            className="text-sm border rounded-md px-3 py-2 bg-card text-foreground">
            {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Current Balance</p><p className="text-xl font-semibold text-foreground mt-1">LKR {Number(currentAccount?.balance || 0).toFixed(2)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Issued</p><p className="text-xl font-semibold text-info mt-1">LKR {totalIssued.toFixed(2)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Spent</p><p className="text-xl font-semibold text-destructive mt-1">LKR {totalSpent.toFixed(2)}</p></div>
      </div>

      <div className="stat-card">
        {accountsLoading || txnLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !accounts?.length ? (
          <p className="text-center py-8 text-muted-foreground">Create a petty cash account to get started</p>
        ) : !transactions?.length ? (
          <p className="text-center py-8 text-muted-foreground">No transactions yet</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Description</th><th>Type</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td>{t.description || "-"}</td>
                  <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[t.transaction_type] || ""}`}>{t.transaction_type}</span></td>
                  <td className={`text-right font-medium ${Number(t.amount) >= 0 ? "text-success" : "text-destructive"}`}>
                    {Number(t.amount) >= 0 ? "+" : ""}LKR {Math.abs(Number(t.amount)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
