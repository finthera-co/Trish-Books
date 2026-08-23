import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";

interface Props {
  disabled: boolean;
  memo: string;
  onMemoChange: (v: string) => void;
}

// Attachments has no backing storage table yet (payment_vouchers.bills_attached
// is only ever an integer count today, no per-file metadata) — renders the
// pixel-spec drop zone but is a visual placeholder until that's built.
export default function CheckMemoAttachments({ disabled, memo, onMemoChange }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <Label>Memo</Label>
        <Textarea
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
          rows={4}
          className="mt-1"
          placeholder="Optional notes — prints on the check face"
          disabled={disabled}
        />
      </div>
      <div>
        <Label>Attachments</Label>
        <button
          type="button"
          onClick={() => toast.info("Attachments are coming soon")}
          disabled={disabled}
          className="mt-1 w-full h-[104px] rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
        >
          <Paperclip className="h-4 w-4" />
          Add attachment
        </button>
      </div>
    </div>
  );
}
