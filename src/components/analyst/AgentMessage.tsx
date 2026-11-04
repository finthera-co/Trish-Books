import { Card, CardContent } from "@/components/ui/card";
import { Check, AlertCircle, Loader2, ClipboardCheck } from "lucide-react";
import { toolLabel, type AnalystMessage } from "@/hooks/useFinancialAnalyst";

// Chat rendering shared by the Financial Analyst and the Bookkeeping Agent —
// both stream the same message shape from useAgentChat.

export function MessageBubble({ message }: { message: AnalystMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full space-y-2">
        {message.toolCalls.length > 0 && (
          <Card className="bg-muted/40 border-dashed">
            <CardContent className="py-2.5 px-3 space-y-1.5">
              {message.toolCalls.map((call, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {call.status === "running" && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                  )}
                  {call.status === "done" && (
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  )}
                  {call.status === "failed" && (
                    <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  )}
                  <span
                    className={
                      call.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {toolLabel(call.name)}
                    {call.status === "failed" && call.error ? ` — ${call.error}` : ""}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {message.proposals && message.proposals.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-primary">
              {message.proposals.length === 1
                ? "1 proposal queued for review"
                : `${message.proposals.length} proposals queued for review`}
            </p>
            {message.proposals.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs text-foreground">
                <ClipboardCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="truncate">{p.title}</span>
              </div>
            ))}
          </div>
        )}

        {message.content ? (
          <div className="rounded-2xl rounded-bl-sm bg-card border border-border px-4 py-3">
            <AnalystProse text={message.content} />
            {message.streaming && (
              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        ) : message.streaming && message.toolCalls.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            Thinking…
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders the answer's light markdown — headings, bullets, bold — without
 * pulling in a markdown library. The model is instructed to write prose, so
 * this covers what it actually emits rather than the whole spec.
 */
function AnalystProse({ text }: { text: string }) {
  const blocks = text.split("\n");

  return (
    <div className="text-sm text-foreground space-y-2 leading-relaxed">
      {blocks.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        const heading = trimmed.match(/^#{1,3}\s+(.*)$/);
        if (heading) {
          return (
            <p key={i} className="font-semibold text-foreground pt-1">
              {inline(heading[1])}
            </p>
          );
        }

        const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground shrink-0">•</span>
              <span>{inline(bullet[1])}</span>
            </div>
          );
        }

        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground shrink-0">{numbered[1]}.</span>
              <span>{inline(numbered[2])}</span>
            </div>
          );
        }

        // Table rows arrive as pipe-delimited lines; showing the raw pipes is
        // ugly but honest, and a real table renderer is not worth the weight
        // for the rare comparison the model formats this way.
        if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
          if (/^\|[\s|:-]+\|$/.test(trimmed)) return null;
          const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
          return (
            <div key={i} className="flex gap-3 text-xs border-b border-border/50 py-1">
              {cells.map((c, j) => (
                <span key={j} className="flex-1 min-w-0">{inline(c)}</span>
              ))}
            </div>
          );
        }

        return <p key={i}>{inline(trimmed)}</p>;
      })}
    </div>
  );
}

/** Bold and inline code within a line. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="text-xs bg-muted px-1 py-0.5 rounded font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
