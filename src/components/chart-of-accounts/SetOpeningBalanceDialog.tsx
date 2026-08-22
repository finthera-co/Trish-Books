import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useSaveAccountOpeningBalance } from "@/hooks/useOpeningBalanceSettings";
import { getNormalBalance } from "@/lib/accountTypes";

interface SetOpeningBalanceAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance?: number | null;
  opening_balance_type?: string | null;
}

interface SetOpeningBalanceDialogProps {
  account: SetOpeningBalanceAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalPeriodLabel?: string;
  isPeriodClosed?: boolean;
}

export default function SetOpeningBalanceDialog({
  account, open, onOpenChange, fiscalPeriodLabel, isPeriodClosed,
}: SetOpeningBalanceDialogProps) {
  const saveMutation = useSaveAccountOpeningBalance();
  const [value, setValue] = useState("");
  const [balType, setBalType] = useState<"debit" | "credit">("debit");

  useEffect(() => {
    if (!open || !account) return;
    setValue(account.opening_balance ? String(account.opening_balance) : "");
    // opening_balance_type is NOT NULL in the DB (defaults to "debit"), so it
    // only reflects real intent once an amount has actually been set — before
    // that, default the toggle to the account's own normal balance instead.
    setBalType(
      account.opening_balance
        ? ((account.opening_balance_type as "debit" | "credit") ?? "debit")
        : (getNormalBalance(account.account_type) === "Debit" ? "debit" : "credit")
    );
  }, [open, account?.id]);

  const handleSave = async () => {
    if (!account) return;
    await saveMutation.mutateAsync({ accountId: account.id, openingBalance: parseFloat(value) || 0, openingBalanceType: balType });
    onOpenChange(false);
  };

  if (!account) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set Opening Balance</DialogTitle>
          <DialogDescription>
            {account.account_code} — {account.account_name}
            {fiscalPeriodLabel ? ` · ${fiscalPeriodLabel}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {isPeriodClosed && (
            <p className="text-[11px] text-destructive flex items-center gap-1.5 bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              This fiscal period is closed. Opening balances can't be changed here.
            </p>
          )}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-sm font-medium">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={isPeriodClosed}
                autoFocus
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground text-right focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <select
                value={balType}
                onChange={(e) => setBalType(e.target.value as "debit" | "credit")}
                disabled={isPeriodClosed}
                className="mt-1 text-sm border border-input rounded-lg px-2 py-2 bg-background disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={isPeriodClosed || saveMutation.isPending}
            className="w-full"
          >
            {saveMutation.isPending ? "Saving…" : "Save Opening Balance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
