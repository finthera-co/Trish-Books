import { useState } from "react";
import { Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useSaveAccountOpeningBalance } from "@/hooks/useOpeningBalanceSettings";

interface InlineOpeningBalanceProps {
  accountId: string;
  currentBalance: number;
  currentType: string;
  normalBalance: string;
  isLocked: boolean;
}

export default function InlineOpeningBalance({
  accountId,
  currentBalance,
  currentType,
  normalBalance,
  isLocked,
}: InlineOpeningBalanceProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [balType, setBalType] = useState<"debit" | "credit">("debit");
  const saveMutation = useSaveAccountOpeningBalance();

  if (isLocked) {
    if (!currentBalance) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <span className="text-sm text-foreground/80">
        {formatCurrency(currentBalance)} <span className="text-[10px] text-muted-foreground uppercase">{currentType}</span>
      </span>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 text-sm border border-input rounded px-2 py-1 bg-background text-foreground text-right focus:outline-none focus:ring-2 focus:ring-ring/20"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") saveMutation.mutate({ accountId, openingBalance: parseFloat(value) || 0, openingBalanceType: balType });
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <select
          value={balType}
          onChange={(e) => setBalType(e.target.value as "debit" | "credit")}
          className="text-[10px] border border-input rounded px-1 py-1 bg-background"
        >
          <option value="debit">Dr</option>
          <option value="credit">Cr</option>
        </select>
        <button
          onClick={() => {
            saveMutation.mutate({ accountId, openingBalance: parseFloat(value) || 0, openingBalanceType: balType });
            setEditing(false);
          }}
          className="p-0.5 rounded hover:bg-success/10 text-success"
          disabled={saveMutation.isPending}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setEditing(false)} className="p-0.5 rounded hover:bg-destructive/10 text-destructive">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setValue(currentBalance?.toString() || "0");
        setBalType((currentType as "debit" | "credit") || (normalBalance === "Debit" ? "debit" : "credit"));
        setEditing(true);
      }}
      className="text-sm text-right w-full hover:underline cursor-pointer text-foreground/80"
      title="Click to edit opening balance"
    >
      {currentBalance ? (
        <>
          {formatCurrency(currentBalance)}{" "}
          <span className="text-[10px] text-muted-foreground uppercase">{currentType}</span>
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </button>
  );
}
