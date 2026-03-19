import { useState, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { checkBudgetForTransaction, createBudgetNotification } from "@/hooks/useBudgets";

interface BudgetWarningBannerProps {
  accountId: string | undefined;
  accountName?: string;
  amount: number;
  transactionDate: string;
  onBudgetCheck?: (result: { exceeded: boolean; warning: boolean }) => void;
}

export default function BudgetWarningBanner({
  accountId,
  amount,
  transactionDate,
  onBudgetCheck,
}: BudgetWarningBannerProps) {
  const [result, setResult] = useState<{
    hasBudget: boolean;
    exceeded: boolean;
    warning: boolean;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountId || amount <= 0 || !transactionDate) {
      setResult(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await checkBudgetForTransaction(accountId, amount, transactionDate);
        setResult(res);
        onBudgetCheck?.({ exceeded: res.exceeded, warning: res.warning });
      } catch {
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 500); // debounce

    return () => clearTimeout(timer);
  }, [accountId, amount, transactionDate]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-muted-foreground text-xs">
        Checking budget...
      </div>
    );
  }

  if (!result || !result.hasBudget) return null;

  if (result.exceeded) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium">
        <XCircle className="w-4 h-4 flex-shrink-0" />
        {result.message}
      </div>
    );
  }

  if (result.warning) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs font-medium">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        {result.message}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-success/10 border border-success/30 text-success text-xs font-medium">
      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
      {result.message}
    </div>
  );
}
