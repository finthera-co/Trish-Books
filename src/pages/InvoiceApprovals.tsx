// ─────────────────────────────────────────────────────────────────────────────
// Invoice Approvals — the inbox for the sequential approval chain.
// Tabs split what needs *this* user from what is simply in flight; every row
// carries its level position and the server's verdict on whether the user may
// act on it.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import {
  ShieldCheck, CheckCircle2, XCircle, Clock, CornerUpLeft, Search,
  MessageSquare, RotateCcw, Inbox, AlertTriangle, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import {
  useApprovalQueue, useApprovalLog, useDecideInvoice, useResubmitInvoice,
  actorName, type ApprovalQueueRow,
} from "@/hooks/useApprovals";
import InvoiceApprovalPanel from "@/components/invoices/InvoiceApprovalPanel";

type TabKey = "mine" | "flight" | "sent_back" | "rejected" | "history";

const daysOld = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

const ageLabel = (iso: string) => {
  const d = daysOld(iso);
  return d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
};

export default function InvoiceApprovals() {
  const { data: queue, isLoading } = useApprovalQueue();
  const { data: log } = useApprovalLog();
  const decide = useDecideInvoice();
  const resubmit = useResubmitInvoice();

  const [tab, setTab] = useState<TabKey>("mine");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<ApprovalQueueRow | null>(null);
  const [noteRow, setNoteRow] = useState<{ row: ApprovalQueueRow; decision: "rejected" | "changes_requested" } | null>(null);
  const [note, setNote] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);

  const buckets = useMemo(() => {
    const rows = queue ?? [];
    return {
      mine:      rows.filter((r) => r.approval_status === "pending" && r.can_act),
      flight:    rows.filter((r) => r.approval_status === "pending" && !r.can_act),
      sent_back: rows.filter((r) => r.approval_status === "changes_requested"),
      rejected:  rows.filter((r) => r.approval_status === "rejected"),
    };
  }, [queue]);

  const visible = useMemo(() => {
    const list = tab === "history" ? [] : buckets[tab];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      r.invoice_number.toLowerCase().includes(q) ||
      (r.customer_name ?? "").toLowerCase().includes(q) ||
      (r.created_by_name ?? "").toLowerCase().includes(q) ||
      (r.step_name ?? "").toLowerCase().includes(q));
  }, [tab, buckets, search]);

  const selectable = visible.filter((r) => r.can_act);
  const selectedRows = selectable.filter((r) => selected.has(r.id));

  const pendingValue = buckets.mine.reduce((s, r) => s + Number(r.base_amount), 0);
  const oldest = buckets.mine.reduce<number>((m, r) => Math.max(m, daysOld(r.created_at)), 0);

  const historyRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = log ?? [];
    if (!q) return list;
    return list.filter((h) =>
      (h.invoices?.invoice_number ?? "").toLowerCase().includes(q) ||
      actorName(h.users).toLowerCase().includes(q) ||
      (h.step_name ?? "").toLowerCase().includes(q));
  }, [log, search]);

  const runBulk = async () => {
    setBulkRunning(true);
    let ok = 0;
    for (const r of selectedRows) {
      try {
        await decide.mutateAsync({ id: r.id, decision: "approved" });
        ok++;
      } catch {
        /* the mutation surfaces its own error toast; keep going through the rest */
      }
    }
    setBulkRunning(false);
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoice Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Your queue, everything still moving through the chain, and the full audit trail
          </p>
        </div>
      </div>

      {/* Snapshot */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Inbox} label="Needs your sign-off" value={String(buckets.mine.length)}
          detail={pendingValue > 0 ? formatCurrency(pendingValue) : "Nothing waiting on you"} tone="primary" />
        <StatTile icon={Users} label="With other approvers" value={String(buckets.flight.length)}
          detail={buckets.flight.length ? "Moving through earlier levels" : "Nothing in flight"} />
        <StatTile icon={AlertTriangle} label="Oldest in your queue" value={oldest > 0 ? `${oldest}d` : "—"}
          detail={buckets.sent_back.length ? `${buckets.sent_back.length} sent back for changes` : "No stale items"}
          tone={oldest >= 7 ? "warn" : undefined} />
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as TabKey); setSelected(new Set()); }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="mine">My queue{buckets.mine.length ? ` (${buckets.mine.length})` : ""}</TabsTrigger>
            <TabsTrigger value="flight">In flight{buckets.flight.length ? ` (${buckets.flight.length})` : ""}</TabsTrigger>
            <TabsTrigger value="sent_back">Sent back{buckets.sent_back.length ? ` (${buckets.sent_back.length})` : ""}</TabsTrigger>
            <TabsTrigger value="rejected">Rejected{buckets.rejected.length ? ` (${buckets.rejected.length})` : ""}</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <div className="relative sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice, customer, level or person…"
              className="w-full text-sm border border-input rounded-lg pl-9 pr-3 py-2 bg-background text-foreground"
            />
          </div>
        </div>

        {(["mine", "flight", "sent_back", "rejected"] as TabKey[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-4">
            <Card>
              {key === "mine" && selectedRows.length > 0 && (
                <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border">
                  <CardTitle className="text-sm font-medium">
                    {selectedRows.length} selected · {formatCurrency(selectedRows.reduce((s, r) => s + Number(r.base_amount), 0))}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
                    <Button size="sm" onClick={runBulk} disabled={bulkRunning}>
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      {bulkRunning ? "Approving…" : `Approve ${selectedRows.length}`}
                    </Button>
                  </div>
                </CardHeader>
              )}
              <CardContent className="p-0">
                {isLoading ? (
                  <p className="text-center py-10 text-muted-foreground">Loading…</p>
                ) : visible.length === 0 ? (
                  <p className="text-center py-10 text-muted-foreground">
                    {key === "mine" ? "Nothing is waiting on you."
                      : key === "flight" ? "No invoices are with other approvers."
                      : key === "sent_back" ? "Nothing has been sent back for changes."
                      : "No rejected invoices."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {key === "mine" && (
                          <TableHead className="w-10">
                            <Checkbox
                              checked={selectable.length > 0 && selectedRows.length === selectable.length}
                              onCheckedChange={(v) =>
                                setSelected(v ? new Set(selectable.map((r) => r.id)) : new Set())}
                            />
                          </TableHead>
                        )}
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Waiting on</TableHead>
                        <TableHead>Raised</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailRow(r)}>
                          {key === "mine" && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selected.has(r.id)}
                                disabled={!r.can_act}
                                onCheckedChange={(v) => setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (v) next.add(r.id); else next.delete(r.id);
                                  return next;
                                })}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-1.5">
                              {r.invoice_number}
                              {r.comment_count > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                                  <MessageSquare className="w-3 h-3" />{r.comment_count}
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{r.customer_name || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(r.total_amount))}
                            {r.currency !== "LKR" && <span className="text-muted-foreground text-xs ml-1">{r.currency}</span>}
                          </TableCell>
                          <TableCell>
                            <LevelBadge row={r} />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-[180px] truncate">
                            {r.approval_status === "pending" ? (r.waiting_on.join(", ") || "—") : (r.block_reason ?? "—")}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                            {r.created_by_name || "—"}
                            <span className={daysOld(r.created_at) >= 7 ? "text-amber-600 dark:text-amber-400" : ""}>
                              {" · "}{ageLabel(r.created_at)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            {r.can_act ? (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" title="Approve this level"
                                  onClick={() => decide.mutate({ id: r.id, decision: "approved" })} disabled={decide.isPending}>
                                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                                </Button>
                                <Button size="sm" variant="ghost" title="Request changes"
                                  onClick={() => { setNoteRow({ row: r, decision: "changes_requested" }); setNote(""); }}>
                                  <CornerUpLeft className="w-4 h-4 text-amber-600" />
                                </Button>
                                <Button size="sm" variant="ghost" title="Reject"
                                  onClick={() => { setNoteRow({ row: r, decision: "rejected" }); setNote(""); }}>
                                  <XCircle className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
                            ) : r.approval_status !== "pending" && r.is_mine ? (
                              <Button size="sm" variant="outline" onClick={() => resubmit.mutate({ id: r.id })} disabled={resubmit.isPending}>
                                <RotateCcw className="w-4 h-4 mr-1.5" /> Resubmit
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{r.block_reason ?? "—"}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Approval history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {historyRows.length === 0 ? (
                <p className="text-center py-10 text-muted-foreground">No approval activity yet</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Event</TableHead>
                    <TableHead>Level</TableHead><TableHead>By</TableHead>
                    <TableHead className="text-right">Amount (LKR)</TableHead><TableHead>Note</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {historyRows.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {new Date(h.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </TableCell>
                        <TableCell className="font-medium">{h.invoices?.invoice_number || "—"}</TableCell>
                        <TableCell><EventLabel action={h.action} /></TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {h.step_name ? `${h.step_index ? `L${h.step_index} · ` : ""}${h.step_name}` : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{actorName(h.users)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {h.amount_base != null ? formatCurrency(Number(h.amount_base)) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[240px] truncate">{h.note || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Per-invoice chain + trail */}
      <Dialog open={!!detailRow} onOpenChange={(v) => { if (!v) setDetailRow(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailRow?.invoice_number}</DialogTitle>
            <DialogDescription>
              {detailRow?.customer_name || "No customer"} · {detailRow && formatCurrency(Number(detailRow.total_amount))}
              {detailRow && detailRow.currency !== "LKR" ? ` ${detailRow.currency}` : ""}
              {detailRow?.created_by_name ? ` · raised by ${detailRow.created_by_name}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <InvoiceApprovalPanel
              invoice={{
                id: detailRow.id,
                invoice_number: detailRow.invoice_number,
                approval_status: detailRow.approval_status,
                approval_step: detailRow.approval_step,
                base_amount: Number(detailRow.base_amount),
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Reason dialog for reject / request changes */}
      <Dialog open={!!noteRow} onOpenChange={(v) => { if (!v) setNoteRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${noteRow?.decision === "rejected" ? "text-destructive" : ""}`}>
              {noteRow?.decision === "rejected"
                ? <><XCircle className="w-5 h-5" /> Reject invoice</>
                : <><CornerUpLeft className="w-5 h-5" /> Request changes</>}
            </DialogTitle>
            <DialogDescription>
              {noteRow?.row.invoice_number}
              {noteRow?.decision === "rejected"
                ? " — this ends the approval round. A reason is required."
                : " — the invoice goes back to the raiser to edit and resubmit."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[90px]"
            placeholder={noteRow?.decision === "rejected" ? "Reason for rejection…" : "What needs to change?"}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNoteRow(null)}>Cancel</Button>
            <Button
              variant={noteRow?.decision === "rejected" ? "destructive" : "default"}
              disabled={!note.trim() || decide.isPending}
              onClick={async () => {
                await decide.mutateAsync({ id: noteRow!.row.id, decision: noteRow!.decision, note: note.trim() });
                setNoteRow(null);
                setNote("");
              }}
            >
              {decide.isPending ? "Saving…" : noteRow?.decision === "rejected" ? "Reject invoice" : "Send back"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon, label, value, detail, tone,
}: { icon: typeof Inbox; label: string; value: string; detail: string; tone?: "primary" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          tone === "primary" ? "bg-primary/10 text-primary"
          : tone === "warn" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          : "bg-muted text-muted-foreground"}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold text-foreground tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LevelBadge({ row }: { row: ApprovalQueueRow }) {
  if (row.approval_status === "changes_requested") {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Sent back</Badge>;
  }
  if (row.approval_status === "rejected") {
    return <Badge className="bg-destructive/10 text-destructive">Rejected</Badge>;
  }
  return (
    <span className="flex items-center gap-2">
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 whitespace-nowrap">
        {row.approval_step} / {row.approval_steps_total || 1}
      </Badge>
      <span className="text-xs text-muted-foreground truncate max-w-[140px]">
        {row.step_name} · {row.approvals_count}/{row.required_approvals || 1}
      </span>
    </span>
  );
}

function EventLabel({ action }: { action: string }) {
  const map: Record<string, string> = {
    approved: "text-green-600 dark:text-green-400",
    rejected: "text-destructive",
    changes_requested: "text-amber-600 dark:text-amber-400",
    resubmitted: "text-blue-600 dark:text-blue-400",
    submitted: "text-muted-foreground",
    comment: "text-muted-foreground",
  };
  const label = action === "changes_requested" ? "Changes requested" : action;
  return <span className={`capitalize font-medium ${map[action] ?? "text-muted-foreground"}`}>{label}</span>;
}
