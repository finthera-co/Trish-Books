import { Plus, Search, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useJournalEntries, useCreateJournalEntry, useAccounts } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function JournalEntries() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
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
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const handleCreate = async () => {
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
                    <div key={i} className="grid grid-cols-3 gap-2">
                      <select value={line.account_id} onChange={(e) => updateLine(i, "account_id", e.target.value)}
                        className="text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                        <option value="">Select account...</option>
                        {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                      </select>
                      <input type="number" value={line.debit || ""} onChange={(e) => updateLine(i, "debit", Number(e.target.value))}
                        className="text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Debit" />
                      <input type="number" value={line.credit || ""} onChange={(e) => updateLine(i, "credit", Number(e.target.value))}
                        className="text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Credit" />
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
            <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((entry) => {
                const totalDebit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.debit), 0) || 0;
                const totalCredit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.credit), 0) || 0;
                return (
                  <tr key={entry.id}>
                    <td className="text-muted-foreground">{entry.entry_date}</td>
                    <td className="font-medium text-foreground">{entry.description}</td>
                    <td className="font-mono text-xs text-muted-foreground">{entry.reference || "-"}</td>
                    <td className="text-right font-medium">LKR {totalDebit.toLocaleString()}</td>
                    <td className="text-right font-medium">LKR {totalCredit.toLocaleString()}</td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.status === "posted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                      }`}>{entry.status}</span>
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
