import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useBankReconciliation,
  useReconciliationTransactions,
  useToggleClearTransaction,
  useCompleteReconciliation,
  useCreateReconciliationAdjustment,
} from "@/hooks/useBankReconciliation";
import { useBankFeedTransactions, useApproveMatch, useRejectMatch, useDeleteBankFeed, useRunAIMatching } from "@/hooks/useBankFeeds";
import { useReconcileEngine, useReconciliationSnapshots, useInvariantLog } from "@/hooks/useReconciliationEngine";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import {
  CheckCircle, XCircle, Plus, ArrowLeft, ChevronDown, ChevronRight,
  Printer, Sparkles, AlertTriangle, Check, X, Trash2, Link2
} from "lucide-react";
import ReconciliationReport from "./ReconciliationReport";
import BankFeedImport from "./BankFeedImport";
import ReconciliationRulesManager from "./ReconciliationRulesManager";

interface Props {
  reconciliationId: string;
  onBack: () => void;
}

type TxnGroup = "payment" | "deposit";

function classifyTransaction(jl: any): TxnGroup {
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
  const { data: bankFeeds } = useBankFeedTransactions(reconciliationId);
  const { data: accounts } = useAccounts();
  const toggleClear = useToggleClearTransaction();
  const completeRecon = useCompleteReconciliation();
  const approveMatch = useApproveMatch();
  const rejectMatch = useRejectMatch();
  const deleteBankFeed = useDeleteBankFeed();
  const runMatching = useRunAIMatching();
  const engine = useReconcileEngine();
  const { data: snapshots } = useReconciliationSnapshots(reconciliationId);
  const { data: invariants } = useInvariantLog(reconciliationId);

  const [search, setSearch] = useState("");
  const [showAdjDialog, setShowAdjDialog] = useState(false);
  const [adjType, setAdjType] = useState<"charge" | "interest">("charge");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjDesc, setAdjDesc] = useState("");
  const [adjAccountId, setAdjAccountId] = useState("");
  const [adjDate, setAdjDate] = useState(new Date().toISOString().split("T")[0]);
  const createAdj = useCreateReconciliationAdjustment();

  // Income accounts for interest earned (Income + Other Income types)
  const incomeAccounts = useMemo(() => {
    if (!accounts) return [];
    return (accounts as any[]).filter((a: any) =>
      a.account_type === "Income" || a.account_type === "Other Income"
    );
  }, [accounts]);

  // Expense accounts for bank charges
  const expenseAccounts = useMemo(() => {
    if (!accounts) return [];
    return (accounts as any[]).filter((a: any) => a.account_type === "Expense" || a.account_type === "Other Expense");
  }, [accounts]);

  // Auto-default to "Interest Income" account when opening interest dialog
  const defaultInterestAccountId = useMemo(() => {
    const match = incomeAccounts.find((a: any) =>
      a.account_name.toLowerCase().includes("interest income") ||
      a.account_name.toLowerCase().includes("interest earned")
    );
    return match?.id || "";
  }, [incomeAccounts]);
  const [paymentsOpen, setPaymentsOpen] = useState(true);
  const [depositsOpen, setDepositsOpen] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [activeTab, setActiveTab] = useState("ledger");

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
    let paymentsCleared = 0, depositsCleared = 0, paymentsCount = 0, depositsCount = 0;
    transactions.forEach((t: any) => {
      if (!t.cleared) return;
      const jl = t.journal_lines;
      if (!jl) return;
      const debit = Number(jl.debit) || 0;
      const credit = Number(jl.credit) || 0;
      if (credit > 0) { paymentsCleared += credit; paymentsCount++; }
      else { depositsCleared += debit; depositsCount++; }
    });
    const totalCleared = depositsCleared - paymentsCleared;
    const clearedBalance = Number(recon.beginning_balance) + totalCleared;
    const difference = Number(recon.statement_ending_balance) - clearedBalance;
    return { paymentsCleared, depositsCleared, totalCleared, clearedBalance, difference, paymentsCount, depositsCount };
  }, [recon, transactions]);

  const bankFeedSummary = useMemo(() => {
    if (!bankFeeds) return { total: 0, unmatched: 0, suggested: 0, matched: 0, duplicates: 0, ruleMatched: 0 };
    return {
      total: bankFeeds.length,
      unmatched: bankFeeds.filter((f: any) => f.status === "unmatched").length,
      suggested: bankFeeds.filter((f: any) => f.status === "suggested").length,
      matched: bankFeeds.filter((f: any) => f.status === "matched").length,
      ruleMatched: bankFeeds.filter((f: any) => f.status === "rule_matched").length,
      duplicates: bankFeeds.filter((f: any) => f.is_duplicate).length,
    };
  }, [bankFeeds]);

  // No-orphan check: all bank feed txns must be matched, rule_matched, or deleted (not unmatched/suggested)
  const hasOrphanBankTxns = bankFeedSummary.unmatched > 0 || bankFeedSummary.suggested > 0;
  const hasBankFeeds = bankFeedSummary.total > 0;

  // Build a map of journal_line_id -> recon_txn for suggested matches
  const suggestedMatchMap = useMemo(() => {
    const map = new Map<string, any>();
    if (!bankFeeds || !transactions) return map;
    bankFeeds.filter((f: any) => f.status === "suggested" && f.matched_journal_line_id).forEach((f: any) => {
      const reconTxn = transactions.find((t: any) => t.journal_line_id === f.matched_journal_line_id);
      if (reconTxn) map.set(f.id, { bankFeed: f, reconTxn });
    });
    return map;
  }, [bankFeeds, transactions]);

  const isReconciled = recon?.status === "reconciled";
  const canComplete = Math.abs(summary.difference) < 0.005 && !(hasBankFeeds && hasOrphanBankTxns);

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
    setAdjAmount(""); setAdjDesc(""); setAdjAccountId("");
  };

  const openAdjDialog = (type: "charge" | "interest") => {
    setAdjType(type);
    if (type === "interest") {
      setAdjAccountId(defaultInterestAccountId);
      setAdjDesc("Bank Interest Earned");
    } else {
      setAdjAccountId("");
      setAdjDesc("");
    }
    setAdjAmount("");
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
    const type = getTransactionType(je, jl);
    const hasSuggestedMatch = bankFeeds?.some((f: any) => f.status === "suggested" && f.matched_journal_line_id === t.journal_line_id);

    return (
      <TableRow key={t.id} className={`${t.cleared ? "bg-green-50 dark:bg-green-950/20" : ""} ${hasSuggestedMatch ? "border-l-2 border-l-amber-400" : ""}`}>
        <TableCell className="w-10 text-center">
          <Checkbox checked={t.cleared} onCheckedChange={() => handleToggle(t.id, t.cleared)} disabled={isReconciled} />
        </TableCell>
        <TableCell className="text-xs">{je?.entry_date}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{type}</TableCell>
        <TableCell className="text-xs font-mono">{je?.reference || "—"}</TableCell>
        <TableCell className="text-xs max-w-[180px] truncate">{je?.description}</TableCell>
        <TableCell className="text-right text-xs">{credit > 0 ? formatCurrency(credit) : ""}</TableCell>
        <TableCell className="text-right text-xs">{debit > 0 ? formatCurrency(debit) : ""}</TableCell>
        <TableCell className="text-center">
          {hasSuggestedMatch && <Link2 className="w-3 h-3 text-amber-500 inline" />}
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
              <BankFeedImport reconciliationId={reconciliationId} bankAccountId={recon.bank_account_id} />
              <ReconciliationRulesManager />
              <Button
                variant="outline"
                size="sm"
                onClick={() => runMatching.mutate({ reconciliationId, bankAccountId: recon.bank_account_id })}
                disabled={runMatching.isPending}
              >
                <Sparkles className="w-3 h-3 mr-1" /> {runMatching.isPending ? "Matching..." : "AI Match"}
              </Button>
              <Button variant="outline" size="sm" disabled={engine.isPending}
                onClick={() => engine.mutate({ reconciliationId, action: "match" })}>
                ⚙️ Engine Match
              </Button>
              <Button variant="outline" size="sm" disabled={engine.isPending}
                onClick={() => engine.mutate({ reconciliationId, action: "validate" })}>
                ✓ Validate
              </Button>
              <Button variant="outline" size="sm" onClick={() => openAdjDialog("charge")}>
                <Plus className="w-3 h-3 mr-1" /> Bank Charge
              </Button>
              <Button variant="outline" size="sm" onClick={() => openAdjDialog("interest")}>
                <Plus className="w-3 h-3 mr-1" /> Interest
              </Button>
              <Button onClick={handleComplete} disabled={!canComplete || completeRecon.isPending} size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                {completeRecon.isPending ? "Finishing..." : "Finalize Reconciliation"}
              </Button>
              {hasBankFeeds && hasOrphanBankTxns && (
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle className="w-3 h-3" />
                  {bankFeedSummary.unmatched + bankFeedSummary.suggested} bank txns unresolved — match or delete before finalizing
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Top Summary Panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Opening Balance</p>
            <p className="text-lg font-bold">{formatCurrency(Number(recon.beginning_balance))}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Statement Balance</p>
            <p className="text-lg font-bold">{formatCurrency(Number(recon.statement_ending_balance))}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Cleared Balance</p>
            <p className="text-lg font-bold">{formatCurrency(summary.clearedBalance)}</p>
          </CardContent>
        </Card>
        <Card className={`border-l-4 ${canComplete ? "border-l-green-500" : "border-l-red-500"}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              Difference {canComplete ? <CheckCircle className="w-3 h-3 text-green-600" /> : <XCircle className="w-3 h-3 text-red-600" />}
            </p>
            <p className={`text-lg font-bold ${canComplete ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(summary.difference)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main 3-Panel Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Panel - Bank Feed */}
        <div className="xl:col-span-3">
          <Card className="h-full">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Bank Feed</span>
                <div className="flex gap-1">
                  {bankFeedSummary.duplicates > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{bankFeedSummary.duplicates} dup</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">{bankFeedSummary.total}</Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[55vh] overflow-auto">
                {(!bankFeeds || bankFeeds.length === 0) ? (
                  <div className="p-4 text-center text-muted-foreground text-xs">
                    <p>No bank feed imported yet.</p>
                    <p className="mt-1">Click "Import Bank Statement" to upload a CSV.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {bankFeeds.map((f: any) => (
                      <div key={f.id} className={`px-3 py-2 text-xs ${f.is_duplicate ? "bg-amber-50 dark:bg-amber-950/20" : ""} ${f.status === "matched" ? "bg-green-50 dark:bg-green-950/20 opacity-60" : ""} ${f.status === "suggested" ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}>
                        <div className="flex justify-between items-start">
                          <span className="text-muted-foreground">{f.transaction_date}</span>
                          <span className={`font-mono font-medium ${f.amount > 0 ? "text-green-600" : "text-red-600"}`}>
                            {formatCurrency(f.amount)}
                          </span>
                        </div>
                        <p className="truncate mt-0.5">{f.description || "—"}</p>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex gap-1">
                            {f.is_duplicate && (
                              <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                <AlertTriangle className="w-2 h-2 mr-0.5" /> Duplicate
                              </Badge>
                            )}
                            {f.status === "suggested" && (
                              <Badge className="text-[9px] px-1 py-0 bg-amber-500">
                                <Sparkles className="w-2 h-2 mr-0.5" /> Suggested {f.match_confidence}%
                              </Badge>
                            )}
                            {f.status === "matched" && (
                              <Badge className="text-[9px] px-1 py-0 bg-green-600">
                                <Check className="w-2 h-2 mr-0.5" /> {f.match_type === "AUTO_MATCHED" ? "Auto" : f.match_type === "GROUP_MATCHED" ? "Group" : "Matched"}
                              </Badge>
                            )}
                            {f.status === "matched" && f.match_metadata?.method && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {f.match_metadata.method}
                              </Badge>
                            )}
                            {f.status === "rule_matched" && (
                              <Badge className="text-[9px] px-1 py-0 bg-purple-600">
                                Rule Match
                              </Badge>
                            )}
                          </div>
                          {!isReconciled && f.status !== "matched" && (
                            <div className="flex gap-0.5">
                              {f.status === "suggested" && suggestedMatchMap.has(f.id) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-green-600"
                                  onClick={() => {
                                    const match = suggestedMatchMap.get(f.id);
                                    approveMatch.mutate({
                                      bankFeedId: f.id,
                                      reconTxnId: match.reconTxn.id,
                                      reconciliationId,
                                    });
                                  }}
                                >
                                  <Check className="w-3 h-3" />
                                </Button>
                              )}
                              {f.status === "suggested" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-red-600"
                                  onClick={() => rejectMatch.mutate({ bankFeedId: f.id, reconciliationId })}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              )}
                              {(f.is_duplicate || f.status === "unmatched") && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-muted-foreground"
                                  onClick={() => deleteBankFeed.mutate({ id: f.id, reconciliationId })}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Center Panel - Ledger Transactions */}
        <div className="xl:col-span-6 space-y-3">
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
                  <div className="max-h-[30vh] overflow-auto">
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
                          <TableHead className="w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grouped.payments.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-4 text-xs">No checks or payments</TableCell></TableRow>
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
                  <div className="max-h-[30vh] overflow-auto">
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
                          <TableHead className="w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grouped.deposits.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-4 text-xs">No deposits or credits</TableCell></TableRow>
                        ) : grouped.deposits.map(renderTransactionRow)}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* Right Panel - Summary + AI Matches */}
        <div className="xl:col-span-3 space-y-3">
          {/* Reconciliation Summary */}
          <Card>
            <CardHeader className="pb-2 px-4 pt-3">
              <CardTitle className="text-sm">Reconciliation Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="text-muted-foreground py-1.5">Beginning Balance</td>
                    <td className="text-right font-medium font-mono py-1.5">{formatCurrency(Number(recon.beginning_balance))}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="py-0"><Separator /></td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-1.5">
                      Checks/Payments <span className="text-xs">({summary.paymentsCount})</span>
                    </td>
                    <td className="text-right font-medium font-mono text-destructive py-1.5">
                      -{formatCurrency(summary.paymentsCleared)}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-1.5">
                      Deposits/Credits <span className="text-xs">({summary.depositsCount})</span>
                    </td>
                    <td className="text-right font-medium font-mono text-green-600 py-1.5">
                      +{formatCurrency(summary.depositsCleared)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="py-0"><Separator /></td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="py-1.5">Cleared Balance</td>
                    <td className="text-right font-mono py-1.5">{formatCurrency(summary.clearedBalance)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-1.5">Statement Balance</td>
                    <td className="text-right font-medium font-mono py-1.5">{formatCurrency(Number(recon.statement_ending_balance))}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="py-0"><Separator /></td>
                  </tr>
                </tbody>
              </table>
              <div className={`flex justify-between items-center font-bold rounded-lg p-3 mt-2 ${
                canComplete ? "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400"
              }`}>
                <span className="flex items-center gap-1">
                  {canComplete ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  Difference
                </span>
                <span className="font-mono">{formatCurrency(summary.difference)}</span>
              </div>
              <div className="pt-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Not Yet Cleared</p>
                <p className="text-xs mt-0.5">{(transactions || []).filter((t: any) => !t.cleared).length} transactions outstanding</p>
              </div>
            </CardContent>
          </Card>

          {/* AI Match Suggestions */}
          {suggestedMatchMap.size > 0 && (
            <Card className="border-amber-300 dark:border-amber-700">
              <CardHeader className="pb-2 px-4 pt-3">
                <CardTitle className="text-sm flex items-center gap-1">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  AI Match Suggestions
                  <Badge className="bg-amber-500 text-[10px] ml-1">{suggestedMatchMap.size}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[25vh] overflow-auto divide-y">
                  {Array.from(suggestedMatchMap.entries()).map(([bfId, match]) => {
                    const bf = match.bankFeed;
                    const rt = match.reconTxn;
                    const je = rt.journal_lines?.journal_entries;
                    return (
                      <div key={bfId} className="px-3 py-2 text-xs">
                        <div className="flex justify-between">
                          <span className="font-medium text-amber-600">{bf.match_confidence}% match</span>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1 text-green-600"
                              onClick={() => approveMatch.mutate({ bankFeedId: bfId, reconTxnId: rt.id, reconciliationId })}
                            >
                              <Check className="w-3 h-3 mr-0.5" /> Accept
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1 text-red-600"
                              onClick={() => rejectMatch.mutate({ bankFeedId: bfId, reconciliationId })}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <div className="bg-muted/50 rounded p-1.5">
                            <p className="text-[10px] text-muted-foreground">Bank Feed</p>
                            <p className="truncate">{bf.description}</p>
                            <p className="font-mono">{formatCurrency(bf.amount)}</p>
                          </div>
                          <div className="bg-muted/50 rounded p-1.5">
                            <p className="text-[10px] text-muted-foreground">Ledger</p>
                            <p className="truncate">{je?.description}</p>
                            <p className="font-mono">{formatCurrency(Number(rt.journal_lines?.debit || rt.journal_lines?.credit) || 0)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bank Feed Stats */}
          {bankFeedSummary.total > 0 && (
            <Card>
              <CardHeader className="pb-2 px-4 pt-3">
                <CardTitle className="text-sm">Bank Feed Status</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1 px-4 pb-3">
                <div className="flex justify-between"><span className="text-muted-foreground">Total Imported</span><span>{bankFeedSummary.total}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Unmatched</span><span className="text-amber-600">{bankFeedSummary.unmatched}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Suggested</span><span className="text-blue-600">{bankFeedSummary.suggested}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Auto-Matched</span><span className="text-green-600">{bankFeedSummary.matched}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rule-Matched</span><span className="text-purple-600">{bankFeedSummary.ruleMatched}</span></div>
                {bankFeedSummary.duplicates > 0 && (
                  <div className="flex justify-between"><span className="text-destructive">Duplicates</span><span className="text-destructive">{bankFeedSummary.duplicates}</span></div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Adjustment Dialog */}
      <Dialog open={showAdjDialog} onOpenChange={setShowAdjDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{adjType === "charge" ? "Add Bank Service Charge" : "Add Interest Earned"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Amount <span className="text-destructive">*</span></Label>
                <Input type="number" step="0.01" min="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="0.00" />
                {adjAmount && parseFloat(adjAmount) <= 0 && (
                  <p className="text-[11px] text-destructive">Amount must be greater than zero</p>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input value={adjDesc} onChange={(e) => setAdjDesc(e.target.value)} placeholder={adjType === "charge" ? "e.g. Monthly service charge" : "e.g. Bank Interest Earned"} />
            </div>
            <div className="space-y-1">
              <Label>{adjType === "charge" ? "Expense Account" : "Income Account"} <span className="text-destructive">*</span></Label>
              <Select value={adjAccountId} onValueChange={setAdjAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {(adjType === "charge" ? expenseAccounts : incomeAccounts).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {adjType === "interest" && incomeAccounts.length === 0 && (
                <p className="text-[11px] text-amber-600">No income accounts found. Please create an "Interest Income" account in your Chart of Accounts (Type: Other Income).</p>
              )}
            </div>

            {/* Journal Entry Preview */}
            {adjAmount && parseFloat(adjAmount) > 0 && adjAccountId && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Journal Entry Preview</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs h-7">Account</TableHead>
                      <TableHead className="text-xs text-right h-7">Debit</TableHead>
                      <TableHead className="text-xs text-right h-7">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjType === "interest" ? (
                      <>
                        <TableRow>
                          <TableCell className="text-xs py-1">{(recon as any).accounts?.account_name || "Bank Account"}</TableCell>
                          <TableCell className="text-xs text-right py-1 font-mono">{formatCurrency(parseFloat(adjAmount))}</TableCell>
                          <TableCell className="text-xs text-right py-1">—</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-xs py-1">
                            {(adjType === "interest" ? incomeAccounts : expenseAccounts).find((a: any) => a.id === adjAccountId)?.account_name || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-right py-1">—</TableCell>
                          <TableCell className="text-xs text-right py-1 font-mono">{formatCurrency(parseFloat(adjAmount))}</TableCell>
                        </TableRow>
                      </>
                    ) : (
                      <>
                        <TableRow>
                          <TableCell className="text-xs py-1">
                            {expenseAccounts.find((a: any) => a.id === adjAccountId)?.account_name || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-right py-1 font-mono">{formatCurrency(parseFloat(adjAmount))}</TableCell>
                          <TableCell className="text-xs text-right py-1">—</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="text-xs py-1">{(recon as any).accounts?.account_name || "Bank Account"}</TableCell>
                          <TableCell className="text-xs text-right py-1">—</TableCell>
                          <TableCell className="text-xs text-right py-1 font-mono">{formatCurrency(parseFloat(adjAmount))}</TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
                <p className="text-[10px] text-muted-foreground">Ref: Reconciliation Adjustment · {adjDesc || "—"}</p>
              </div>
            )}

            <Button
              onClick={handleAddAdjustment}
              disabled={createAdj.isPending || !adjAmount || parseFloat(adjAmount) <= 0 || !adjAccountId || !adjDesc}
              className="w-full"
            >
              {createAdj.isPending ? "Adding..." : "Save Adjustment & Create Journal Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
