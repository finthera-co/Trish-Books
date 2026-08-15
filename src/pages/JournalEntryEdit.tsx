import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Info, FileText } from "lucide-react";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import { toast } from "sonner";
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  validateJournalEntry,
  getManualEntryAccounts,
  isSubledgerAccount,
  deriveEntryDescription,
  normalizeLineMemo,
  resolveLineMemo,
  bySeq,
  LINE_MEMO_MAX,
  type AccountInfo,
  type ValidationResult,
  EPSILON,
} from "@/lib/journalValidation";
import { typeColors, getTypeLabel } from "@/lib/accountTypes";

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface EditLine {
  id?: string;
  account_id: string;
  debit: number;
  credit: number;
  /** Per-line narration. Blank lines inherit the entry description on load. */
  memo: string;
  /**
   * The account this line was loaded with. Saving replaces every line, and the
   * sub-ledger dimensions below only stay meaningful while the account is
   * unchanged — re-pointing a line from A/R to Bank must not carry the customer
   * across with it.
   */
  original_account_id?: string;
  customer_id?: string | null;
  vendor_id?: string | null;
  item_id?: string | null;
  asset_id?: string | null;
  cost_center_id?: string | null;
}

export default function JournalEntryEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  const { data: accounts } = useAccounts();

  const { data: entry, isLoading, error } = useQuery({
    queryKey: ["journal_entry", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(*, accounts(account_name, account_code, account_type))")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Check if in closed period
  const { data: closedPeriods } = useQuery({
    queryKey: ["closed_fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("period_start, period_end")
        .eq("status", "closed");
      if (error) throw error;
      return data;
    },
  });

  // Form state. The entry description is derived from the lines (see
  // `derivedDescription`), so there is no field for it.
  const [entryDate, setEntryDate] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Pre-fill form when entry loads
  useEffect(() => {
    if (entry && !initialized) {
      setEntryDate(entry.entry_date);
      setReference(entry.reference || "");
      const entryLines = ((entry.journal_lines as any[]) || [])
        // Match the order the lines post and report in, not whatever order the
        // embedded select happened to return.
        .slice()
        .sort(bySeq);
      setLines(
        entryLines.map((l: any) => ({
          id: l.id,
          account_id: l.account_id,
          original_account_id: l.account_id,
          debit: Number(l.debit),
          credit: Number(l.credit),
          // Entries posted before line descriptions existed, and every
          // system-generated entry, have no memo. Seed each line with the
          // description it has been displaying all along rather than making the
          // user retype it to get past validation.
          memo: resolveLineMemo(l.memo, entry.description),
          customer_id: l.customer_id ?? null,
          vendor_id: l.vendor_id ?? null,
          item_id: l.item_id ?? null,
          asset_id: l.asset_id ?? null,
          cost_center_id: l.cost_center_id ?? null,
        }))
      );
      setInitialized(true);
    }
  }, [entry, initialized]);

  // Accounts map for validation
  const accountsMap = useMemo(() => {
    const map = new Map<string, AccountInfo>();
    accounts?.forEach((a) => {
      map.set(a.id, {
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        account_subtype: a.account_subtype,
        is_active: a.is_active,
      });
    });
    return map;
  }, [accounts]);

  const manualEntryAccounts = useMemo(() => {
    if (!accounts) return [];
    const infos: AccountInfo[] = accounts.map((a) => ({
      id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
      account_type: a.account_type,
      account_subtype: a.account_subtype,
      is_active: a.is_active,
    }));
    return getManualEntryAccounts(infos);
  }, [accounts]);

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountInfo[]> = {};
    manualEntryAccounts.forEach((a) => {
      if (!groups[a.account_type]) groups[a.account_type] = [];
      groups[a.account_type].push(a);
    });
    return groups;
  }, [manualEntryAccounts]);

  // The entry-level description this save will write, taken from the lines.
  const derivedDescription = useMemo(() => deriveEntryDescription(lines), [lines]);

  // Validation
  const validation: ValidationResult = useMemo(() => {
    return validateJournalEntry({
      description: derivedDescription,
      entryDate,
      lines,
      accountsMap,
      closedPeriods: closedPeriods || undefined,
    });
  }, [derivedDescription, entryDate, lines, accountsMap, closedPeriods]);

  // Line-level errors render on the line itself rather than in the summary panel.
  const lineMemoErrors = useMemo(() => {
    const map = new Map<number, string>();
    validation.errors.forEach((e) => {
      const m = /^lines\[(\d+)\]\.memo$/.exec(e.field);
      if (m) map.set(Number(m[1]), e.message);
    });
    return map;
  }, [validation.errors]);

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < EPSILON && totalDebit > 0;

  const addLine = () => setLines([...lines, { account_id: "", debit: 0, credit: 0, memo: "" }]);
  const removeLine = (index: number) => {
    if (lines.length > 2) setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines];
    if (field === "debit" && Number(value) > 0) {
      (newLines[index] as any)["credit"] = 0;
    } else if (field === "credit" && Number(value) > 0) {
      (newLines[index] as any)["debit"] = 0;
    }
    (newLines[index] as any)[field] = value;
    setLines(newLines);
  };

  const getLineWarning = useCallback(
    (accountId: string): string | null => {
      if (!accountId) return null;
      const acc = accountsMap.get(accountId);
      if (!acc) return null;
      if (!acc.is_active) return "This account is inactive";
      const subType = isSubledgerAccount(acc);
      if (subType === "AR") return "AR control account — use Invoices instead";
      if (subType === "AP") return "AP control account — use Bills instead";
      return null;
    },
    [accountsMap]
  );

  // Save mutation — updates the SAME transaction
  const saveEntry = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("No entry ID");

      // 1. Update journal entry header. The description is the first line's —
      // journal_entries.description is what the entry list and every export
      // show, so it is derived rather than dropped.
      const { error: headerError } = await supabase
        .from("journal_entries")
        .update({
          description: derivedDescription,
          entry_date: entryDate,
          // reference stays the same (not editable in edit mode)
        })
        .eq("id", id);
      if (headerError) throw headerError;

      // 2. Delete existing lines
      const { error: deleteError } = await supabase
        .from("journal_lines")
        .delete()
        .eq("journal_entry_id", id);
      if (deleteError) throw deleteError;

      // 3. Insert updated lines
      const activeLines = lines.filter(
        (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
      );
      // Saving replaces the lines wholesale, so anything not restated here is
      // lost. The sub-ledger dimensions are carried across for lines whose
      // account did not change; on a re-pointed line they would be wrong, so
      // they are dropped with the account they described.
      const newLines = activeLines.map((l) => {
        const sameAccount = l.original_account_id === l.account_id;
        return {
          journal_entry_id: id,
          account_id: l.account_id,
          debit: Number(l.debit),
          credit: Number(l.credit),
          memo: normalizeLineMemo(l.memo),
          customer_id: sameAccount ? l.customer_id ?? null : null,
          vendor_id: sameAccount ? l.vendor_id ?? null : null,
          item_id: sameAccount ? l.item_id ?? null : null,
          asset_id: sameAccount ? l.asset_id ?? null : null,
          cost_center_id: sameAccount ? l.cost_center_id ?? null : null,
        };
      });

      const { error: linesError } = await supabase.from("journal_lines").insert(newLines);
      if (linesError) throw linesError;

      // 4. Audit log
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const tenantId = await supabase.rpc("get_user_tenant_id");
        const userId = await supabase
          .from("users")
          .select("id")
          .eq("auth_user_id", user?.id || "")
          .maybeSingle();

        await supabase.from("audit_logs").insert({
          action: "Journal Entry Updated",
          table_name: "journal_entries",
          record_id: id,
          user_id: userId.data?.id,
          tenant_id: tenantId.data,
          details: { description: derivedDescription, entry_date: entryDate, lines_count: activeLines.length },
        });
      } catch {
        // Silently fail audit log
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entry", id] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Journal Entry updated successfully");
      navigate(`/accounting/journals/${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!validation.valid) {
      toast.error(validation.errors[0]?.message || "Please fix validation errors");
      return;
    }
    saveEntry.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <FileText className="w-12 h-12 text-muted-foreground/30" />
        <h2 className="text-lg font-semibold text-foreground">Journal Entry not found</h2>
        <Button variant="outline" onClick={() => navigate("/accounting/ledger")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Register
        </Button>
      </div>
    );
  }

  if (entry.status === "voided") {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <AlertTriangle className="w-12 h-12 text-warning" />
        <h2 className="text-lg font-semibold text-foreground">Cannot edit voided entry</h2>
        <Button variant="outline" onClick={() => navigate(`/accounting/journals/${id}`)}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to View
        </Button>
      </div>
    );
  }

  // Block manual editing of system-generated OBE entries
  if (entry.entry_type === "opening_balance" && entry.is_system_generated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <AlertTriangle className="w-12 h-12 text-warning" />
        <h2 className="text-lg font-semibold text-foreground">Cannot manually edit OBE entry</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          This is a system-generated Opening Balance entry. To modify opening balances, use the Opening Balances screen.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/accounting/journals/${id}`)}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to View
          </Button>
          <Button onClick={() => navigate("/accounting/opening-balances")}>
            Go to Opening Balances
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/accounting/journals/${id}`)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to View
        </Button>
      </div>

      <div className="stat-card">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Edit Journal Entry</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Reference: <span className="font-mono">{entry.reference || "—"}</span> · ID: {entry.id.slice(0, 8)}…
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Header fields. No entry-level description: each line carries its own. */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">
                Date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
              />
              {validation.errors.find((e) => e.field === "entry_date") && (
                <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {validation.errors.find((e) => e.field === "entry_date")!.message}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Reference</label>
              <input
                type="text"
                value={reference}
                disabled
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-muted text-muted-foreground cursor-not-allowed"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Reference cannot be changed</p>
            </div>
          </div>

          {/* Journal Lines */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Journal Lines</label>
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_6.75rem_6.75rem_2rem] gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                <span>Account</span>
                <span>Description</span>
                <span className="text-right">Debit (LKR)</span>
                <span className="text-right">Credit (LKR)</span>
                <span />
              </div>
              <div className="divide-y divide-border/50">
                {lines.map((line, i) => {
                  const lineWarning = getLineWarning(line.account_id);
                  const acc = line.account_id ? accountsMap.get(line.account_id) : null;
                  const memoError = lineMemoErrors.get(i);
                  return (
                    <div key={i} className="px-3 py-2 space-y-1">
                      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_6.75rem_6.75rem_2rem] gap-2 items-center">
                        <select
                          value={line.account_id}
                          onChange={(e) => updateLine(i, "account_id", e.target.value)}
                          className={`text-sm border rounded-md px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors ${
                            lineWarning ? "border-warning" : "border-input"
                          }`}
                        >
                          <option value="">Select account…</option>
                          {Object.entries(groupedAccounts).map(([type, accs]) => (
                            <optgroup key={type} label={getTypeLabel(type)}>
                              {accs.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.account_code} – {a.account_name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={line.memo}
                          maxLength={LINE_MEMO_MAX}
                          onChange={(e) => updateLine(i, "memo", e.target.value)}
                          className={`text-sm border rounded-md px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors ${
                            memoError ? "border-destructive" : "border-input"
                          }`}
                          placeholder="What this line is for"
                          aria-label={`Line ${i + 1} description`}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit || ""}
                          onChange={(e) => updateLine(i, "debit", Number(e.target.value))}
                          className="text-sm border border-input rounded-md px-2.5 py-1.5 bg-background text-foreground text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="0.00"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit || ""}
                          onChange={(e) => updateLine(i, "credit", Number(e.target.value))}
                          className="text-sm border border-input rounded-md px-2.5 py-1.5 bg-background text-foreground text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                          placeholder="0.00"
                        />
                        <button
                          onClick={() => removeLine(i)}
                          disabled={lines.length <= 2}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed text-sm px-1 h-8 flex items-center justify-center rounded-md transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                      {acc && (
                        <div className="flex items-center gap-2 pl-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeColors[acc.account_type] || "bg-muted text-muted-foreground"}`}>
                            {getTypeLabel(acc.account_type)}
                          </span>
                          {acc.account_subtype && (
                            <span className="text-[10px] text-muted-foreground">{acc.account_subtype}</span>
                          )}
                        </div>
                      )}
                      {memoError && (
                        <div className="flex items-center gap-1.5 text-xs text-destructive pl-1">
                          <XCircle className="w-3 h-3 shrink-0" />
                          {memoError}
                        </div>
                      )}
                      {lineWarning && (
                        <div className="flex items-center gap-1.5 text-xs text-warning pl-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {lineWarning}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-3 py-2 border-t border-border">
                <Button variant="ghost" size="sm" onClick={addLine} className="text-xs">
                  + Add Line
                </Button>
              </div>
            </div>
          </div>

          {/* Budget Warnings for expense debit lines */}
          {lines.filter(l => l.account_id && l.debit > 0).map((line, idx) => {
            const acc = accountsMap.get(line.account_id);
            if (!acc || (acc.account_type !== "Expense" && acc.account_type !== "Cost of Goods Sold")) return null;
            return (
              <BudgetWarningBanner
                key={`je-edit-budget-${idx}-${line.account_id}`}
                accountId={line.account_id}
                amount={line.debit}
                transactionDate={entryDate}
              />
            );
          })}

          {/* Validation Panel */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="space-y-2">
              {validation.errors.filter(e => !["entry_date", "description"].includes(e.field) && !/^lines\[\d+\]\.memo$/.test(e.field)).map((err, i) => (
                <div key={`err-${i}`} className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-md px-3 py-2 border border-destructive/20">
                  <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{err.message}</span>
                </div>
              ))}
              {validation.warnings.map((w, i) => (
                <div key={`warn-${i}`} className="flex items-start gap-2 text-xs text-warning bg-warning/5 rounded-md px-3 py-2 border border-warning/20">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Totals bar */}
          <div className="flex items-center justify-between text-sm bg-card rounded-lg px-4 py-3 border border-border">
            <span className="tabular-nums text-foreground">
              Debit: <strong>LKR {fmt(totalDebit)}</strong>
            </span>
            <span className="tabular-nums text-foreground">
              Credit: <strong>LKR {fmt(totalCredit)}</strong>
            </span>
            <span className={`font-semibold flex items-center gap-1.5 ${isBalanced ? "text-success" : "text-destructive"}`}>
              {isBalanced ? (
                <><CheckCircle2 className="w-4 h-4" /> Balanced</>
              ) : (
                <><XCircle className="w-4 h-4" /> Off by LKR {fmt(Math.abs(totalDebit - totalCredit))}</>
              )}
            </span>
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Saving will update this journal entry in place. The same transaction ID and reference will be preserved.
              All affected account balances will be recalculated automatically. Each line's description is what the
              General Ledger and Account Register show against that account; the entry is filed under the first line's.
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!validation.valid || saveEntry.isPending}
              className="flex-1"
            >
              {saveEntry.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save Changes"
              )}
            </Button>
            <Button variant="outline" onClick={() => navigate(`/accounting/journals/${id}`)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
