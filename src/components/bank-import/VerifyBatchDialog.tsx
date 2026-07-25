import { useEffect } from "react";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, Database } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useVerifyBankBatch } from "@/hooks/useBankStatementImport";

/**
 * Confirms, straight from the database, that an import actually landed: every
 * postable line has a journal entry, the entries balance, the posted value
 * reconciles to the statement, and the cash-flow rows synced. Runs the
 * verify_bank_import_batch RPC (read-only) on open.
 */
export default function VerifyBatchDialog({
  batchId,
  label,
  open,
  onOpenChange,
}: {
  batchId: string | null;
  label?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const verify = useVerifyBankBatch();
  const report = verify.data;

  useEffect(() => {
    if (open && batchId) verify.mutate(batchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batchId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" /> Database verification{label ? ` — ${label}` : ""}
          </DialogTitle>
          <DialogDescription>
            Independently re-reads Supabase and confirms every transaction from this import was posted and recorded.
          </DialogDescription>
        </DialogHeader>

        {verify.isPending ? (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Checking the database…
          </div>
        ) : report ? (
          <div className="space-y-4">
            <div className={`flex items-center gap-2 rounded-lg px-4 py-3 border ${
              report.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-destructive/5 border-destructive/30 text-destructive"}`}>
              {report.ok
                ? <ShieldCheck className="w-5 h-5 shrink-0" />
                : <XCircle className="w-5 h-5 shrink-0" />}
              <span className="text-sm font-medium">
                {report.ok
                  ? "All transactions are posted and recorded in the database."
                  : "Discrepancy found — see the failing check(s) below."}
              </span>
            </div>

            <ul className="space-y-1.5">
              {report.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2 text-sm">
                  {c.ok
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    : <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
                  <span>
                    <span className="text-foreground">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t">
              <div>
                <p className="text-lg font-bold text-foreground">{report.counts.journal_entries}</p>
                <p className="text-[11px] text-muted-foreground">Journal entries</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{report.counts.journal_lines}</p>
                <p className="text-[11px] text-muted-foreground">Ledger lines</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{report.counts.transactions}</p>
                <p className="text-[11px] text-muted-foreground">Cash-flow rows</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="outline">Ledger: {report.counts.posted_to_ledger}</Badge>
              <Badge variant="outline" className="text-amber-600">Suspense: {report.counts.posted_to_suspense}</Badge>
              <Badge variant="outline" className="text-destructive">Held: {report.counts.blocked}</Badge>
              <Badge variant="outline">Balanced: {formatCurrency(report.totals.debit)}</Badge>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">Could not run verification.</p>
        )}

        <DialogFooter>
          {report && !verify.isPending && batchId && (
            <Button variant="outline" onClick={() => verify.mutate(batchId)}>Re-check</Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
