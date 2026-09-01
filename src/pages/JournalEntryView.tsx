import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useState } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ArrowLeft, Copy, Edit, FileText, RotateCcw, Ban, Undo2, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { typeColors, getTypeLabel } from "@/lib/accountTypes";
import { resolveLineMemo, isMemoInherited, bySeq } from "@/lib/journalValidation";
import { formatDate } from "@/lib/format";

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function JournalEntryView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: accounts } = useAccounts();
  const queryClient = useQueryClient();
  const { canEdit, canDelete } = useMyPermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

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

  // Names this page in the breadcrumb and the minimize dock — without it
  // every open journal entry docks as an identical "Journal Entries" chip.
  usePageTitle(entry?.reference || entry?.description);

  // Check if entry is in a closed period
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

  // Check if entry is reconciled (has bank feed transactions matched to its lines)
  const { data: isReconciled } = useQuery({
    queryKey: ["journal_entry_reconciled", id],
    queryFn: async () => {
      const lineIds = (entry?.journal_lines as any[])?.map((l: any) => l.id) || [];
      if (lineIds.length === 0) return false;
      const { data, error } = await supabase
        .from("bank_feed_transactions")
        .select("id")
        .in("matched_journal_line_id", lineIds)
        .eq("status", "matched")
        .limit(1);
      if (error) return false;
      return (data?.length || 0) > 0;
    },
    enabled: !!entry,
  });

  const isInClosedPeriod = (() => {
    if (!entry || !closedPeriods) return false;
    const d = new Date(entry.entry_date);
    return closedPeriods.some(p => {
      const start = new Date(p.period_start);
      const end = new Date(p.period_end);
      return d >= start && d <= end;
    });
  })();

  const isVoided = entry?.status === "voided";
  const isOBEEntry = entry?.entry_type === "opening_balance" && entry?.is_system_generated === true;
  const isLocked = isInClosedPeriod || isReconciled || isVoided || isOBEEntry;

  // Only manual entries can be deleted here — anything raised by a source
  // document has to be removed from that document. The RPC re-checks this.
  const entrySource = entry?.source_type || entry?.entry_type || "manual";
  const isSystemGenerated = entry?.is_system_generated === true || entrySource !== "manual";
  const canDeleteEntry = canDelete("journals") && !isSystemGenerated && !isInClosedPeriod && !isReconciled;

  // Restoring is the reverse of a void, which triggers only handle one way — the
  // RPC rebuilds the transactions feed and budget consumption.
  const restoreEntry = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("unvoid_journal_entry", { p_entry_id: id! });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entry", id] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Journal entry restored to posted");
      setRestoreOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteEntry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("delete_journal_entry", { p_entry_id: id! });
      if (error) throw error;
      return data as { lines_deleted: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(`Journal entry deleted (${result?.lines_deleted ?? 0} lines removed)`);
      setDeleteOpen(false);
      navigate("/accounting/journals");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entryLines = ((entry?.journal_lines as any[]) || [])
    .slice()
    .sort(bySeq);
  const totalDebit = entryLines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = entryLines.reduce((sum, l) => sum + Number(l.credit), 0);

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
        <p className="text-sm text-muted-foreground">The requested journal entry does not exist or has been removed.</p>
        <Button variant="outline" onClick={() => navigate("/accounting/ledger")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Register
        </Button>
      </div>
    );
  }

  const lockMessage = isVoided
    ? "This transaction has been voided and cannot be edited."
    : isOBEEntry
    ? "This is a system-generated Opening Balance entry. Edit opening balances from the Opening Balances screen."
    : isInClosedPeriod
    ? "This transaction is in a closed accounting period. Editing will affect reconciled balances."
    : isReconciled
    ? "This transaction is linked to reconciled bank records. Editing will affect reconciled balances."
    : null;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/accounting/journals")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Journal Entries
        </Button>
      </div>

      {/* Header */}
      <div className="stat-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Journal Entry</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{entry.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              isVoided ? "bg-destructive/10 text-destructive" :
              entry.status === "posted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}>
              {entry.status}
            </span>
          </div>
        </div>

        {/* Lock warning */}
        {isLocked && lockMessage && (
          <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 rounded-md px-3 py-2 border border-warning/20 mb-4">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{lockMessage}</span>
          </div>
        )}

        {/* Source Info Banner */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 mb-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <FileText className="w-3.5 h-3.5" />
            Source Transaction Details
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground font-medium">Type:</span>
            <span className="text-foreground">Journal Entry</span>
            <span className="text-muted-foreground font-medium">Reference:</span>
            <span className="font-mono text-foreground">{entry.reference || "—"}</span>
            <span className="text-muted-foreground font-medium">Cheque No:</span>
            <span className="font-mono text-foreground">{entry.cheque_number || "—"}</span>
            <span className="text-muted-foreground font-medium">Date:</span>
            <span className="text-foreground">{formatDate(entry.entry_date)}</span>
            <span className="text-muted-foreground font-medium">Transaction ID:</span>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-foreground cursor-help">
                    {entry.id.slice(0, 8)}…{entry.id.slice(-4)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-xs">
                  {entry.id}
                </TooltipContent>
              </Tooltip>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(entry.id);
                  toast.success("Transaction ID copied");
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                title="Copy full ID"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Entry details */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Date</p>
            <p className="text-sm font-medium text-foreground">{formatDate(entry.entry_date)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Reference</p>
            <p className="text-sm font-mono text-foreground">{entry.reference || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Cheque No</p>
            <p className="text-sm font-mono text-foreground">{entry.cheque_number || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Created</p>
            <p className="text-sm text-foreground">{formatDate(entry.created_at)}</p>
          </div>
        </div>

        {/* Journal Lines */}
        <div className="border border-border rounded-lg overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Account</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-24">Type</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-36">Debit (LKR)</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-36">Credit (LKR)</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Description</th>
              </tr>
            </thead>
            <tbody>
              {entryLines.map((line: any, idx: number) => (
                <tr key={idx} className="border-t border-border/50">
                  <td className="px-3 py-2 text-foreground">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{line.accounts?.account_code}</span>
                    {line.accounts?.account_name || line.account_id}
                  </td>
                  <td className="px-3 py-2">
                    {line.accounts?.account_type && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeColors[line.accounts.account_type] || "bg-muted text-muted-foreground"}`}>
                        {getTypeLabel(line.accounts.account_type)}
                      </span>
                    )}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums font-mono">
                    {Number(line.debit) > 0 ? fmt(Number(line.debit)) : "—"}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums font-mono">
                    {Number(line.credit) > 0 ? fmt(Number(line.credit)) : "—"}
                  </td>
                  <td className={`px-3 py-2 ${isMemoInherited(line.memo) ? "text-muted-foreground italic" : "text-foreground"}`}>
                    {resolveLineMemo(line.memo, entry.description) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold text-foreground bg-muted/30">
                <td className="px-3 py-2" colSpan={2}>Totals</td>
                <td className="text-right px-3 py-2 tabular-nums font-mono">LKR {fmt(totalDebit)}</td>
                <td className="text-right px-3 py-2 tabular-nums font-mono">LKR {fmt(totalCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Void info */}
        {isVoided && entry.void_reason && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-md px-3 py-2 border border-destructive/20 mb-4">
            <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Void reason:</span> {entry.void_reason}
              {entry.voided_at && <span className="ml-2 text-muted-foreground">({formatDate(entry.voided_at)})</span>}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {!isVoided && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-1">
                  <Button
                    className="w-full"
                    onClick={() => navigate(`/accounting/journals/${id}/edit`)}
                    disabled={isLocked}
                  >
                    <Edit className="w-4 h-4 mr-2" /> Edit Journal Entry
                  </Button>
                </div>
              </TooltipTrigger>
              {isLocked && (
                <TooltipContent>{lockMessage}</TooltipContent>
              )}
            </Tooltip>
          )}
          {isVoided && canEdit("journals") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-1">
                  <Button className="w-full" disabled={isInClosedPeriod} onClick={() => setRestoreOpen(true)}>
                    <Undo2 className="w-4 h-4 mr-2" /> Restore Entry
                  </Button>
                </div>
              </TooltipTrigger>
              {isInClosedPeriod && (
                <TooltipContent>This entry is in a closed accounting period.</TooltipContent>
              )}
            </Tooltip>
          )}
          <Button variant="outline" onClick={() => navigate("/accounting/journals")}>
            Back to List
          </Button>
          {canDelete("journals") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 disabled:pointer-events-none"
                    disabled={!canDeleteEntry}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </span>
              </TooltipTrigger>
              {!canDeleteEntry && (
                <TooltipContent>
                  {isSystemGenerated
                    ? "Generated from a source document — delete that document instead."
                    : isInClosedPeriod
                    ? "This entry is in a closed accounting period."
                    : "This entry is linked to reconciled bank records."}
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>
      </div>

      {/* Restore confirmation */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restore Journal Entry</DialogTitle>
            <DialogDescription>
              This puts the entry back to posted, so its debits and credits affect account balances again.
              The void reason will be cleared, and the restore is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{entry.description}</span>
              <span className="font-mono text-xs text-muted-foreground">{entry.reference || "—"}</span>
            </div>
            <p className="text-xs text-muted-foreground">{formatDate(entry.entry_date)} · LKR {fmt(totalDebit)}</p>
            {entry.void_reason && (
              <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
                <span className="font-medium text-foreground">Voided because:</span> {entry.void_reason}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRestoreOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => restoreEntry.mutate()} disabled={restoreEntry.isPending} className="flex-1">
              {restoreEntry.isPending ? "Restoring…" : "Restore Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Journal Entry</DialogTitle>
            <DialogDescription>
              This permanently removes the entry and all {entryLines.length} of its debit and credit lines
              {isVoided ? ", including its void record" : ""}. It cannot be undone —{" "}
              {isVoided
                ? "a voided entry left in place keeps the audit trail intact."
                : "void or reverse the entry instead if you need to keep an audit trail."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{entry.description}</span>
              <span className="font-mono text-xs text-muted-foreground">{entry.reference || "—"}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDate(entry.entry_date)} · LKR {fmt(totalDebit)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} className="flex-1">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteEntry.mutate()}
              disabled={deleteEntry.isPending} className="flex-1">
              {deleteEntry.isPending ? "Deleting…" : "Delete Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
