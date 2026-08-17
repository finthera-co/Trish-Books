import { AlertTriangle } from "lucide-react";
import { useOBEBalance } from "@/hooks/useOpeningBalanceEquity";
import { useSystemSetting } from "@/hooks/useOpeningBalanceSettings";
import { formatCurrency } from "@/lib/currency";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function OBEBanner() {
  const { data: obeBalance, isLoading } = useOBEBalance();
  const { data: obeClosed } = useSystemSetting("obe_closed");
  const navigate = useNavigate();

  if (isLoading || !obeBalance || obeBalance.type === "zero" || obeClosed === "true") return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-[hsl(var(--warning-ink))] flex-shrink-0" />
        <span className="text-sm font-medium text-[hsl(var(--warning-ink))]">
          Opening Balance Equity has a balance of {formatCurrency(obeBalance.balance)}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => navigate("/accounting/opening-balances")}
        >
          Review
        </Button>
        <Button
          size="sm"
          className="text-xs"
          onClick={() => navigate("/accounting/close-obe")}
        >
          Close Now
        </Button>
      </div>
    </div>
  );
}
