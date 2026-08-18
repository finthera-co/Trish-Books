import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AccountCombobox, { type AccountOption } from "@/components/shared/AccountCombobox";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  accounts: AccountOption[];
  /** The account these lines are currently posted to — offered as a no-op guard. */
  currentAccountId?: string;
  onConfirm: (accountId: string) => void;
  isPending: boolean;
}

export default function BulkChangeLedgerAccountDialog({
  open,
  onOpenChange,
  count,
  accounts,
  currentAccountId,
  onConfirm,
  isPending,
}: Props) {
  const [targetAccountId, setTargetAccountId] = useState("");

  // Only active accounts can be posted to; code order matches the COA.
  const selectableAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.is_active !== false)
        .sort((a, b) => (a.account_code || "").localeCompare(b.account_code || "")),
    [accounts]
  );

  useEffect(() => {
    if (open) setTargetAccountId("");
  }, [open]);

  const isNoOp = !!targetAccountId && targetAccountId === currentAccountId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Ledger Account</DialogTitle>
          <DialogDescription>
            Move {count} selected transaction line{count !== 1 ? "s" : ""} to a different account.
            Debit and credit amounts stay the same — only the posting account changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">New account</label>
            <AccountCombobox
              options={selectableAccounts}
              value={targetAccountId}
              onChange={setTargetAccountId}
              placeholder="Search account…"
              disabled={isPending}
            />
          </div>
          {isNoOp && (
            <div className="flex items-center gap-2 text-warning text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              That&rsquo;s the account these lines are already posted to.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(targetAccountId)} disabled={!targetAccountId || isNoOp || isPending}>
            {isPending ? "Moving…" : `Move ${count} line${count !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
