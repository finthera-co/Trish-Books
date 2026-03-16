import { Plus, Search, RotateCcw, Ban, ChevronDown, ChevronRight, Filter, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, Fragment, useMemo, useCallback } from "react";
import { useJournalEntries, useAccounts } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  validateJournalEntry,
  getManualEntryAccounts,
  isSubledgerAccount,
  type AccountInfo,
  type ValidationError,
  type ValidationResult,
  EPSILON,
} from "@/lib/journalValidation";
import { typeColors, getTypeLabel } from "@/lib/accountTypes";

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type StatusFilter = "all" | "posted" | "voided";

export default function JournalEntries() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Void dialog
  const [voidDialogId, setVoidDialogId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Reverse dialog
  const [reverseDialogId, setReverseDialogId] = useState<string | null>(null);

  // Form
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState([
    { account_id: "", debit: 0, credit: 0 },
    { account_id: "", debit: 0, credit: 0 },
  ]);

  const { data: entries, isLoading } = useJournalEntries();
  const { data: accounts } = useAccounts();

  // Closed fiscal periods for date validation
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

  // Build accounts map for validation
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

  // Accounts filtered for manual entry (no control accounts)
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

  // Group accounts by type for the dropdown
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountInfo[]> = {};
    manualEntryAccounts.forEach((a) => {
      if (!groups[a.account_type]) groups[a.account_type] = [];
      groups[a.account_type].push(a);
    });
    return groups;
  }, [manualEntryAccounts]);

  // Real-time validation
  const validation: ValidationResult = useMemo(() => {
    return validateJournalEntry({
      description,
      entryDate,
      lines,
      accountsMap,
      closedPeriods: closedPeriods || undefined,
    });
  }, [description, entryDate, lines, accountsMap, closedPeriods]);

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < EPSILON && totalDebit > 0;

  // Filter entries
  const filtered = entries?.filter((e) => {
    const matchesSearch =
      e.description.toLowerCase().includes(search.toLowerCase()) ||
      (e.reference || "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  // Stats
  const totalPosted = entries?.filter(e => e.status === "posted").length || 0;
  const totalVoided = entries?.filter(e => e.status === "voided").length || 0;

  const addLine = () => setLines([...lines, { account_id: "", debit: 0, credit: 0 }]);
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

  // Get inline warning for a specific line's account
  const getLineWarning = useCallback(
    (accountId: string): string | null => {
      if (!accountId) return null;
      const acc = accountsMap.get(accountId);
      if (!acc) return null;
      if (!acc.is_active) return `This account is inactive`;
      const subType = isSubledgerAccount(acc);
      if (subType === "AR") return "AR control account — use Invoices instead";
      if (subType === "AP") return "AP control account — use Bills instead";
      return null;
    },
    [accountsMap]
  );

  // Server-side validated create via edge function
  const createEntry = useMutation({
    mutationFn: async () => {
      const activeLines = lines.filter(
        (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
      );

      const { data, error } = await supabase.functions.invoke("validate-journal-entry", {
        body: {
          description: description.trim(),
          entry_date: entryDate,
          reference: reference.trim() || undefined,
          lines: activeLines,
        },
      });

      if (error) throw new Error(error.message || "Server validation failed");

      // Edge function returns 422 for validation errors
      if (data && !data.valid && data.errors) {
        const msgs = data.errors.map((e: any) => e.message).join("; ");
        throw new Error(msgs);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Journal entry posted successfully");
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setDescription("");
    setReference("");
    setEntryDate(new Date().toISOString().split("T")[0]);
    setLines([
      { account_id: "", debit: 0, credit: 0 },
      { account_id: "", debit: 0, credit: 0 },
    ]);
  };

  const handleCreate = async () => {
    // Client-side pre-check
    if (!validation.valid) {
      toast.error(validation.errors[0]?.message || "Please fix validation errors");
      return;
    }
    createEntry.mutate();
  };

  // Void mutation
  const voidEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("journal_entries")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: appUser?.id,
          void_reason: voidReason,
        })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Journal entry voided");
      setVoidDialogId(null);
      setVoidReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Reverse mutation
  const reverseEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const entry = entries?.find(e => e.id === entryId);
      if (!entry) throw new Error("Entry not found");
      const originalLines = (entry.journal_lines as any[]) || [];

      const { data: newEntry, error } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser?.tenant_id,
          description: `Reversal of: ${entry.description}`,
          entry_date: new Date().toISOString().split("T")[0],
          reference: `REV-${entry.reference || entry.id.slice(0, 8)}`,
          created_by: appUser?.id,
          status: "posted",
          reversal_of: entryId,
        })
        .select()
        .single();
      if (error) throw error;

      const reversedLines = originalLines.map(line => ({
        journal_entry_id: newEntry.id,
        account_id: line.account_id,
        debit: Number(line.credit),
        credit: Number(line.debit),
      }));

      const { error: linesErr } = await supabase.from("journal_lines").insert(reversedLines);
      if (linesErr) throw linesErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Reversal entry created and posted");
      setReverseDialogId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getAccountName = (accountId: string) => {
    const acc = accounts?.find(a => a.id === accountId);
    return acc ? `${acc.account_code} – ${acc.account_name}` : accountId;
  };

  // Check if form has been touched (for showing validation)
  const formTouched = description.length > 0 || lines.some(l => l.account_id || Number(l.debit) > 0 || Number(l.credit) > 0);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-description">Record and manage double-entry transactions</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" /> New Entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Journal Entry</DialogTitle>
              <DialogDescription>
                Double-entry validated. Control accounts (AR/AP) are excluded — use Invoices or Bills for those.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {/* Header fields */}
              <div className="grid grid-cols-3 gap-4">
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
                  {formTouched && validation.errors.find((e) => e.field === "entry_date") && (
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
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                    placeholder="JV-00001"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Description <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                    placeholder="Office supplies purchase"
                  />
                </div>
              </div>

              {/* Journal Lines */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Journal Lines</label>
                <div className="border border-border rounded-lg overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_7rem_7rem_2.5rem] gap-0 bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                    <span>Account</span>
                    <span className="text-right">Debit (LKR)</span>
                    <span className="text-right">Credit (LKR)</span>
                    <span />
                  </div>
                  {/* Lines */}
                  <div className="divide-y divide-border/50">
                    {lines.map((line, i) => {
                      const lineWarning = getLineWarning(line.account_id);
                      const acc = line.account_id ? accountsMap.get(line.account_id) : null;
                      return (
                        <div key={i} className="px-3 py-2 space-y-1">
                          <div className="grid grid-cols-[1fr_7rem_7rem_2.5rem] gap-2 items-center">
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
                          {/* Inline account type badge + warning */}
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
                  {/* Add line */}
                  <div className="px-3 py-2 border-t border-border">
                    <Button variant="ghost" size="sm" onClick={addLine} className="text-xs">
                      + Add Line
                    </Button>
                  </div>
                </div>
              </div>

              {/* Validation Panel */}
              {formTouched && (validation.errors.length > 0 || validation.warnings.length > 0) && (
                <div className="space-y-2">
                  {validation.errors.filter(e => !["entry_date", "description"].includes(e.field)).map((err, i) => (
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

              {/* Info banner */}
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Entries are validated both client-side and server-side. Control accounts (A/R, A/P, Inventory) 
                  are automatically excluded — post to those via Invoices, Bills, or Payments.
                </span>
              </div>

              <Button
                onClick={handleCreate}
                disabled={!validation.valid || createEntry.isPending}
                className="w-full"
              >
                {createEntry.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Validating & Posting…
                  </span>
                ) : (
                  "Post Entry"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Void Dialog */}
      <Dialog open={!!voidDialogId} onOpenChange={(v) => { if (!v) { setVoidDialogId(null); setVoidReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Journal Entry</DialogTitle>
            <DialogDescription>Voiding marks this entry as invalid. It will no longer affect account balances.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium text-foreground">Reason for voiding <span className="text-destructive">*</span></label>
              <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                placeholder="e.g. Incorrect account used, duplicate entry…" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setVoidDialogId(null); setVoidReason(""); }} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={() => voidDialogId && voidEntry.mutate(voidDialogId)}
                disabled={!voidReason.trim() || voidEntry.isPending} className="flex-1">
                {voidEntry.isPending ? "Voiding…" : "Void Entry"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reverse Dialog */}
      <Dialog open={!!reverseDialogId} onOpenChange={(v) => { if (!v) setReverseDialogId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Journal Entry</DialogTitle>
            <DialogDescription>
              This creates a new posted entry with opposite debits and credits. Both entries remain in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {reverseDialogId && (() => {
              const entry = entries?.find(e => e.id === reverseDialogId);
              if (!entry) return null;
              const entryLines = (entry.journal_lines as any[]) || [];
              return (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">{entry.description}</p>
                  <p className="text-xs text-muted-foreground">Date: {entry.entry_date} · Ref: {entry.reference || "—"}</p>
                  <div className="mt-2 space-y-1">
                    {entryLines.map((line: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{line.accounts?.account_code} – {line.accounts?.account_name}</span>
                        <span className="tabular-nums">
                          {Number(line.debit) > 0 ? `Dr ${fmt(Number(line.debit))}` : `Cr ${fmt(Number(line.credit))}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReverseDialogId(null)} className="flex-1">Cancel</Button>
              <Button onClick={() => reverseDialogId && reverseEntry.mutate(reverseDialogId)}
                disabled={reverseEntry.isPending} className="flex-1">
                {reverseEntry.isPending ? "Reversing…" : "Confirm Reversal"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Entries</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{entries?.length || 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Posted</p>
          <p className="text-2xl font-bold text-success tabular-nums">{totalPosted}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Voided</p>
          <p className="text-2xl font-bold text-destructive tabular-nums">{totalVoided}</p>
        </div>
      </div>

      {/* Filters + Table */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Search description or reference…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            {(["all", "posted", "voided"] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent"
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No journal entries found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const entryTotalDebit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.debit), 0) || 0;
                const entryTotalCredit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.credit), 0) || 0;
                const isVoided = entry.status === "voided";
                const isReversal = !!(entry as any).reversal_of;
                const isExpanded = expandedId === entry.id;
                const entryLines = (entry.journal_lines as any[]) || [];

                return (
                  <Fragment key={entry.id}>
                    <tr
                      className={`cursor-pointer hover:bg-muted/50 ${isVoided ? "opacity-50" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <td className="px-2">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      </td>
                      <td className="text-muted-foreground text-sm">{entry.entry_date}</td>
                      <td className={`font-medium text-foreground ${isVoided ? "line-through" : ""}`}>
                        {entry.description}
                        {isReversal && <span className="ml-1.5 text-xs text-muted-foreground">(reversal)</span>}
                      </td>
                      <td className="font-mono text-xs text-muted-foreground">{entry.reference || "—"}</td>
                      <td className="text-right tabular-nums font-medium text-foreground">LKR {fmt(entryTotalDebit)}</td>
                      <td className="text-right tabular-nums font-medium text-foreground">LKR {fmt(entryTotalCredit)}</td>
                      <td>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          isVoided ? "bg-destructive/10 text-destructive" :
                          entry.status === "posted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                        }`}>{entry.status}</span>
                      </td>
                      <td className="text-right" onClick={e => e.stopPropagation()}>
                        {entry.status === "posted" && (
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="sm" title="Reverse" onClick={() => setReverseDialogId(entry.id)}>
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" title="Void" onClick={() => setVoidDialogId(entry.id)}>
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded line details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-muted/30 px-6 py-3">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted-foreground">
                                <th className="text-left font-medium pb-1.5">Account</th>
                                <th className="text-left font-medium pb-1.5 w-24">Type</th>
                                <th className="text-right font-medium pb-1.5 w-36">Debit</th>
                                <th className="text-right font-medium pb-1.5 w-36">Credit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entryLines.map((line: any, idx: number) => {
                                const lineAcc = accounts?.find(a => a.id === line.account_id);
                                return (
                                  <tr key={idx} className="border-t border-border/50">
                                    <td className="py-1.5 text-foreground">
                                      <span className="font-mono text-xs text-muted-foreground mr-2">{line.accounts?.account_code}</span>
                                      {line.accounts?.account_name || line.account_id}
                                    </td>
                                    <td className="py-1.5">
                                      {lineAcc && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeColors[lineAcc.account_type] || "bg-muted text-muted-foreground"}`}>
                                          {getTypeLabel(lineAcc.account_type)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="text-right tabular-nums py-1.5">
                                      {Number(line.debit) > 0 ? `LKR ${fmt(Number(line.debit))}` : "—"}
                                    </td>
                                    <td className="text-right tabular-nums py-1.5">
                                      {Number(line.credit) > 0 ? `LKR ${fmt(Number(line.credit))}` : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-border font-semibold text-foreground">
                                <td className="pt-1.5" colSpan={2}>Totals</td>
                                <td className="text-right tabular-nums pt-1.5">LKR {fmt(entryTotalDebit)}</td>
                                <td className="text-right tabular-nums pt-1.5">LKR {fmt(entryTotalCredit)}</td>
                              </tr>
                            </tfoot>
                          </table>
                          {isVoided && entry.void_reason && (
                            <p className="mt-2 text-xs text-destructive">
                              <strong>Void reason:</strong> {entry.void_reason}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
