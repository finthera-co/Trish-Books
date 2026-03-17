import { useState, useMemo } from "react";
import { Plus, Trash2, Save, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useActiveAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { useSaveOpeningBalances, useOBEBalance, useSystemSetting } from "@/hooks/useOpeningBalanceEquity";
import { toast } from "sonner";

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
  const saveMutation = useSaveOpeningBalances();

  const [lines, setLines] = useState<BalanceLine[]>([newLine(), newLine()]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("Opening Balance Entry");

  const isLocked = obeClosed === "true";

  // Filter out system accounts from dropdown
  const selectableAccounts = useMemo(() => {
    return (accounts || []).filter((a: any) => !a.is_system);
  }, [accounts]);

  const totalDebits = useMemo(() => lines.reduce((s, l) => s + l.debit, 0), [lines]);
  const totalCredits = useMemo(() => lines.reduce((s, l) => s + l.credit, 0), [lines]);
  const difference = totalDebits - totalCredits;

  const updateLine = (id: string, field: keyof BalanceLine, value: any) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSave = () => {
    const validLines = lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
    if (validLines.length === 0) {
      toast.error("Enter at least one account with a debit or credit amount");
      return;
    }
    // Check for negative values
    if (lines.some((l) => l.debit < 0 || l.credit < 0)) {
      toast.error("Negative values are not allowed");
      return;
    }
    // Check for lines with both debit and credit
    if (validLines.some((l) => l.debit > 0 && l.credit > 0)) {
      toast.error("A line cannot have both debit and credit");
      return;
    }
    saveMutation.mutate({
      lines: validLines.map((l) => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
      })),
      entry_date: entryDate,
      description,
    });
  };

  if (isLocked) {
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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Opening Balances</h1>
          <p className="page-description">
            Enter opening balances for your accounts. The system will auto-balance using Opening Balance Equity.
          </p>
        </div>
        <div className="flex gap-2">
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

      {/* Entry metadata */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Entry Date</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
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
                {lines.map((line) => (
                  <tr key={line.id} className="border-b hover:bg-muted/10 transition-colors">
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
                ))}

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
