import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bot,
  Send,
  Square,
  RotateCcw,
  Loader2,
  Check,
  X,
  AlertTriangle,
  FileText,
  Landmark,
  Receipt,
} from "lucide-react";
import { useAgentChat } from "@/hooks/useFinancialAnalyst";
import {
  useAgentProposals,
  useApproveProposal,
  useRejectProposal,
  type AgentProposal,
} from "@/hooks/useAgentProposals";
import { MessageBubble } from "@/components/analyst/AgentMessage";
import { formatCurrency } from "@/lib/currency";
import { formatDate, formatRelativeTime } from "@/lib/format";

const STARTERS = [
  "Work through the biggest clusters in Suspense and propose where they belong.",
  "Which suspense lines can you confidently clear, and which need my input?",
  "Draft the month-end accrual for this month's unbilled electricity.",
  "Enter a bill from Dialog Axiata for LKR 18,450, invoice INV-55213, dated today.",
];

const KIND_META: Record<AgentProposal["kind"], { label: string; icon: typeof FileText }> = {
  clear_suspense: { label: "Clear suspense", icon: Landmark },
  journal_entry: { label: "Journal entry", icon: FileText },
  supplier_bill: { label: "Supplier bill", icon: Receipt },
};

export default function BookkeepingAgent() {
  const qc = useQueryClient();
  const { messages, ask, stop, reset, isStreaming } = useAgentChat("bookkeeping-agent", {
    // Each proposal lands in the queue as soon as it's created, not after the
    // whole reply finishes.
    onProposal: () => qc.invalidateQueries({ queryKey: ["agent_proposals"] }),
  });
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!draft.trim() || isStreaming) return;
    ask(draft);
    setDraft("");
  };

  return (
    <div className="w-full px-4 sm:px-5 py-5 flex flex-col flex-1 min-h-0">
      <div className="animate-fade-in shrink-0">
        <p className="text-xs font-medium text-primary mb-1">Accounting → Bookkeeping Agent</p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Bookkeeping Agent</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Clears suspense, drafts journals and enters bills. Nothing reaches your books until you approve it.
            </p>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={reset} disabled={isStreaming}>
              <RotateCcw className="w-4 h-4 mr-2" />
              New conversation
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        {/* Chat */}
        <div className="flex flex-col min-h-[28rem] lg:min-h-0">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
            {messages.length === 0 ? (
              <EmptyState onPick={(q) => ask(q)} />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
          </div>

          <div className="shrink-0 pt-4">
            <div className="flex gap-2 items-end">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask the agent to clear suspense, draft a journal, enter a bill…"
                className="min-h-[52px] max-h-40 resize-none"
                disabled={isStreaming}
              />
              {isStreaming ? (
                <Button onClick={stop} variant="outline" size="icon" className="h-[52px] w-[52px]">
                  <Square className="w-4 h-4" />
                </Button>
              ) : (
                <Button onClick={submit} size="icon" className="h-[52px] w-[52px]" disabled={!draft.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Review queue */}
        <ReviewQueue />
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
      <div className="p-3 rounded-xl bg-primary/10 mb-4">
        <Bot className="w-6 h-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">What needs doing?</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">
        The agent reads your ledger, then puts each action in the review queue. You approve, edit or
        reject every one.
      </p>
      <div className="grid sm:grid-cols-2 gap-2 mt-6 w-full max-w-2xl">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-sm rounded-lg border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors px-3 py-2.5"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewQueue() {
  const [view, setView] = useState<"open" | "history">("open");
  const { data: items, isLoading } = useAgentProposals(view);
  const approve = useApproveProposal();
  const [rejecting, setRejecting] = useState<AgentProposal | null>(null);

  return (
    <Card className="flex flex-col min-h-[24rem] lg:min-h-0">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Review queue</CardTitle>
          <Tabs value={view} onValueChange={(v) => setView(v as "open" | "history")}>
            <TabsList className="h-8">
              <TabsTrigger value="open" className="text-xs px-2.5">To review</TabsTrigger>
              <TabsTrigger value="history" className="text-xs px-2.5">History</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : !items?.length ? (
          <p className="text-sm text-muted-foreground">
            {view === "open" ? "Nothing waiting for review." : "No decided proposals yet."}
          </p>
        ) : (
          items.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              busy={approve.isPending && approve.variables?.id === p.id}
              disabled={approve.isPending}
              onApprove={() => approve.mutate(p)}
              onReject={() => setRejecting(p)}
            />
          ))
        )}
      </CardContent>
      <RejectDialog proposal={rejecting} onClose={() => setRejecting(null)} />
    </Card>
  );
}

function ProposalCard({
  proposal: p,
  busy,
  disabled,
  onApprove,
  onReject,
}: {
  proposal: AgentProposal;
  busy: boolean;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const meta = KIND_META[p.kind];
  const Icon = meta.icon;
  const decidable = p.status === "pending" || p.status === "failed";
  // A claim the browser abandoned mid-apply. The action may or may not have
  // gone through, so the reviewer is told to check before retrying.
  const stale =
    p.status === "applying" &&
    p.claimed_at != null &&
    Date.now() - new Date(p.claimed_at).getTime() > 10 * 60_000;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug break-words">{p.title}</p>
          <p className="text-xs text-muted-foreground">
            {meta.label} · {formatRelativeTime(p.created_at)}
          </p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <ProposalPreview proposal={p} />

      {p.rationale && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{p.rationale}</p>
      )}

      {p.error && (
        <div className="flex gap-1.5 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-words">
            {p.status === "rejected" ? `Rejected: ${p.error}` : p.error}
          </span>
        </div>
      )}

      {stale && (
        <p className="text-xs text-amber-600">
          Approval was interrupted. Check whether it went through before retrying.
        </p>
      )}

      {(decidable || stale) && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={onApprove} disabled={disabled}>
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5 mr-1.5" />
            )}
            {p.kind === "supplier_bill" ? "Open in bill form" : p.status === "pending" ? "Approve" : "Retry"}
          </Button>
          {decidable && (
            <Button size="sm" variant="outline" onClick={onReject} disabled={disabled}>
              <X className="w-3.5 h-3.5 mr-1.5" />
              Reject
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentProposal["status"] }) {
  const map: Record<AgentProposal["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pending", variant: "secondary" },
    applying: { label: "Applying", variant: "outline" },
    applied: { label: "Applied", variant: "default" },
    rejected: { label: "Rejected", variant: "outline" },
    failed: { label: "Failed", variant: "destructive" },
  };
  const s = map[status];
  return <Badge variant={s.variant} className="shrink-0 text-[10px]">{s.label}</Badge>;
}

/** What the approver is signing off, from the preview the agent's tool captured. */
function ProposalPreview({ proposal: p }: { proposal: AgentProposal }) {
  const v = p.preview ?? {};

  if (p.kind === "clear_suspense") {
    return (
      <div className="text-xs space-y-1 rounded-md bg-muted/50 px-2.5 py-2">
        <p>
          <span className="font-medium">{v.line_count} line{v.line_count === 1 ? "" : "s"}</span> →{" "}
          <span className="font-medium">{v.target_account}</span>
        </p>
        <p className="text-muted-foreground">
          {v.money_out ? `Out ${formatCurrency(v.money_out)}` : ""}
          {v.money_out && v.money_in ? " · " : ""}
          {v.money_in ? `In ${formatCurrency(v.money_in)}` : ""}
          {v.date_from ? ` · ${formatDate(v.date_from)}${v.date_to && v.date_to !== v.date_from ? ` – ${formatDate(v.date_to)}` : ""}` : ""}
        </p>
        {v.teach_variant && (
          <p className="text-muted-foreground">
            Also teaches the import engine: “{v.teach_variant}” → this account
          </p>
        )}
        {(v.sample ?? []).slice(0, 3).map((s: any, i: number) => (
          <p key={i} className="text-muted-foreground truncate">
            {formatDate(s.date)} · {s.description} · {formatCurrency(Math.abs(s.amount))}
          </p>
        ))}
      </div>
    );
  }

  if (p.kind === "journal_entry") {
    return (
      <div className="text-xs rounded-md bg-muted/50 px-2.5 py-2 space-y-1">
        <p className="text-muted-foreground">
          {formatDate(v.entry_date)} · {formatCurrency(v.total ?? 0)}
        </p>
        {(v.lines ?? []).map((l: any, i: number) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="truncate">{l.account}</span>
            <span className="font-mono shrink-0">
              {l.debit ? `Dr ${formatCurrency(l.debit)}` : `Cr ${formatCurrency(l.credit)}`}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="text-xs rounded-md bg-muted/50 px-2.5 py-2 space-y-1">
      <p>
        <span className="font-medium">{v.vendor}</span>
        {v.vendor_ref ? ` · ${v.vendor_ref}` : ""} · {formatDate(v.bill_date)}
      </p>
      {(v.lines ?? []).map((l: any, i: number) => (
        <div key={i} className="flex justify-between gap-2">
          <span className="truncate">{l.description || l.account}</span>
          <span className="font-mono shrink-0">{formatCurrency(l.amount)}{l.taxed ? " + tax" : ""}</span>
        </div>
      ))}
      <p className="text-muted-foreground">
        {formatCurrency(v.subtotal_before_tax ?? 0)} before tax. Tax and totals are worked out in the bill form; it saves as a draft.
      </p>
    </div>
  );
}

function RejectDialog({ proposal, onClose }: { proposal: AgentProposal | null; onClose: () => void }) {
  const reject = useRejectProposal();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (proposal) setReason("");
  }, [proposal]);

  return (
    <Dialog open={proposal != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject proposal</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{proposal?.title}</p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional: why? The agent reads this before proposing again."
          className="min-h-[80px]"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={reject.isPending}
            onClick={() =>
              proposal && reject.mutate({ id: proposal.id, reason }, { onSuccess: onClose })
            }
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
