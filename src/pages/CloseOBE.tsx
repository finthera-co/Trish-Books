import { useState, useMemo } from "react";
import { AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useActiveAccounts } from "@/hooks/useData";
import { useOBEAccount, useOBEBalance, useCloseOBE } from "@/hooks/useOpeningBalanceEquity";
import { useSystemSetting } from "@/hooks/useOpeningBalanceSettings";
import { formatCurrency } from "@/lib/currency";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function CloseOBE() {
  const { data: accounts } = useActiveAccounts();
  const { data: obeAccount } = useOBEAccount();
  const { data: obeBalance } = useOBEBalance();
  const { data: obeClosed } = useSystemSetting("obe_closed");
  const closeMutation = useCloseOBE();

  const [targetAccountId, setTargetAccountId] = useState("");
  const [closingDate, setClosingDate] = useState(() => new Date().toISOString().slice(0, 10));

  const equityAccounts = useMemo(() => {
    return (accounts || []).filter(
      (a: any) => a.account_type === "Equity" && !a.is_system
    );
  }, [accounts]);

  const targetAccount = equityAccounts.find((a: any) => a.id === targetAccountId);
  const isAlreadyClosed = obeClosed === "true";
  const hasBalance = obeBalance && obeBalance.type !== "zero";

  const handleClose = () => {
    if (!obeAccount || !obeBalance || !targetAccountId) return;
    closeMutation.mutate({
      obeAccountId: obeAccount.id,
      targetAccountId,
      balance: obeBalance.balance,
      balanceType: obeBalance.type as "debit" | "credit",
      closingDate,
    });
  };

  if (isAlreadyClosed) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Close Opening Balance Equity</h1>
            <p className="page-description">Transfer OBE balance to a permanent equity account</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">Opening balances finalized</h2>
            <p className="text-sm text-muted-foreground">
              Opening Balance Equity has been closed. No further action required.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasBalance) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Close Opening Balance Equity</h1>
            <p className="page-description">Transfer OBE balance to a permanent equity account</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">OBE balance is zero</h2>
            <p className="text-sm text-muted-foreground">
              Opening Balance Equity already has a zero balance. No closure needed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Close Opening Balance Equity</h1>
          <p className="page-description">Transfer the OBE balance to a permanent equity account</p>
        </div>
      </div>

      {/* OBE Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current OBE Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-warning">
                Opening Balance Equity has a balance of {formatCurrency(obeBalance!.balance)}
              </p>
              <p className="text-xs text-warning/80">
                Balance Type: {obeBalance!.type === "debit" ? "Debit" : "Credit"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Target Account</label>
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select equity account…</option>
                {equityAccounts.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Closing Date</label>
              <input
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Journal Preview */}
      {targetAccountId && obeBalance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Journal Preview</CardTitle>
            <CardDescription>This journal entry will be created to close OBE</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Account</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Debit</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {obeBalance.type === "credit" ? (
                    <>
                      <tr className="border-b">
                        <td className="px-4 py-2.5 font-medium">Opening Balance Equity</td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(obeBalance.balance)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium pl-8">{targetAccount?.account_name || "Target Account"}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(obeBalance.balance)}</td>
                      </tr>
                    </>
                  ) : (
                    <>
                      <tr className="border-b">
                        <td className="px-4 py-2.5 font-medium">{targetAccount?.account_name || "Target Account"}</td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(obeBalance.balance)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium pl-8">Opening Balance Equity</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(obeBalance.balance)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!targetAccountId || closeMutation.isPending}>
                    <ArrowRight className="w-4 h-4 mr-1" />
                    {closeMutation.isPending ? "Closing…" : "Close OBE Now"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close Opening Balance Equity?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will create a journal entry transferring {formatCurrency(obeBalance.balance)} from
                      Opening Balance Equity to {targetAccount?.account_name}. This action cannot be undone
                      without admin override. Opening balance editing will be locked.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClose}>Confirm & Close</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
