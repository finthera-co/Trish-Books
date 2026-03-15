import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  useBankReconciliation,
  useReconciliationTransactions,
  useToggleClearTransaction,
  useCompleteReconciliation,
  useCreateReconciliationAdjustment,
} from "@/hooks/useBankReconciliation";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { CheckCircle, XCircle, Plus, ArrowLeft } from "lucide-react";

interface Props {
  reconciliationId: string;
  onBack: () => void;
}

export default function ReconciliationWorkspace({ reconciliationId, onBack }: Props) {
  const { data: recon } = useBankReconciliation(reconciliationId);
  const { data: transactions } = useReconciliationTransactions(reconciliationId);
  const { data: accounts } = useAccounts();
  const toggleClear = useToggleClearTransaction();
  const completeRecon = useCompleteReconciliation();

  const [search, setSearch] = useState("");
  const [showAdjDialog, setShowAdjDialog] = useState(false);
  const [adjType, setAdjType] = useState<"charge" | "interest">("charge");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjDesc, setAdjDesc] = useState("");
  const [adjAccountId, setAdjAccountId] = useState("");
  const [adjDate, setAdjDate] = useState(new Date().toISOString().split("T")[0]);
  const createAdj = useCreateReconciliationAdjustment();

  const filteredTxns = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t: any) => {
      const je = t.journal_lines?.journal_entries;
      const searchLower = search.toLowerCase();
      if (!search) return true;
      return (
        (je?.description || "").toLowerCase().includes(searchLower) ||
        (je?.reference || "").toLowerCase().includes(searchLower)
      );
    });
  }, [transactions, search]);

  const summary = useMemo(() => {
    if (!recon || !transactions) return { paymentsCleared: 0, depositsCleared: 0, clearedBalance: 0, difference: 0 };
    let paymentsCleared = 0;
    let depositsCleared = 0;
    transactions.forEach((t: any) => {
      if (!t.cleared) return;
      const jl = t.journal_lines;
      if (!jl) return;
      const debit = Number(jl.debit) || 0;
      const credit = Number(jl.credit) || 0;
      depositsCleared += debit;
      paymentsCleared += credit;
    });
    const clearedBalance = recon.beginning_balance + depositsCleared - paymentsCleared;
    const difference = Number(recon.statement_ending_balance) - clearedBalance;
    return { paymentsCleared, depositsCleared, clearedBalance, difference };
  }, [recon, transactions]);

  const isReconciled = recon?.status === "reconciled";
  const canComplete = Math.abs(summary.difference) < 0.005;

  const handleToggle = (txnId: string, currentCleared: boolean) => {
    if (isReconciled) return;
    toggleClear.mutate({ id: txnId, cleared: !currentCleared, reconciliationId });
  };

  const handleComplete = () => {
    completeRecon.mutate({ id: reconciliationId, clearedBalance: summary.clearedBalance });
  };

  const handleAddAdjustment = async () => {
    if (!adjAmount || !adjDesc || !adjAccountId || !recon) return;
    await createAdj.mutateAsync({
      reconciliation_id: reconciliationId,
      bank_account_id: recon.bank_account_id,
      account_id: adjAccountId,
      amount: parseFloat(adjAmount),
      description: adjDesc,
      adjustment_type: adjType,
      date: adjDate,
    });
    setShowAdjDialog(false);
    setAdjAmount("");
    setAdjDesc("");
    setAdjAccountId("");
  };

  if (!recon) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h2 className="text-xl font-semibold text-foreground">
            Reconcile: {(recon as any).accounts?.account_name}
          </h2>
          <Badge variant={isReconciled ? "default" : "secondary"}>
            {isReconciled ? "Reconciled" : "In Progress"}
          </Badge>
        </div>
        <div className="flex gap-2">
          {!isReconciled && (
            <>
              <Dialog open={showAdjDialog} onOpenChange={setShowAdjDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={() => setAdjType("charge")}>
                    <Plus className="w-3 h-3 mr-1" /> Add Charge
                  </Button>
                </DialogTrigger>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={() => { setAdjType("interest"); setShowAdjDialog(true); }}>
                    <Plus className="w-3 h-3 mr-1" /> Add Interest
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add {adjType === "charge" ? "Bank Charge" : "Interest Income"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Date</Label>
                      <Input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Description</Label>
                      <Input value={adjDesc} onChange={(e) => setAdjDesc(e.target.value)} placeholder="e.g. Monthly service charge" />
                    </div>
                    <div className="space-y-1">
                      <Label>{adjType === "charge" ? "Expense Account" : "Income Account"}</Label>
                      <Select value={adjAccountId} onValueChange={setAdjAccountId}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {(accounts || [])
                            .filter((a: any) => adjType === "charge" ? a.account_type === "Expense" : a.account_type === "Revenue")
                            .map((a: any) => (
                              <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Amount</Label>
                      <Input type="number" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="0.00" />
                    </div>
                    <Button onClick={handleAddAdjustment} disabled={createAdj.isPending} className="w-full">
                      {createAdj.isPending ? "Adding..." : "Add Adjustment"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Button
                onClick={handleComplete}
                disabled={!canComplete || completeRecon.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                Finish Reconciliation
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Panel - Transactions */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Transactions</CardTitle>
                <Input
                  placeholder="Search transactions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-64"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">✓</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTxns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No transactions found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTxns.map((t: any) => {
                        const jl = t.journal_lines;
                        const je = jl?.journal_entries;
                        return (
                          <TableRow key={t.id} className={t.cleared ? "bg-green-50 dark:bg-green-950/20" : ""}>
                            <TableCell>
                              <Checkbox
                                checked={t.cleared}
                                onCheckedChange={() => handleToggle(t.id, t.cleared)}
                                disabled={isReconciled}
                              />
                            </TableCell>
                            <TableCell className="text-sm">{je?.entry_date}</TableCell>
                            <TableCell className="text-sm font-mono">{je?.reference || "—"}</TableCell>
                            <TableCell className="text-sm">{je?.description}</TableCell>
                            <TableCell className="text-right text-sm">
                              {Number(jl?.debit) > 0 ? formatCurrency(Number(jl.debit)) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {Number(jl?.credit) > 0 ? formatCurrency(Number(jl.credit)) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Summary */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reconciliation Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Beginning Balance</span>
                <span className="font-medium">{formatCurrency(recon.beginning_balance)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Deposits Cleared</span>
                <span className="font-medium text-green-600">+{formatCurrency(summary.depositsCleared)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payments Cleared</span>
                <span className="font-medium text-red-600">-{formatCurrency(summary.paymentsCleared)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm font-semibold">
                <span>Cleared Balance</span>
                <span>{formatCurrency(summary.clearedBalance)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Statement Ending Balance</span>
                <span className="font-medium">{formatCurrency(recon.statement_ending_balance)}</span>
              </div>
              <Separator />
              <div className={`flex justify-between items-center text-sm font-bold rounded-lg p-3 ${
                canComplete
                  ? "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400"
                  : "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400"
              }`}>
                <span className="flex items-center gap-1">
                  {canComplete ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  Difference
                </span>
                <span>{formatCurrency(summary.difference)}</span>
              </div>

              {/* Outstanding counts */}
              <div className="pt-3 space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Transactions Not Yet Cleared</p>
                <p className="text-sm">
                  {(transactions || []).filter((t: any) => !t.cleared).length} transactions outstanding
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
