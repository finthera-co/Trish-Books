import { Plus, Search, RotateCcw, Ban, ChevronDown, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, Fragment } from "react";
import { useJournalEntries, useCreateJournalEntry, useAccounts } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EPSILON = 0.005; // half a cent tolerance

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
  const [lines, setLines] = useState([{ account_id: "", debit: 0, credit: 0 }]);

  const { data: entries, isLoading } = useJournalEntries();
  const { data: accounts } = useAccounts();
  const createEntry = useCreateJournalEntry();

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
    if (lines.length > 1) setLines(lines.filter((_, i) => i !== index));
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

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < EPSILON && totalDebit > 0;

  // Duplicate account validation
  const activeLines = lines.filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
  const accountIds = activeLines.map(l => l.account_id);
  const hasDuplicateAccounts = new Set(accountIds).size !== accountIds.length;

  const handleCreate = async () => {
    // Validate no line has both debit and credit
    const invalidLines = lines.filter(l => Number(l.debit) > 0 && Number(l.credit) > 0);
    if (invalidLines.length > 0) {
      toast.error("A journal line cannot have both debit and credit amounts");
      return;
    }
    if (hasDuplicateAccounts) {
      toast.error("Each account should only appear once per entry. Combine amounts on the same account into one line.");
      return;
    }
    await createEntry.mutateAsync({
      description,
      entry_date: entryDate,
      reference,
      lines: lines.filter(l => l.account_id && (l.debit > 0 || l.credit > 0)),
    });
    setOpen(false);
    setDescription("");
    setReference("");
    setEntryDate(new Date().toISOString().split("T")[0]);
    setLines([{ account_id: "", debit: 0, credit: 0 }]);
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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-description">Record and manage double-entry transactions</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" /> New Entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Journal Entry</DialogTitle>
              <DialogDescription>Each entry must have balanced debits and credits.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Date <span className="text-destructive">*</span></label>
                  <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Reference</label>
                  <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" placeholder="INV-001" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Description <span className="text-destructive">*</span></label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" placeholder="Office supplies purchase" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Journal Lines</label>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2 text-xs font-medium text-muted-foreground px-1">
                    <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
                  </div>
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2 items-center">
                      <select value={line.account_id} onChange={(e) => updateLine(i, "account_id", e.target.value)}
                        className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors">
                        <option value="">Select account…</option>
                        {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_code} – {a.account_name}</option>)}
                      </select>
                      <input type="number" min="0" step="0.01" value={line.debit || ""} onChange={(e) => updateLine(i, "debit", Number(e.target.value))}
                        className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" placeholder="0.00" />
                      <input type="number" min="0" step="0.01" value={line.credit || ""} onChange={(e) => updateLine(i, "credit", Number(e.target.value))}
                        className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" placeholder="0.00" />
                      <button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive text-sm px-1 h-9 flex items-center justify-center">✕</button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={addLine} className="mt-2">+ Add Line</Button>
              </div>

              {/* Validation warnings */}
              {hasDuplicateAccounts && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  ⚠️ Duplicate accounts detected — combine amounts into a single line per account.
                </p>
              )}

              {/* Totals bar */}
              <div className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-4 py-2.5 border border-border">
                <span className="tabular-nums text-foreground">Debit: <strong>LKR {fmt(totalDebit)}</strong></span>
                <span className="tabular-nums text-foreground">Credit: <strong>LKR {fmt(totalCredit)}</strong></span>
                <span className={`font-semibold ${isBalanced ? "text-primary" : "text-destructive"}`}>
                  {isBalanced ? "✓ Balanced" : `✗ Off by LKR ${fmt(Math.abs(totalDebit - totalCredit))}`}
                </span>
              </div>

              <Button onClick={handleCreate} disabled={!isBalanced || !description || hasDuplicateAccounts || createEntry.isPending} className="w-full">
                {createEntry.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Posting…
                  </span>
                ) : "Post Entry"}
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
              This will create a new posted entry with opposite debits and credits, effectively cancelling the original.
              Both entries remain in the audit trail.
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
          <p className="text-2xl font-bold text-foreground tabular-nums">{totalPosted}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Voided</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{totalVoided}</p>
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
                    : "bg-muted text-muted-foreground hover:bg-accent"
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
                          entry.status === "posted" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
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
                                <th className="text-right font-medium pb-1.5 w-36">Debit</th>
                                <th className="text-right font-medium pb-1.5 w-36">Credit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entryLines.map((line: any, idx: number) => (
                                <tr key={idx} className="border-t border-border/50">
                                  <td className="py-1.5 text-foreground">
                                    <span className="font-mono text-xs text-muted-foreground mr-2">{line.accounts?.account_code}</span>
                                    {line.accounts?.account_name || line.account_id}
                                  </td>
                                  <td className="text-right tabular-nums py-1.5">
                                    {Number(line.debit) > 0 ? `LKR ${fmt(Number(line.debit))}` : "—"}
                                  </td>
                                  <td className="text-right tabular-nums py-1.5">
                                    {Number(line.credit) > 0 ? `LKR ${fmt(Number(line.credit))}` : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-border font-semibold text-foreground">
                                <td className="pt-1.5">Totals</td>
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
