import { useState } from "react";
import { History, Undo2, RotateCcw, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";
import VerifyBatchDialog from "./VerifyBatchDialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/currency";
import {
  useBankStatementBatches,
  useUndoBankImport,
  useVoidBankImport,
  type BatchRow,
} from "@/hooks/useBankStatementImport";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(b: BatchRow): string {
  const p = (b.sheet_periods ?? [])[0];
  return p ? `${MONTHS[p.month]} ${p.year}` : "—";
}

function StatusBadge({ b }: { b: BatchRow }) {
  if (b.status === "posted") return <Badge variant="default">Posted</Badge>;
  if (b.status === "undone") return <Badge variant="secondary">Undone (deleted)</Badge>;
  if (b.status === "superseded")
    return <Badge variant="secondary">{b.void_kind === "reversed" ? "Reversed" : "Superseded"}</Badge>;
  if (b.status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline">{b.status}</Badge>;
}

export default function ImportHistory() {
  const { data: batches, isLoading } = useBankStatementBatches();
  const undo = useUndoBankImport();
  const voidReverse = useVoidBankImport();

  const [target, setTarget] = useState<BatchRow | null>(null);
  const [verifyBatch, setVerifyBatch] = useState<BatchRow | null>(null);
  const [mode, setMode] = useState<"undo" | "reverse">("undo");
  const [reason, setReason] = useState("");

  const rows = batches ?? [];
  if (!isLoading && rows.length === 0) return null; // nothing imported yet

  function openUndo(b: BatchRow) { setTarget(b); setMode("undo"); setReason(""); }

  async function confirm() {
    if (!target) return;
    if (mode === "undo") {
      await undo.mutateAsync({ batch_id: target.id, reason: reason || undefined });
    } else {
      if (!reason.trim()) return;
      await voidReverse.mutateAsync({ batch_id: target.id, reason: reason.trim() });
    }
    setTarget(null);
  }

  const busy = undo.isPending || voidReverse.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-4 h-4" /> Import history
        </CardTitle>
        <CardDescription>
          Every import is kept here. Undo deletes an import's transactions entirely and frees the month to
          re-import; reverse keeps the audit trail by posting mirror entries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imported</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Ledger / Suspense</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const s = (b.summary ?? {}) as any;
                return (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {new Date(b.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{periodLabel(b)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={b.file_name ?? ""}>
                      {b.file_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{b.row_count}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {b.status === "posted"
                        ? <>{s.posted_to_ledger_count ?? 0} / <span className="text-amber-600">{s.posted_to_suspense_count ?? 0}</span></>
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge b={b} />
                      {b.void_reason && <span className="block text-xs text-muted-foreground mt-0.5" title={b.void_reason}>{b.void_reason}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status === "posted" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setVerifyBatch(b)} title="Verify in database">
                            <ShieldCheck className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openUndo(b)} title="Undo this import">
                            <Undo2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo import — {target && periodLabel(target)}</DialogTitle>
            <DialogDescription>
              {mode === "undo"
                ? "This deletes every journal entry and line this import created, and frees the month to re-import. The import stays listed in history as “Undone”."
                : "This keeps the original entries and posts mirror reversal entries instead, preserving the full audit trail."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Button variant={mode === "undo" ? "default" : "outline"} size="sm" onClick={() => setMode("undo")}>
                <Undo2 className="w-4 h-4 mr-1" /> Delete (undo)
              </Button>
              <Button variant={mode === "reverse" ? "default" : "outline"} size="sm" onClick={() => setMode("reverse")}>
                <RotateCcw className="w-4 h-4 mr-1" /> Reverse (keep trail)
              </Button>
            </div>

            {mode === "undo" && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Undo deletes the whole import — including any Suspense items you already cleared. It is only
                  refused if the import touches a <strong>closed period</strong> or has a
                  <strong> bank-reconciled</strong> line; in those cases reopen the period / unreconcile, or use
                  <strong> Reverse</strong>.
                </span>
              </div>
            )}

            <div>
              <Label className="text-sm">Reason {mode === "reverse" && <span className="text-destructive">*</span>}</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={mode === "undo" ? "Optional — e.g. wrong file" : "Required for a reversal"} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              variant={mode === "undo" ? "destructive" : "default"}
              onClick={confirm}
              disabled={busy || (mode === "reverse" && !reason.trim())}
            >
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Working…</>
                    : mode === "undo" ? "Delete this import" : "Post reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <VerifyBatchDialog
        batchId={verifyBatch?.id ?? null}
        label={verifyBatch ? periodLabel(verifyBatch) : undefined}
        open={!!verifyBatch}
        onOpenChange={(o) => !o && setVerifyBatch(null)}
      />
    </Card>
  );
}
