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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  useBankReconciliation,
  useReconciliationTransactions,
  useToggleClearTransaction,
  useCompleteReconciliation,
  useCreateReconciliationAdjustment,
} from "@/hooks/useBankReconciliation";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { CheckCircle, XCircle, Plus, ArrowLeft, ChevronDown, ChevronRight, Printer } from "lucide-react";
import ReconciliationReport from "./ReconciliationReport";

interface Props {
  reconciliationId: string;
  onBack: () => void;
}

type TxnGroup = "payment" | "deposit";

function classifyTransaction(jl: any): TxnGroup {
  // Credit to bank = payment/check going out; Debit to bank = deposit coming in
  const credit = Number(jl?.credit) || 0;
  return credit > 0 ? "payment" : "deposit";
}

function getTransactionType(je: any, jl: any): string {
  const ref = (je?.reference || "").toUpperCase();
  const desc = (je?.description || "").toLowerCase();
  const credit = Number(jl?.credit) || 0;

  if (ref.startsWith("PV-") || ref.startsWith("RECON-ADJ")) return credit > 0 ? "Bill Payment" : "Deposit";
  if (ref.startsWith("CHQ") || ref.startsWith("CHK")) return "Check";
  if (desc.includes("transfer")) return "Transfer";
  if (desc.includes("charge") || desc.includes("fee")) return "Bank Fee";
  if (desc.includes("interest")) return "Interest";
  if (credit > 0) return "Payment";
  return "Deposit";
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
  const [paymentsOpen, setPaymentsOpen] = useState(true);
  const [depositsOpen, setDepositsOpen] = useState(true);
  const [showReport, setShowReport] = useState(false);

  const filteredTxns = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t: any) => {
      const je = t.journal_lines?.journal_entries;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        (je?.description || "").toLowerCase().includes(s) ||
        (je?.reference || "").toLowerCase().includes(s)
      );
    });
  }, [transactions, search]);

  const grouped = useMemo(() => {
    const payments: any[] = [];
    const deposits: any[] = [];
    filteredTxns.forEach((t: any) => {
      const group = classifyTransaction(t.journal_lines);
      if (group === "payment") payments.push(t);
      else deposits.push(t);
    });
    // Sort by date
    const sortByDate = (a: any, b: any) => {
      const da = a.journal_lines?.journal_entries?.entry_date || "";
      const db = b.journal_lines?.journal_entries?.entry_date || "";
      return da.localeCompare(db);
    };
    payments.sort(sortByDate);
    deposits.sort(sortByDate);
    return { payments, deposits };
  }, [filteredTxns]);

  const summary = useMemo(() => {
    if (!recon || !transactions) return { paymentsCleared: 0, depositsCleared: 0, totalCleared: 0, clearedBalance: 0, difference: 0, paymentsCount: 0, depositsCount: 0 };
    let paymentsCleared = 0;
    let depositsCleared = 0;
    let paymentsCount = 0;
    let depositsCount = 0;
    transactions.forEach((t: any) => {
      if (!t.cleared) return;
      const jl = t.journal_lines;
      if (!jl) return;
      const debit = Number(jl.debit) || 0;
      const credit = Number(jl.credit) || 0;
      if (credit > 0) {
        paymentsCleared += credit;
        paymentsCount++;
      } else {
        depositsCleared += debit;
        depositsCount++;
      }
    });
    const totalCleared = depositsCleared - paymentsCleared;
    const clearedBalance = Number(recon.beginning_balance) + totalCleared;
    const difference = Number(recon.statement_ending_balance) - clearedBalance;
    return { paymentsCleared, depositsCleared, totalCleared, clearedBalance, difference, paymentsCount, depositsCount };
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

  const openAdjDialog = (type: "charge" | "interest") => {
    setAdjType(type);
    setShowAdjDialog(true);
  };

  if (!recon) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  if (showReport) {
    return (
      <ReconciliationReport
        recon={recon}
        transactions={transactions || []}
        summary={summary}
        onBack={() => setShowReport(false)}
      />
    );
  }

  const renderTransactionRow = (t: any) => {
    const jl = t.journal_lines;
    const je = jl?.journal_entries;
    const debit = Number(jl?.debit) || 0;
    const credit = Number(jl?.credit) || 0;
    const amount = debit > 0 ? debit : credit;
    const type = getTransactionType(je, jl);

    return (
      <TableRow key={t.id} className={t.cleared ? "bg-accent/30" : ""}>
        <TableCell className="w-10 text-center">
          <Checkbox
            checked={t.cleared}
            onCheckedChange={() => handleToggle(t.id, t.cleared)}
            disabled={isReconciled}
          />
        </TableCell>
        <TableCell className="text-xs">{je?.entry_date}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{type}</TableCell>
        <TableCell className="text-xs font-mono">{je?.reference || "—"}</TableCell>
        <TableCell className="text-xs max-w-[200px] truncate">{je?.description}</TableCell>
        <TableCell className="text-right text-xs">
          {credit > 0 ? formatCurrency(credit) : ""}
        </TableCell>
        <TableCell className="text-right text-xs">
          {debit > 0 ? formatCurrency(debit) : ""}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Reconcile: {(recon as any).accounts?.account_name}
            </h2>
            <p className="text-xs text-muted-foreground">
              Statement Date: {recon.statement_ending_date} · Statement Balance: {formatCurrency(Number(recon.statement_ending_balance))}
            </p>
          </div>
          <Badge variant={isReconciled ? "default" : "secondary"}>
            {isReconciled ? "Reconciled" : "In Progress"}
          </Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isReconciled && (
            <Button variant="outline" size="sm" onClick={() => setShowReport(true)}>
              <Printer className="w-3 h-3 mr-1" /> View Report
            </Button>
          )}
          {!isReconciled && (
            <>
              <Button variant="outline" size="sm" onClick={() => openAdjDialog("charge")}>
                <Plus className="w-3 h-3 mr-1" /> Bank Charge
              </Button>
              <Button variant="outline" size="sm" onClick={() => openAdjDialog("interest")}>
                <Plus className="w-3 h-3 mr-1" /> Interest
              </Button>
              <Button
                onClick={handleComplete}
                disabled={!canComplete || completeRecon.isPending}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {completeRecon.isPending ? "Finishing..." : "Reconcile Now"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left Panel - Grouped Transactions */}
        <div className="lg:col-span-3 space-y-3">
          {/* Search */}
          <Input
            placeholder="Search by payee, reference, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />

          {/* Checks and Payments */}
          <Card>
            <Collapsible open={paymentsOpen} onOpenChange={setPaymentsOpen}>
              <CollapsibleTrigger asChild>
                <CardHeader className="py-2 px-4 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {paymentsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      Checks and Payments
                      <Badge variant="outline" className="ml-2 text-xs">{grouped.payments.length}</Badge>
                    </CardTitle>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-0">
                  <div className="max-h-[35vh] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">Clr</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Num</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="text-right">Payment</TableHead>
                          <TableHead className="text-right">Deposit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grouped.payments.length === 0 ? (
                          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4 text-xs">No checks or payments</TableCell></TableRow>
                        ) : grouped.payments.map(renderTransactionRow)}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Deposits and Credits */}
          <Card>
            <Collapsible open={depositsOpen} onOpenChange={setDepositsOpen}>
              <CollapsibleTrigger asChild>
                <CardHeader className="py-2 px-4 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {depositsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      Deposits and Credits
                      <Badge variant="outline" className="ml-2 text-xs">{grouped.deposits.length}</Badge>
                    </CardTitle>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-0">
                  <div className="max-h-[35vh] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">Clr</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Num</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="text-right">Payment</TableHead>
                          <TableHead className="text-right">Deposit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grouped.deposits.length === 0 ? (
                          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4 text-xs">No deposits or credits</TableCell></TableRow>
                        ) : grouped.deposits.map(renderTransactionRow)}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* Right Panel - Summary */}
        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Reconciliation Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Beginning Balance</span>
                <span className="font-medium">{formatCurrency(Number(recon.beginning_balance))}</span>
              </div>
              <Separator />

              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Checks/Payments <span className="text-xs">({summary.paymentsCount})</span>
                </span>
                <span className="font-medium text-destructive">-{formatCurrency(summary.paymentsCleared)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Deposits/Credits <span className="text-xs">({summary.depositsCount})</span>
                </span>
                <span className="font-medium text-green-600">+{formatCurrency(summary.depositsCleared)}</span>
              </div>
              <Separator />

              <div className="flex justify-between font-semibold">
                <span>Cleared Balance</span>
                <span>{formatCurrency(summary.clearedBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Statement Balance</span>
                <span className="font-medium">{formatCurrency(Number(recon.statement_ending_balance))}</span>
              </div>
              <Separator />

              <div className={`flex justify-between items-center font-bold rounded-lg p-3 ${
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

              <div className="pt-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Not Yet Cleared</p>
                <p className="text-xs mt-1">
                  {(transactions || []).filter((t: any) => !t.cleared).length} transactions outstanding
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Adjustment Dialog */}
      <Dialog open={showAdjDialog} onOpenChange={setShowAdjDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {adjType === "charge" ? "Bank Service Charge" : "Interest Income"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input value={adjDesc} onChange={(e) => setAdjDesc(e.target.value)} placeholder={adjType === "charge" ? "e.g. Monthly service charge" : "e.g. Interest earned"} />
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
    </div>
  );
}
