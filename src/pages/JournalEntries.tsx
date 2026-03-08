import { Plus, Search, RotateCcw, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useJournalEntries, useCreateJournalEntry, useAccounts } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function JournalEntries() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [voidDialogId, setVoidDialogId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState([{ account_id: "", debit: 0, credit: 0 }]);

  const { data: entries, isLoading } = useJournalEntries();
  const { data: accounts } = useAccounts();
  const createEntry = useCreateJournalEntry();

  const filtered = entries?.filter((e) =>
    e.description.toLowerCase().includes(search.toLowerCase()) || 
    (e.reference || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

  const addLine = () => setLines([...lines, { account_id: "", debit: 0, credit: 0 }]);
  const removeLine = (index: number) => {
    if (lines.length > 1) setLines(lines.filter((_, i) => i !== index));
  };
  
  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines];
    // Enforce: a line can only have debit OR credit, not both
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
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const handleCreate = async () => {
    // Validate no line has both debit and credit
    const invalidLines = lines.filter(l => Number(l.debit) > 0 && Number(l.credit) > 0);
    if (invalidLines.length > 0) {
      toast.error("A journal line cannot have both debit and credit amounts");
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
    setLines([{ account_id: "", debit: 0, credit: 0 }]);
  };

  // Void a journal entry
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

  // Reverse a journal entry (create opposite entry)
  const reverseEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const entry = entries?.find(e => e.id === entryId);
      if (!entry) throw new Error("Entry not found");

      const originalLines = (entry.journal_lines as any[]) || [];

      // Create reversal entry
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

      // Reverse debit/credit on each line
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-description">Record and manage double-entry transactions</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />New Entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Journal Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">Reference</label>
                  <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="INV-001" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Office supplies purchase" />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Lines</label>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                      <select value={line.account_id} onChange={(e) => updateLine(i, "account_id", e.target.value)}
                        className="text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                        <option value="">Select account...</option>
                        {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                      </select>
                      <input type="number" value={line.debit || ""} onChange={(e) => updateLine(i, "debit", Number(e.target.value))}
                        className="w-28 text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Debit" />
                      <input type="number" value={line.credit || ""} onChange={(e) => updateLine(i, "credit", Number(e.target.value))}
                        className="w-28 text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Credit" />
                      <button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive text-sm px-1">✕</button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={addLine} className="mt-2">Add Line</Button>
              </div>
              <div className="flex justify-between text-sm">
                <span>Total Debit: LKR {totalDebit.toFixed(2)}</span>
                <span>Total Credit: LKR {totalCredit.toFixed(2)}</span>
                <span className={isBalanced ? "text-success" : "text-destructive"}>
                  {isBalanced ? "✓ Balanced" : "✗ Not balanced"}
                </span>
              </div>
              <Button onClick={handleCreate} disabled={!isBalanced || !description || createEntry.isPending} className="w-full">
                {createEntry.isPending ? "Creating..." : "Post Entry"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Void Dialog */}
      <Dialog open={!!voidDialogId} onOpenChange={(v) => { if (!v) setVoidDialogId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void Journal Entry</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Voiding marks this entry as invalid. It will no longer affect account balances.
              This action is recorded in the audit trail.
            </p>
            <div>
              <label className="text-sm font-medium">Reason for voiding</label>
              <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)}
                className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground min-h-[80px]"
                placeholder="Enter the reason..." />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setVoidDialogId(null)} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={() => voidDialogId && voidEntry.mutate(voidDialogId)}
                disabled={!voidReason || voidEntry.isPending} className="flex-1">
                {voidEntry.isPending ? "Voiding..." : "Void Entry"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search entries..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No journal entries found</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {filtered.map((entry) => {
                const totalDebit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.debit), 0) || 0;
                const totalCredit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.credit), 0) || 0;
                const isVoided = entry.status === "voided";
                const isReversal = !!(entry as any).reversal_of;
                return (
                  <tr key={entry.id} className={isVoided ? "opacity-50 line-through" : ""}>
                    <td className="text-muted-foreground">{entry.entry_date}</td>
                    <td className="font-medium text-foreground">
                      {entry.description}
                      {isReversal && <span className="ml-1.5 text-xs text-muted-foreground">(reversal)</span>}
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{entry.reference || "-"}</td>
                    <td className="text-right font-medium">LKR {totalDebit.toLocaleString()}</td>
                    <td className="text-right font-medium">LKR {totalCredit.toLocaleString()}</td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        isVoided ? "bg-destructive/10 text-destructive" :
                        entry.status === "posted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                      }`}>{entry.status}</span>
                    </td>
                    <td className="text-right">
                      {entry.status === "posted" && (
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" title="Reverse"
                            onClick={() => {
                              if (confirm("Create a reversal entry? This will post opposite debits/credits.")) {
                                reverseEntry.mutate(entry.id);
                              }
                            }}>
                            <RotateCcw className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Void"
                            onClick={() => setVoidDialogId(entry.id)}>
                            <Ban className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
