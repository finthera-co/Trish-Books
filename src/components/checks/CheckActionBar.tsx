import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Printer, Repeat, MoreHorizontal } from "lucide-react";

interface Props {
  isNew: boolean;
  isVoided: boolean;
  isPending: boolean;
  isValid: boolean;
  isPrinting?: boolean;
  onCancel: () => void;
  onClear: () => void;
  onSave: () => void;
  onSaveAndNew: () => void;
  onPrint: () => void;
  onVoid: () => void;
  onCopy: () => void;
  onViewJournal: () => void;
  onAuditHistory: () => void;
  onMakeRecurring: () => void;
}

export default function CheckActionBar({
  isNew, isVoided, isPending, isValid, isPrinting,
  onCancel, onClear, onSave, onSaveAndNew,
  onPrint, onVoid, onCopy, onViewJournal, onAuditHistory, onMakeRecurring,
}: Props) {
  return (
    <div className="sticky bottom-0 left-0 right-0 border-t bg-card px-6 py-3 flex items-center justify-between">
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        {isNew && <Button variant="outline" onClick={onClear}>Clear</Button>}
      </div>

      {!isNew && (
        <div className="flex items-center gap-4">
          <Button variant="link" className="gap-1.5 text-primary" onClick={onPrint} disabled={isPrinting}>
            <Printer className="h-4 w-4" /> {isPrinting ? "Preparing…" : "Print check"}
          </Button>
          <Button variant="link" className="gap-1.5 text-primary" onClick={onMakeRecurring} disabled={isVoided}>
            <Repeat className="h-4 w-4" /> Make recurring
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="link" className="gap-1.5 text-primary">
                <MoreHorizontal className="h-4 w-4" /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onVoid} disabled={isVoided} className="text-destructive focus:text-destructive">
                Void
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCopy}>Copy</DropdownMenuItem>
              <DropdownMenuItem onClick={onViewJournal}>Transaction journal</DropdownMenuItem>
              <DropdownMenuItem onClick={onAuditHistory}>Audit history</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {isNew && (
        <div className="flex items-center">
          <Button
            className="rounded-r-none"
            disabled={isPending || !isValid}
            onClick={onSave}
          >
            {isPending ? "Saving…" : "Save and close"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" disabled={isPending || !isValid}>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onSave}>Save and close</DropdownMenuItem>
              <DropdownMenuItem onClick={onSaveAndNew}>Save and new</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
