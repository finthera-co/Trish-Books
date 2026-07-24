import { useMemo, useState } from "react";
import { HelpCircle, CheckCircle2, Clock, Wand2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox as Check2 } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/currency";
import { useAccounts } from "@/hooks/useData";
import {
  useSuspenseLines,
  useClearSuspense,
  type SuspenseLine,
} from "@/hooks/useBankStatementImport";

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function SuspenseClearing() {
  const { data: lines, isLoading } = useSuspenseLines();
  const { data: accounts } = useAccounts();
  const clearMut = useClearSuspense();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetAccount, setTargetAccount] = useState("");
  const [note, setNote] = useState("");
  const [teachVariant, setTeachVariant] = useState(false);

  const postable = useMemo(
    () => (accounts || []).filter((a: any) => a.is_active && a.is_postable && !a.is_control_account),
    [accounts]
  );

  const open = lines ?? [];
  const openValue = open.reduce((s, l) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
  const oldest = open.reduce((max, l) => Math.max(max, ageDays(l.created_at)), 0);

  // Lines sharing the selected line's unknown variant (for "apply to all N").
  const selectedLines = open.filter((l) => selected.has(l.id));
  const commonVariant = useMemo(() => {
    if (selectedLines.length === 0) return null;
    const variants = new Set(selectedLines.map((l) => l.raw_account_type.trim().toLowerCase()).filter(Boolean));
    const allUnknown = selectedLines.every((l) => l.suspense_reason === "unknown_category_variant");
    return variants.size === 1 && allUnknown ? [...variants][0] : null;
  }, [selectedLines]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === open.length ? new Set() : new Set(open.map((l) => l.id))));
  }

  async function submitClear() {
    if (!targetAccount || selected.size === 0) return;
    // Clearing and teaching happen in ONE transaction: the engine binds this
    // raw variant to the account chosen here, so it resolves at Tier 1 next
    // import instead of returning to Suspense.
    await clearMut.mutateAsync({
      line_ids: [...selected],
      target_account_id: targetAccount,
      note: note || undefined,
      teach_variant: teachVariant && commonVariant ? commonVariant : undefined,
    });
    setDialogOpen(false);
    setSelected(new Set());
    setTargetAccount("");
    setNote("");
    setTeachVariant(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-amber-500" /> Suspense Clearing
        </h1>
        <p className="text-sm text-muted-foreground">
          Reclassify imported lines parked in <strong>Unrecognized Payments</strong> (money out) and{" "}
          <strong>Unrecognized Deposits</strong> (money in) to their final ledger account. Each clearing generates
          a reclass journal out of the matching holding account; the original entry is never changed.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Open items</p>
          <p className="text-2xl font-bold text-foreground">{open.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Open value</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(openValue)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="w-4 h-4" /> Oldest</p>
          <p className={`text-2xl font-bold ${oldest > 30 ? "text-destructive" : "text-foreground"}`}>{oldest} days</p>
        </CardContent></Card>
      </div>

      {oldest > 30 && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <Clock className="w-4 h-4" /> Some items are older than 30 days — clear them to keep the bank GL accurate.
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Open Suspense items</CardTitle>
          {selected.size > 0 && (
            <Button onClick={() => setDialogOpen(true)} size="sm">
              <Wand2 className="w-4 h-4 mr-2" /> Clear {selected.size} selected
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : open.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm">Suspense is clear. Nothing to reclassify.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={selected.size === open.length && open.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((l: SuspenseLine) => {
                  const amount = Number(l.debit || 0) > 0 ? Number(l.debit) : Number(l.credit);
                  const dir = Number(l.debit || 0) > 0 ? "Dr" : "Cr";
                  return (
                    <TableRow key={l.id} data-state={selected.has(l.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} /></TableCell>
                      <TableCell className="font-mono text-sm">{l.txn_date ?? "—"}</TableCell>
                      <TableCell>
                        <span className="font-medium">{l.description || l.name || "—"}</span>
                        {l.raw_account_type && <span className="block text-xs text-muted-foreground">{l.raw_account_type}</span>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{(l.suspense_reason ?? "").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(amount)} <span className="text-muted-foreground">{dir}</span></TableCell>
                      <TableCell className="text-right text-sm">{ageDays(l.created_at)}d</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {selected.size} item(s) from Suspense</DialogTitle>
            <DialogDescription>
              A reclass journal moves each line from Suspense to the account below, dated on the original
              transaction. The original entry stays untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Final account</Label>
              <Select value={targetAccount} onValueChange={setTargetAccount}>
                <SelectTrigger><SelectValue placeholder="Choose the final ledger account…" /></SelectTrigger>
                <SelectContent>
                  {postable.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this account…" rows={2} />
            </div>
            {commonVariant && (
              <label className="flex items-start gap-2 text-sm">
                <Check2 checked={teachVariant} onCheckedChange={(v) => setTeachVariant(!!v)} className="mt-0.5" />
                <span>
                  Teach the engine: save "<strong>{commonVariant}</strong>" as a permanent mapping so this variant
                  resolves automatically next time instead of returning to Suspense.
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitClear} disabled={!targetAccount || clearMut.isPending}>
              {clearMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Clearing…</> : "Clear & reclassify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
