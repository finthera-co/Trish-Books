import { useState } from "react";
import { Check, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";

interface OpeningBalanceCellProps {
  accountId: string;
  currentBalance: number | null;
  activePeriodId: string | null;
  tenantId: string | undefined;
}

export default function OpeningBalanceCell({
  accountId,
  currentBalance,
  activePeriodId,
  tenantId,
}: OpeningBalanceCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (amount: number) => {
      if (!activePeriodId || !tenantId) throw new Error("No active fiscal period");
      const { error } = await supabase.from("opening_balances").upsert(
        {
          account_id: accountId,
          fiscal_period_id: activePeriodId,
          tenant_id: tenantId,
          balance: amount,
        },
        { onConflict: "account_id,fiscal_period_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
      toast.success("Opening balance saved");
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activePeriodId) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28 text-sm border border-input rounded px-2 py-1 bg-background text-foreground text-right focus:outline-none focus:ring-2 focus:ring-ring/20"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") saveMutation.mutate(parseFloat(value) || 0);
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button
          onClick={() => saveMutation.mutate(parseFloat(value) || 0)}
          className="p-0.5 rounded hover:bg-success/10 text-success"
          disabled={saveMutation.isPending}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setEditing(false)}
          className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setValue(currentBalance?.toString() || "0");
        setEditing(true);
      }}
      className="text-sm text-right w-full hover:underline cursor-pointer text-foreground/80"
      title="Click to edit"
    >
      {currentBalance ? formatCurrency(currentBalance) : <span className="text-muted-foreground">—</span>}
    </button>
  );
}
