import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, XCircle, Search, GitBranch } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useApproveSplitMatch } from "@/hooks/useBankFeeds";
import { formatDate } from "@/lib/format";

interface BankFeed {
  id: string;
  transaction_date: string;
  description: string | null;
  amount: number;
}

interface ReconciliationTransaction {
  id: string;
  cleared: boolean;
  journal_line_id: string;
  journal_lines: {
    debit: number;
    credit: number;
    journal_entries: {
      entry_date: string;
      reference: string | null;
      description: string | null;
    } | null;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  bankFeed: BankFeed;
  reconciliationId: string;
  transactions: ReconciliationTransaction[];
}

const EPSILON = 0.005;

function glAmount(t: ReconciliationTransaction): number {
  const debit = Number(t.journal_lines?.debit) || 0;
  const credit = Number(t.journal_lines?.credit) || 0;
  // Return signed amount: deposits positive, payments negative — mirrors bank feed sign convention
  return debit > 0 ? debit : -credit;
}

export default function SplitMatchDialog({ open, onClose, bankFeed, reconciliationId, transactions }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const approveSplit = useApproveSplitMatch();

  // Only uncleared transactions are available to split-match
  const candidates = useMemo(() => {
    const uncleared = transactions.filter((t) => !t.cleared);
    if (!search) return uncleared;
    const s = search.toLowerCase();
    return uncleared.filter((t) => {
      const je = t.journal_lines?.journal_entries;
      return (
        (je?.description || "").toLowerCase().includes(s) ||
        (je?.reference || "").toLowerCase().includes(s)
      );
    });
  }, [transactions, search]);

  const selectedTotal = useMemo(() => {
    let sum = 0;
    selected.forEach((id) => {
      const t = transactions.find((tx) => tx.id === id);
      if (t) sum += glAmount(t);
    });
    return sum;
  }, [selected, transactions]);

  const difference = bankFeed.amount - selectedTotal;
  const isBalanced = Math.abs(difference) < EPSILON;
  const hasSelection = selected.size > 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    await approveSplit.mutateAsync({
      bankFeedId: bankFeed.id,
      reconTxnIds: Array.from(selected),
      reconciliationId,
    });
    setSelected(new Set());
    setSearch("");
    onClose();
  };

  const handleClose = () => {
    setSelected(new Set());
    setSearch("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="w-4 h-4 text-primary" />
            Split Match
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Bank feed transaction card */}
          <div className="px-6 py-4 bg-muted/40 border-b">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">
              Bank Feed Transaction
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{bankFeed.description || "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(bankFeed.transaction_date)}</p>
              </div>
              <p className={`text-lg font-bold font-mono ${bankFeed.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(bankFeed.amount)}
              </p>
            </div>
          </div>

          {/* GL transaction selector */}
          <div className="px-6 pt-4 pb-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">
              Select Ledger Transactions to Match
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by description or reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto px-6 pb-2">
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {search ? "No transactions match your search." : "No uncleared transactions available."}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="w-8 py-2"></th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Reference</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Description</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {candidates.map((t) => {
                    const je = t.journal_lines?.journal_entries;
                    const amt = glAmount(t);
                    const isSelected = selected.has(t.id);
                    return (
                      <tr
                        key={t.id}
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5" : ""}`}
                        onClick={() => toggle(t.id)}
                      >
                        <td className="py-2 pr-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggle(t.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="py-2 whitespace-nowrap">{je?.entry_date || "—"}</td>
                        <td className="py-2 font-mono text-muted-foreground">{je?.reference || "—"}</td>
                        <td className="py-2 max-w-[220px] truncate">{je?.description || "—"}</td>
                        <td className={`py-2 text-right font-mono font-medium ${amt >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {formatCurrency(amt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Summary footer */}
          <div className="border-t px-6 py-4 space-y-3 bg-background">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Bank Amount</p>
                <p className="font-mono font-semibold">{formatCurrency(bankFeed.amount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Selected ({selected.size} {selected.size === 1 ? "item" : "items"})
                </p>
                <p className="font-mono font-semibold">{formatCurrency(selectedTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Difference
                  {hasSelection && (
                    isBalanced
                      ? <CheckCircle className="w-3 h-3 text-green-600" />
                      : <XCircle className="w-3 h-3 text-red-600" />
                  )}
                </p>
                <p className={`font-mono font-semibold ${hasSelection ? (isBalanced ? "text-green-600" : "text-red-600") : "text-muted-foreground"}`}>
                  {hasSelection ? formatCurrency(difference) : "—"}
                </p>
              </div>
            </div>

            {hasSelection && !isBalanced && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <XCircle className="w-3 h-3" />
                Selected total must equal the bank amount ({formatCurrency(bankFeed.amount)}) before confirming.
              </p>
            )}

            {isBalanced && hasSelection && (
              <div className="flex flex-wrap gap-1">
                {Array.from(selected).map((id) => {
                  const t = transactions.find((tx) => tx.id === id);
                  const je = t?.journal_lines?.journal_entries;
                  return (
                    <Badge key={id} variant="secondary" className="text-[10px]">
                      {je?.reference || je?.description || id.slice(0, 8)}
                    </Badge>
                  );
                })}
              </div>
            )}

            <Separator />

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!isBalanced || !hasSelection || approveSplit.isPending}
                onClick={handleConfirm}
                className="bg-primary"
              >
                {approveSplit.isPending ? "Confirming…" : `Confirm Split (${selected.size} transactions)`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
