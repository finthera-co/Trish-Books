import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { checkAccountDependencies, useReassignAndDeleteAccount, type AccountDependencies } from "@/hooks/useDeleteAccount";

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
}

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account | null;
  allAccounts: Account[];
}

export default function DeleteAccountDialog({ open, onOpenChange, account, allAccounts }: DeleteAccountDialogProps) {
  const [deps, setDeps] = useState<AccountDependencies | null>(null);
  const [loading, setLoading] = useState(false);
  const [reassignToId, setReassignToId] = useState("");
  const deleteMutation = useReassignAndDeleteAccount();

  useEffect(() => {
    if (open && account) {
      setLoading(true);
      setDeps(null);
      setReassignToId("");
      checkAccountDependencies(account.id).then(d => {
        setDeps(d);
        setLoading(false);
      });
    }
  }, [open, account]);

  if (!account) return null;

  const eligibleAccounts = allAccounts.filter(a =>
    a.id !== account.id && a.account_type === account.type && a.is_active
  );

  const hasDeps = deps && deps.total > 0;
  const hasBlockers = deps && deps.childAccounts > 0 && !reassignToId;

  const depLines = deps ? [
    deps.journalLines > 0 && `${deps.journalLines} journal line(s)`,
    deps.budgetItems > 0 && `${deps.budgetItems} budget item(s)`,
    deps.bankFeedTransactions > 0 && `${deps.bankFeedTransactions} bank feed transaction(s)`,
    deps.bankReconciliations > 0 && `${deps.bankReconciliations} bank reconciliation(s)`,
    deps.fixedAssets > 0 && `${deps.fixedAssets} fixed asset(s)`,
    deps.expenseCategories > 0 && `${deps.expenseCategories} expense category(ies)`,
    deps.transactions > 0 && `${deps.transactions} transaction(s)`,
    deps.openingBalances > 0 && `${deps.openingBalances} opening balance(s)`,
    deps.openingBalanceDetails > 0 && `${deps.openingBalanceDetails} sub-ledger detail(s)`,
    deps.childAccounts > 0 && `${deps.childAccounts} child account(s)`,
  ].filter(Boolean) : [];

  const handleDelete = async () => {
    await deleteMutation.mutateAsync({
      accountId: account.id,
      reassignToId: hasDeps ? reassignToId || undefined : undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Delete Account
          </DialogTitle>
          <DialogDescription>
            {account.account_code} — {account.account_name}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Checking dependencies...</span>
          </div>
        ) : hasDeps ? (
          <div className="space-y-4">
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-sm font-medium text-warning mb-2">
                This account has existing dependencies:
              </p>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                {depLines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>

            <div>
              <label className="text-sm font-medium">
                Reassign all references to: <span className="text-destructive">*</span>
              </label>
              <select
                value={reassignToId}
                onChange={(e) => setReassignToId(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground"
              >
                <option value="">— Select replacement account —</option>
                {eligibleAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                All transactions, budgets, and linked records will be moved to the selected account before deletion.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!reassignToId || deleteMutation.isPending}
                onClick={handleDelete}
              >
                {deleteMutation.isPending ? "Deleting..." : "Reassign & Delete"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This account has no linked transactions or dependencies. It can be safely deleted.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={deleteMutation.isPending}
                onClick={handleDelete}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Account"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
