import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAccounts } from "@/hooks/useData";
import { useCreateReconciliation, useLastReconciliation } from "@/hooks/useBankReconciliation";
import { formatCurrency } from "@/lib/currency";
import { Landmark } from "lucide-react";

interface Props {
  onStarted: (id: string) => void;
  onCancel: () => void;
}

export default function ReconciliationSetup({ onStarted, onCancel }: Props) {
  const { data: accounts } = useAccounts();
  const createReconciliation = useCreateReconciliation();

  const bankAccounts = (accounts || []).filter(
    (a: any) => a.account_type === "Asset" && (a.account_name.toLowerCase().includes("bank") || a.account_name.toLowerCase().includes("cash"))
  );

  const [bankAccountId, setBankAccountId] = useState("");
  const [statementEndDate, setStatementEndDate] = useState("");
  const [manualBeginningBalance, setManualBeginningBalance] = useState("");
  const [statementEndBalance, setStatementEndBalance] = useState("");
  const [serviceCharges, setServiceCharges] = useState("");
  const [serviceChargeAccount, setServiceChargeAccount] = useState("");
  const [interestEarned, setInterestEarned] = useState("");
  const [interestAccount, setInterestAccount] = useState("");
  const [statementRef, setStatementRef] = useState("");
  const [notes, setNotes] = useState("");

  const { data: lastRecon } = useLastReconciliation(bankAccountId || undefined);
  const isFirstReconciliation = !lastRecon;
  const beginningBalance = isFirstReconciliation
    ? (manualBeginningBalance ? parseFloat(manualBeginningBalance) : 0)
    : (lastRecon?.statement_ending_balance ?? 0);

  const expenseAccounts = (accounts || []).filter((a: any) => a.account_type === "Expense");
  const incomeAccounts = useMemo(
    () =>
      (accounts || []).filter((a: any) => {
        const categoryName = a.account_categories?.name;
        return a.account_type === "Income" || a.account_type === "Other Income" || categoryName === "Other Income";
      }),
    [accounts]
  );

  const defaultInterestAccountId = useMemo(() => {
    const exactMatch = incomeAccounts.find((a: any) => a.account_name.toLowerCase() === "interest income");
    const fuzzyMatch = incomeAccounts.find((a: any) => a.account_name.toLowerCase().includes("interest"));
    return exactMatch?.id || fuzzyMatch?.id || incomeAccounts[0]?.id || "";
  }, [incomeAccounts]);

  useEffect(() => {
    if (!interestAccount && defaultInterestAccountId) {
      setInterestAccount(defaultInterestAccountId);
    }
  }, [defaultInterestAccountId, interestAccount]);

  // Auto-fill interest earned date & amount from last reconciliation
  useEffect(() => {
    if (lastRecon) {
      if (lastRecon.interest_earned && Number(lastRecon.interest_earned) > 0) {
        setInterestEarned(String(lastRecon.interest_earned));
      }
      if (lastRecon.statement_ending_date) {
        // No-op: interest date is tied to statement date (read-only field)
      }
    } else {
      setInterestEarned("");
    }
  }, [lastRecon]);

  const handleStart = async () => {
    if (!bankAccountId || !statementEndDate || !statementEndBalance) return;
    const result = await createReconciliation.mutateAsync({
      bank_account_id: bankAccountId,
      statement_ending_date: statementEndDate,
      statement_ending_balance: parseFloat(statementEndBalance),
      beginning_balance: beginningBalance,
      service_charges: serviceCharges ? parseFloat(serviceCharges) : 0,
      interest_earned: interestEarned ? parseFloat(interestEarned) : 0,
      notes: notes || undefined,
    });
    onStarted(result.id);
  };

  const selectedAccount = bankAccounts.find((a: any) => a.id === bankAccountId);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Landmark className="w-5 h-5 text-primary" />
          Begin Reconciliation
        </CardTitle>
        <CardDescription>
          Select an account to reconcile, then enter the ending balance from your bank statement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Account Selection */}
        <div className="space-y-2">
          <Label className="font-semibold">Account *</Label>
          <Select value={bankAccountId} onValueChange={setBankAccountId}>
            <SelectTrigger><SelectValue placeholder="Select bank account to reconcile" /></SelectTrigger>
            <SelectContent>
              {bankAccounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_code} – {a.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {bankAccountId && (
          <>
            <Separator />

            {/* Statement Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-semibold">Statement Date *</Label>
                <Input type="date" value={statementEndDate} onChange={(e) => setStatementEndDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold">Statement Ending Balance *</Label>
                <Input type="number" step="0.01" value={statementEndBalance} onChange={(e) => setStatementEndBalance(e.target.value)} placeholder="0.00" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Statement Reference</Label>
                <Input value={statementRef} onChange={(e) => setStatementRef(e.target.value)} placeholder="e.g. Feb 2026 Statement" />
              </div>
              <div className="space-y-1">
                <Label className="font-semibold">Beginning Balance {isFirstReconciliation ? "*" : ""}</Label>
                {isFirstReconciliation ? (
                  <Input
                    type="number"
                    step="0.01"
                    value={manualBeginningBalance}
                    onChange={(e) => setManualBeginningBalance(e.target.value)}
                    placeholder="Enter opening balance"
                  />
                ) : (
                  <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm font-medium">
                    {formatCurrency(beginningBalance)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isFirstReconciliation
                    ? "First reconciliation — enter your bank's opening balance"
                    : "From last reconciliation"}
                </p>
              </div>
            </div>

            <Separator />

            {/* Service Charges */}
            <div>
              <p className="text-sm font-semibold mb-2">Service Charge</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={statementEndDate} readOnly className="bg-muted/20 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" step="0.01" value={serviceCharges} onChange={(e) => setServiceCharges(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Account</Label>
                  <Select value={serviceChargeAccount} onValueChange={setServiceChargeAccount}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="Expense account" /></SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Interest Earned */}
            <div>
              <p className="text-sm font-semibold mb-2">Interest Earned</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={statementEndDate} readOnly className="bg-muted/20 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" step="0.01" value={interestEarned} onChange={(e) => setInterestEarned(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Account</Label>
                  <Select value={interestAccount} onValueChange={setInterestAccount}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="Income account" /></SelectTrigger>
                    <SelectContent>
                      {incomeAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for this reconciliation..." rows={2} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
              <Button
                onClick={handleStart}
                disabled={!bankAccountId || !statementEndDate || !statementEndBalance || createReconciliation.isPending}
              >
                {createReconciliation.isPending ? "Starting..." : "Start Reconciliation"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
