import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccounts } from "@/hooks/useData";
import { useCreateReconciliation, useLastReconciliation } from "@/hooks/useBankReconciliation";
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
  const [statementEndBalance, setStatementEndBalance] = useState("");
  const [serviceCharges, setServiceCharges] = useState("");
  const [interestEarned, setInterestEarned] = useState("");
  const [notes, setNotes] = useState("");

  const { data: lastRecon } = useLastReconciliation(bankAccountId || undefined);
  const beginningBalance = lastRecon?.statement_ending_balance ?? 0;

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

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" />
          Start Bank Reconciliation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Bank Account *</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_code} – {a.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Statement Ending Date *</Label>
            <Input type="date" value={statementEndDate} onChange={(e) => setStatementEndDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Beginning Balance</Label>
            <Input type="number" value={beginningBalance} readOnly className="bg-muted/30" />
            <p className="text-xs text-muted-foreground">Auto-filled from last reconciliation</p>
          </div>
          <div className="space-y-2">
            <Label>Statement Ending Balance *</Label>
            <Input type="number" step="0.01" value={statementEndBalance} onChange={(e) => setStatementEndBalance(e.target.value)} placeholder="0.00" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Service Charges</Label>
            <Input type="number" step="0.01" value={serviceCharges} onChange={(e) => setServiceCharges(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-2">
            <Label>Interest Earned</Label>
            <Input type="number" step="0.01" value={interestEarned} onChange={(e) => setInterestEarned(e.target.value)} placeholder="0.00" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={handleStart}
            disabled={!bankAccountId || !statementEndDate || !statementEndBalance || createReconciliation.isPending}
          >
            {createReconciliation.isPending ? "Starting..." : "Start Reconciliation"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
