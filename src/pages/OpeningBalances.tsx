import { useState, useMemo } from "react";
import { Plus, Trash2, Save, AlertTriangle, CheckCircle2, Lock, Calendar, Shield, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { useSaveOpeningBalances, useOBEBalance } from "@/hooks/useOpeningBalanceEquity";
import {
  useSystemSetting,
  useSaveSystemSetting,
  useOpeningBalanceStatus,
  useFinalizeOpeningBalances,
  useRevertToDraft,
} from "@/hooks/useOpeningBalanceSettings";
import { toast } from "sonner";
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
import { getNormalBalance, isOpeningBalanceEligible, OPENING_BALANCE_INELIGIBLE_REASON } from "@/lib/accountTypes";

interface BalanceLine {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
}

function newLine(): BalanceLine {
  return { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 };
}

export default function OpeningBalances() {
  const { appUser } = useAuth();
  const { data: accounts } = useActiveAccounts();
  const { data: obeBalance } = useOBEBalance();
  const { data: obeClosed } = useSystemSetting("obe_closed");
  const { data: obStatus } = useOpeningBalanceStatus();
  const { data: obDate } = useSystemSetting("opening_balance_date");
  const saveMutation = useSaveOpeningBalances();
  const saveSettingMutation = useSaveSystemSetting();
  const finalizeMutation = useFinalizeOpeningBalances();
  const revertMutation = useRevertToDraft();

  const [lines, setLines] = useState<BalanceLine[]>([newLine(), newLine()]);
  const [entryDate, setEntryDate] = useState(() => obDate || new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("Opening Balance Entry");

  const isClosed = obeClosed === "true";
  const isFinalized = obStatus === "finalized";
  const isDraft = !obStatus || obStatus === "draft";
  const isEditable = isDraft && !isClosed;

  // Filter to eligible accounts only (Asset, Liability, Equity) and exclude system accounts
  const selectableAccounts = useMemo(() => {
    return (accounts || []).filter((a: any) => !a.is_system && isOpeningBalanceEligible(a.account_type));
  }, [accounts]);

  const totalDebits = useMemo(() => lines.reduce((s, l) => s + l.debit, 0), [lines]);
  const totalCredits = useMemo(() => lines.reduce((s, l) => s + l.credit, 0), [lines]);
  const difference = totalDebits - totalCredits;

  // Validation: check account types vs normal balance + eligibility
  const validationWarnings = useMemo(() => {
    const warnings: string[] = [];
    lines.forEach((l) => {
      if (!l.account_id) return;
      const acct = (accounts || []).find((a: any) => a.id === l.account_id) as any;
      if (!acct) return;
      // Block ineligible account types
      if (!isOpeningBalanceEligible(acct.account_type)) {
        warnings.push(`❌ ${acct.account_name} (${acct.account_type}) cannot have an opening balance`);
        return;
      }
      const normal = getNormalBalance(acct.account_type);
      if (normal === "Debit" && l.credit > 0 && l.debit === 0) {
        warnings.push(`${acct.account_name} normally has a Debit balance but has a Credit entry`);
      }
      if (normal === "Credit" && l.debit > 0 && l.credit === 0) {
        warnings.push(`${acct.account_name} normally has a Credit balance but has a Debit entry`);
      }
    });
    return warnings;
  }, [lines, accounts]);

  const updateLine = (id: string, field: keyof BalanceLine, value: any) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSaveDate = () => {
    if (!entryDate) {
      toast.error("Please select an opening balance date");
      return;
    }
    saveSettingMutation.mutate(
      { key: "opening_balance_date", value: entryDate },
      { onSuccess: () => toast.success("Opening balance date saved") }
    );
  };

  const handleSave = () => {
    const validLines = lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
    if (validLines.length === 0) {
      toast.error("Enter at least one account with a debit or credit amount");
      return;
    }
    if (lines.some((l) => l.debit < 0 || l.credit < 0)) {
      toast.error("Negative values are not allowed");
      return;
    }
    if (validLines.some((l) => l.debit > 0 && l.credit > 0)) {
      toast.error("A line cannot have both debit and credit");
      return;
    }

    // Use opening_balance_date if set
    const useDate = obDate || entryDate;

    saveMutation.mutate({
      lines: validLines.map((l) => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
      })),
      entry_date: useDate,
      description,
    });
  };

  // Closed state
  if (isClosed) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-description">Enter opening balances for your accounts</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">Opening balances finalized</h2>
            <p className="text-sm text-muted-foreground">
              Opening Balance Equity has been closed. Opening balance editing is locked.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Finalized state — read-only with option to revert
  if (isFinalized) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-description">Opening balances have been finalized</p>
          </div>
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={revertMutation.isPending}>
                  Revert to Draft
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revert to Draft?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will unlock opening balance editing. Existing entries will not be deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => revertMutation.mutate()}>Revert</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <Shield className="w-10 h-10 text-primary mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">Opening Balances Finalized</h2>
            <p className="text-sm text-muted-foreground">
              Opening balances are locked. To make changes, revert to draft status first.
            </p>
            {obeBalance && obeBalance.type !== "zero" && (
              <div className="inline-flex items-center gap-2 bg-warning/10 text-warning px-3 py-2 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4" />
                OBE Balance: {formatCurrency(obeBalance.balance)} ({obeBalance.type})
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Opening Balances</h1>
          <p className="page-description">
            Enter opening balances for your accounts. The system will auto-balance using Opening Balance Equity.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            Status: {isDraft ? "Draft" : isFinalized ? "Finalized" : "Closed"}
          </Badge>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <FileCheck className="w-4 h-4 mr-1" />
                Finalize
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Finalize Opening Balances?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will lock all opening balance entries. You can still revert to draft if needed.
                  {Math.abs(difference) > 0.005 && (
                    <span className="block mt-2 text-warning font-medium">
                      ⚠️ Current entries have a difference of {formatCurrency(Math.abs(difference))}. 
                      The system will auto-balance with OBE.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => finalizeMutation.mutate()}>Finalize</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-1" />
            {saveMutation.isPending ? "Saving…" : "Save Entry"}
          </Button>
        </div>
      </div>

      {/* Current OBE Balance Warning */}
      {obeBalance && obeBalance.type !== "zero" && (
        <div className="flex items-center gap-3 bg-warning/10 text-warning border border-warning/20 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Opening Balance Equity has a balance of {formatCurrency(obeBalance.balance)}</span>
            <span className="text-warning/80 ml-1">({obeBalance.type === "debit" ? "Debit" : "Credit"})</span>
          </div>
        </div>
      )}

      {/* Validation Warnings */}
      {validationWarnings.length > 0 && (
        <div className="bg-warning/5 border border-warning/20 rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-warning">Normal Balance Warnings:</p>
          {validationWarnings.map((w, i) => (
            <p key={i} className="text-xs text-warning/80">• {w}</p>
          ))}
        </div>
      )}

      {/* Opening Balance Date + Entry metadata */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Opening Balance Date
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
                {(!obDate || obDate !== entryDate) && (
                  <Button variant="outline" size="sm" onClick={handleSaveDate} disabled={saveSettingMutation.isPending}>
                    Set as Global Date
                  </Button>
                )}
              </div>
              {obDate && (
                <p className="text-[10px] text-muted-foreground">
                  Global opening balance date: <span className="font-semibold">{obDate}</span>
                </p>
              )}
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lines table */}
      <Card>
        <CardContent className="pt-6 p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-[45%]">Account</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-[20%]">Debit</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-[20%]">Credit</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground w-[15%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const acct = selectableAccounts.find((a: any) => a.id === line.account_id) as any;
                  const normal = acct ? getNormalBalance(acct.account_type) : null;
                  const isWrongSide = normal && (
                    (normal === "Debit" && line.credit > 0 && line.debit === 0) ||
                    (normal === "Credit" && line.debit > 0 && line.credit === 0)
                  );
                  return (
                    <tr key={line.id} className={`border-b hover:bg-muted/10 transition-colors ${isWrongSide ? "bg-warning/5" : ""}`}>
                      <td className="px-4 py-2">
                        <select
                          value={line.account_id}
                          onChange={(e) => updateLine(line.id, "account_id", e.target.value)}
                          className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">Select account…</option>
                          {selectableAccounts.map((a: any) => (
                            <option key={a.id} value={a.id}>
                              {a.account_code} — {a.account_name}
                            </option>
                          ))}
                        </select>
                        {isWrongSide && (
                          <p className="text-[10px] text-warning mt-0.5">
                            ⚠ Opposite to normal {normal} balance
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit || ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            updateLine(line.id, "debit", v);
                            if (v > 0) updateLine(line.id, "credit", 0);
                          }}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-right"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit || ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            updateLine(line.id, "credit", v);
                            if (v > 0) updateLine(line.id, "debit", 0);
                          }}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-right"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => removeLine(line.id)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          disabled={lines.length <= 1}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {/* OBE auto-balance row */}
                {Math.abs(difference) > 0.005 && (
                  <tr className="bg-muted/20 border-b">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground italic">
                          Opening Balance Equity — System Adjustment
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-sm text-muted-foreground italic">
                      {difference < 0 ? formatCurrency(Math.abs(difference)) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-sm text-muted-foreground italic">
                      {difference > 0 ? formatCurrency(difference) : "—"}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">Auto</span>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground/20">
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setLines((p) => [...p, newLine()])}>
                      <Plus className="w-4 h-4 mr-1" /> Add Line
                    </Button>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-sm">
                    {formatCurrency(totalDebits)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-sm">
                    {formatCurrency(totalCredits)}
                  </td>
                  <td />
                </tr>
                <tr>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground font-medium" colSpan={2}>
                    Difference:
                  </td>
                  <td className={`px-4 py-2 text-right text-sm font-bold ${Math.abs(difference) > 0.005 ? "text-warning" : "text-success"}`}>
                    {formatCurrency(Math.abs(difference))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
