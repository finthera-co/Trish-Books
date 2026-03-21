import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts } from "@/hooks/useData";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";

interface EditTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journalEntryId: string;
  highlightLineId: string;
  onSaved: () => void;
}

interface JournalLine {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
}

export default function EditTransactionModal({
  open,
  onOpenChange,
  journalEntryId,
  highlightLineId,
  onSaved,
}: EditTransactionModalProps) {
  const queryClient = useQueryClient();
  const { data: accounts } = useAccounts();

  const { data: entry, isLoading } = useQuery({
    queryKey: ["journal_entry_edit", journalEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(*)")
        .eq("id", journalEntryId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([]);

  useEffect(() => {
    if (!entry) return;
    setEntryDate(entry.entry_date);
    setDescription(entry.description);
    setReference(entry.reference || "");
    setLines(
      ((entry.journal_lines as any[]) || []).map((l: any) => ({
        id: l.id,
        account_id: l.account_id,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }))
    );
  }, [entry]);

  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  const difference = Math.abs(totalDebits - totalCredits);
  const isBalanced = difference < 0.005;
  const isVoided = entry?.status === "voided";
  const isReadOnly = isVoided;

  const updateLine = (index: number, field: keyof JournalLine, value: any) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const updated = { ...l, [field]: value };
        if (field === "debit" && value > 0) updated.credit = 0;
        if (field === "credit" && value > 0) updated.debit = 0;
        return updated;
      })
    );
  };

  const removeLine = (index: number) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: `new-${crypto.randomUUID()}`, account_id: "", debit: 0, credit: 0 },
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!isBalanced) throw new Error("Entry must be balanced");
      if (lines.some((l) => !l.account_id)) throw new Error("All lines must have an account");

      // Update journal entry header
      const { error: headerError } = await supabase
        .from("journal_entries")
        .update({
          entry_date: entryDate,
          description,
          reference: reference || null,
        })
        .eq("id", journalEntryId);
      if (headerError) throw headerError;

      // Delete existing lines and re-insert
      const { error: deleteError } = await supabase
        .from("journal_lines")
        .delete()
        .eq("journal_entry_id", journalEntryId);
      if (deleteError) throw deleteError;

      const newLines = lines.map((l) => ({
        journal_entry_id: journalEntryId,
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
      }));

      const { error: insertError } = await supabase
        .from("journal_lines")
        .insert(newLines);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast.success("Transaction updated successfully");
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entry_edit", journalEntryId] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inputClass =
    "text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Transaction
            {isVoided && (
              <Badge variant="destructive" className="text-xs">Voided</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Journal Entry {journalEntryId.slice(0, 8).toUpperCase()}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Header fields */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className={`w-full ${inputClass}`}
                  disabled={isReadOnly}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reference</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className={`w-full ${inputClass}`}
                  placeholder="Optional"
                  disabled={isReadOnly}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <div className="mt-1">
                  <Badge variant={entry?.status === "posted" ? "default" : "secondary"} className="text-xs">
                    {entry?.status}
                  </Badge>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Memo / Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`w-full ${inputClass}`}
                disabled={isReadOnly}
              />
            </div>

            {/* Journal Lines */}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-28">Debit</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-28">Credit</th>
                    {!isReadOnly && (
                      <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground w-12" />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr
                      key={line.id}
                      className={`border-b transition-colors ${line.id === highlightLineId ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : "hover:bg-muted/10"}`}
                    >
                      <td className="px-3 py-1.5">
                        <select
                          value={line.account_id}
                          onChange={(e) => updateLine(i, "account_id", e.target.value)}
                          className={`w-full ${inputClass} !py-1.5`}
                          disabled={isReadOnly}
                        >
                          <option value="">Select account…</option>
                          {(accounts as any[] || [])
                            .filter((a: any) => a.is_active)
                            .sort((a: any, b: any) => a.account_code.localeCompare(b.account_code))
                            .map((a: any) => (
                              <option key={a.id} value={a.id}>
                                {a.account_code} — {a.account_name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit || ""}
                          onChange={(e) => updateLine(i, "debit", parseFloat(e.target.value) || 0)}
                          className={`w-full ${inputClass} text-right !py-1.5`}
                          placeholder="0.00"
                          disabled={isReadOnly}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit || ""}
                          onChange={(e) => updateLine(i, "credit", parseFloat(e.target.value) || 0)}
                          className={`w-full ${inputClass} text-right !py-1.5`}
                          placeholder="0.00"
                          disabled={isReadOnly}
                        />
                      </td>
                      {!isReadOnly && (
                        <td className="px-3 py-1.5 text-center">
                          <button
                            onClick={() => removeLine(i)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            disabled={lines.length <= 2}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-foreground/20">
                    <td className="px-3 py-2">
                      {!isReadOnly && (
                        <Button variant="ghost" size="sm" onClick={addLine}>
                          <Plus className="w-3.5 h-3.5 mr-1" /> Add Line
                        </Button>
                      )}
                    </td>
                    <td className="text-right px-3 py-2 font-mono font-semibold text-sm">
                      {formatCurrency(totalDebits)}
                    </td>
                    <td className="text-right px-3 py-2 font-mono font-semibold text-sm">
                      {formatCurrency(totalCredits)}
                    </td>
                    {!isReadOnly && <td />}
                  </tr>
                  {!isBalanced && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2">
                        <div className="flex items-center gap-2 text-warning text-xs">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Out of balance by {formatCurrency(difference)}
                        </div>
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            {/* Save button */}
            {!isReadOnly && (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!isBalanced || saveMutation.isPending || lines.some((l) => !l.account_id)}
                className="w-full"
              >
                <Save className="w-4 h-4 mr-1" />
                {saveMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
