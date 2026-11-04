import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Send, Square, RotateCcw, Loader2, Database } from "lucide-react";
import {
  useAnalystIndexStatus,
  useBuildAnalystIndex,
  useFinancialAnalyst,
} from "@/hooks/useFinancialAnalyst";
import { MessageBubble } from "@/components/analyst/AgentMessage";

const STARTERS = [
  "How did we perform last month compared to the month before?",
  "What are our biggest expense categories this year?",
  "Which customers owe us the most, and how overdue are they?",
  "How much cash do we have, and what's our monthly burn?",
];

export default function FinancialAnalyst() {
  const { messages, ask, stop, reset, isStreaming } = useFinancialAnalyst();
  const { data: index } = useAnalystIndexStatus();
  const { build, isBuilding } = useBuildAnalystIndex();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the answer as it streams, so the user isn't scrolling to keep up.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!draft.trim() || isStreaming) return;
    ask(draft);
    setDraft("");
  };

  const indexIncomplete = index && index.total > 0 && index.embedded < index.total;
  const indexEmpty = index && index.total === 0;

  return (
    <div className="w-full px-4 sm:px-5 py-5 flex flex-col flex-1 min-h-0">
      <div className="animate-fade-in shrink-0">
        <p className="text-xs font-medium text-primary mb-1">
          Reports → Financial Analyst
        </p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Financial Analyst
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ask anything about your books. Every figure is read live from your ledger.
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

      {/* The analyst can still answer with an unbuilt index — it falls back to
          exact-name lookup — but paraphrased questions will miss, so say so
          rather than letting the user conclude the data isn't there. */}
      {(indexEmpty || indexIncomplete) && (
        <Alert className="mt-4 shrink-0">
          <Database className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
            <span>
              {indexEmpty
                ? "The search index hasn't been built yet. Questions that describe things in your own words will be less accurate until it is."
                : `Search index is ${Math.round((index!.embedded / index!.total) * 100)}% built (${index!.embedded.toLocaleString()} of ${index!.total.toLocaleString()} records).`}
            </span>
            <Button size="sm" variant="outline" onClick={build} disabled={isBuilding}>
              {isBuilding ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Building…</>
              ) : (
                indexEmpty ? "Build index" : "Continue building"
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4 pr-1"
      >
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
              // Enter sends; Shift+Enter is a newline — the convention for
              // a chat box, and questions here are usually one line.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about revenue, expenses, cash, receivables…"
            className="min-h-[52px] max-h-40 resize-none"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button onClick={stop} variant="outline" size="icon" className="h-[52px] w-[52px]">
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              size="icon"
              className="h-[52px] w-[52px]"
              disabled={!draft.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Answers are generated from your live ledger. Check anything material against the
          underlying report before acting on it.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <div className="p-3 rounded-xl bg-primary/10 mb-4">
        <Sparkles className="w-6 h-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        What would you like to know?
      </h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">
        The analyst reads your trial balance, financial statements, ageing reports and
        ledgers to answer — it never estimates.
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
