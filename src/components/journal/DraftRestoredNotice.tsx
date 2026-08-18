import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

/**
 * Shown when a journal form came back from a stored draft rather than from a
 * clean slate — the user needs to know these numbers are theirs from an earlier
 * attempt, and needs a way to throw them away.
 */
export default function DraftRestoredNotice({
  savedAt,
  onDiscard,
  onDismiss,
  context,
}: {
  savedAt: number;
  onDiscard: () => void;
  onDismiss: () => void;
  /** What discarding falls back to, e.g. "an empty entry" / "the posted entry". */
  context: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
      <History className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">Unsaved entry restored</p>
        <p className="text-muted-foreground mt-0.5">
          This entry was never posted — recovered from {formatDateTime(new Date(savedAt))}. Check it over, then post it.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs shrink-0"
        onClick={onDiscard}
        title={`Discard the draft and go back to ${context}`}
      >
        Discard draft
      </Button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
