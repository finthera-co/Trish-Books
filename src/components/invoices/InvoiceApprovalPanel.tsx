// ─────────────────────────────────────────────────────────────────────────────
// InvoiceApprovalPanel
// The approval chain for one invoice: every level with its sign-offs, the full
// event trail (decisions + comments), and whichever actions this user may take.
// Shared by the invoice detail dialog and the approvals inbox.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import {
  ShieldCheck, CheckCircle2, XCircle, CornerUpLeft, MessageSquare,
  RotateCcw, Send, Circle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import {
  useApprovalPlan, useInvoiceApprovalTrail, useApprovalQueue,
  useDecideInvoice, useResubmitInvoice, useAddApprovalComment,
  actorName, type ApprovalEvent,
} from "@/hooks/useApprovals";

interface Props {
  invoice: {
    id: string;
    invoice_number?: string;
    approval_status?: string;
    approval_step?: number;
    total_amount?: number;
    exchange_rate?: number;
    base_amount?: number;
    created_by?: string | null;
  };
  /** Hide the section entirely when the invoice never needed approval. */
  hideWhenNotRequired?: boolean;
}

const eventStyle: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  submitted:         { label: "Submitted for approval", className: "text-muted-foreground", Icon: Send },
  resubmitted:       { label: "Resubmitted",            className: "text-blue-600 dark:text-blue-400", Icon: RotateCcw },
  approved:          { label: "Approved",               className: "text-green-600 dark:text-green-400", Icon: CheckCircle2 },
  rejected:          { label: "Rejected",               className: "text-destructive", Icon: XCircle },
  changes_requested: { label: "Changes requested",      className: "text-amber-600 dark:text-amber-400", Icon: CornerUpLeft },
  comment:           { label: "Comment",                className: "text-muted-foreground", Icon: MessageSquare },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function InvoiceApprovalPanel({ invoice, hideWhenNotRequired = true }: Props) {
  const { appUser } = useAuth();
  const [noteFor, setNoteFor] = useState<"rejected" | "changes_requested" | null>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");

  const base = invoice.base_amount ?? Number(invoice.total_amount ?? 0) * Number(invoice.exchange_rate ?? 1);
  const { data: plan } = useApprovalPlan(base);
  const { data: trail } = useInvoiceApprovalTrail(invoice.id);
  const { data: queue } = useApprovalQueue();
  const decide = useDecideInvoice();
  const resubmit = useResubmitInvoice();
  const addComment = useAddApprovalComment();

  const row = (queue ?? []).find((q) => q.id === invoice.id);
  const status = row?.approval_status ?? invoice.approval_status ?? "not_required";

  if (hideWhenNotRequired && (status === "not_required" || !status)) return null;

  const events = trail ?? [];
  // Sign-offs only count from the latest submission onward — an amount change or
  // a resubmission starts a fresh round.
  const roundStart = [...events].reverse().find((e) => e.action === "submitted" || e.action === "resubmitted")?.created_at;
  const inRound = (e: ApprovalEvent) => !roundStart || e.created_at >= roundStart;

  const currentStep = row?.approval_step ?? invoice.approval_step ?? 1;
  const levels = (plan ?? []).map((step, i) => {
    const idx = i + 1;
    const signers = events.filter((e) => e.action === "approved" && e.step_index === idx && inRound(e));
    const state =
      status === "approved" || idx < currentStep ? "done"
      : idx === currentStep ? (status === "pending" ? "open" : "held")
      : "upcoming";
    return { idx, step, signers, state };
  });

  const canResubmit =
    (status === "changes_requested" || status === "rejected") &&
    (invoice.created_by === appUser?.id || row?.is_mine || !!row?.can_act);

  const submitDecision = async (decision: "approved" | "rejected" | "changes_requested") => {
    if (decision === "approved") {
      await decide.mutateAsync({ id: invoice.id, decision });
      return;
    }
    await decide.mutateAsync({ id: invoice.id, decision, note: note.trim() });
    setNoteFor(null);
    setNote("");
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Approval chain
        </h4>
        <StatusBadge status={status} step={currentStep} total={row?.approval_steps_total ?? levels.length} />
      </div>

      {/* Levels */}
      {levels.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This invoice no longer falls under any approval level.
        </p>
      ) : (
        <div className="space-y-0">
          {levels.map(({ idx, step, signers, state }, i) => {
            const required = Math.max(1, Number(step.required_approvals) || 1);
            const isLast = i === levels.length - 1;
            return (
              <div key={idx} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    state === "done" ? "bg-green-100 dark:bg-green-900/30"
                    : state === "open" ? "bg-amber-100 dark:bg-amber-900/30"
                    : state === "held" ? "bg-destructive/10"
                    : "bg-muted"}`}>
                    {state === "done" ? <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                     : state === "open" ? <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                     : state === "held" ? <CornerUpLeft className="w-4 h-4 text-destructive" />
                     : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                  {!isLast && <div className={`w-0.5 flex-1 ${state === "done" ? "bg-green-500/40" : "bg-border"}`} />}
                </div>
                <div className="pb-4 flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      <span className="text-muted-foreground font-normal">Level {idx} · </span>{step.name}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {signers.length}/{required}
                    </span>
                  </div>
                  {signers.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Signed by {signers.map((s) => actorName(s.users)).join(", ")}
                    </p>
                  )}
                  {signers.length === 0 && state === "open" && (row?.waiting_on?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">Waiting on {row!.waiting_on.join(", ")}</p>
                  )}
                  {state === "upcoming" && Number(step.min_amount) > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Applies from {formatCurrency(Number(step.min_amount))}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {row?.can_act && (
          <>
            <Button size="sm" onClick={() => submitDecision("approved")} disabled={decide.isPending}>
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setNoteFor("changes_requested"); setNote(""); }} disabled={decide.isPending}>
              <CornerUpLeft className="w-4 h-4 mr-1.5" /> Request changes
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive"
              onClick={() => { setNoteFor("rejected"); setNote(""); }} disabled={decide.isPending}>
              <XCircle className="w-4 h-4 mr-1.5" /> Reject
            </Button>
          </>
        )}
        {canResubmit && (
          <Button size="sm" variant="outline" onClick={() => resubmit.mutate({ id: invoice.id })} disabled={resubmit.isPending}>
            <RotateCcw className="w-4 h-4 mr-1.5" /> {resubmit.isPending ? "Resubmitting…" : "Resubmit for approval"}
          </Button>
        )}
        {!row?.can_act && row?.block_reason && (
          <span className="text-xs text-muted-foreground">{row.block_reason}</span>
        )}
      </div>

      {/* Trail */}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Activity</p>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {[...events].reverse().map((e) => {
              const s = eventStyle[e.action] ?? eventStyle.comment;
              return (
                <div key={e.id} className="flex items-start gap-2 text-xs">
                  <s.Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${s.className}`} />
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className={`font-medium ${s.className}`}>{s.label}</span>
                      {e.step_name && e.action !== "comment" && (
                        <span className="text-muted-foreground"> · {e.step_name}</span>
                      )}
                      <span className="text-muted-foreground"> · {actorName(e.users)}</span>
                    </p>
                    {e.note && <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{e.note}</p>}
                  </div>
                  <span className="text-muted-foreground shrink-0">{when(e.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Comment box */}
      <div className="flex items-start gap-2">
        <textarea
          value={comment}
          onChange={(ev) => setComment(ev.target.value)}
          placeholder="Add a comment for the approvers…"
          rows={2}
          className="flex-1 text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground resize-none"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!comment.trim() || addComment.isPending}
          onClick={async () => { await addComment.mutateAsync({ id: invoice.id, note: comment.trim() }); setComment(""); }}
        >
          <MessageSquare className="w-4 h-4" />
        </Button>
      </div>

      {/* Reason dialog — rejecting and requesting changes both need a why */}
      <Dialog open={!!noteFor} onOpenChange={(v) => { if (!v) setNoteFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${noteFor === "rejected" ? "text-destructive" : ""}`}>
              {noteFor === "rejected"
                ? <><XCircle className="w-5 h-5" /> Reject invoice</>
                : <><CornerUpLeft className="w-5 h-5" /> Request changes</>}
            </DialogTitle>
            <DialogDescription>
              {invoice.invoice_number}
              {noteFor === "rejected"
                ? " — rejecting ends this approval round. A reason is required."
                : " — the invoice goes back to the raiser to edit and resubmit. Say what needs to change."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[90px]"
            placeholder={noteFor === "rejected" ? "Reason for rejection…" : "What needs to change?"}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button
              variant={noteFor === "rejected" ? "destructive" : "default"}
              disabled={!note.trim() || decide.isPending}
              onClick={() => submitDecision(noteFor!)}
            >
              {decide.isPending ? "Saving…" : noteFor === "rejected" ? "Reject invoice" : "Send back"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StatusBadge({ status, step, total }: { status: string; step?: number; total?: number }) {
  if (status === "approved") {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Approved</Badge>;
  }
  if (status === "rejected") return <Badge className="bg-destructive/10 text-destructive">Rejected</Badge>;
  if (status === "changes_requested") {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Changes requested</Badge>;
  }
  if (status === "pending") {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
        Level {step ?? 1} of {total || 1}
      </Badge>
    );
  }
  return <Badge variant="secondary">No approval required</Badge>;
}
