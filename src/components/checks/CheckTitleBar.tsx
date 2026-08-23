import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface Props {
  chequeNumber: string;
  printLater: boolean;
  isNew: boolean;
  status?: string | null;
  totalAmount: number;
  backTo: string;
}

export default function CheckTitleBar({ chequeNumber, printLater, isNew, status, totalAmount, backTo }: Props) {
  const navigate = useNavigate();
  const title = isNew
    ? "New Check"
    : `Check #${printLater ? "To print" : chequeNumber || "—"}`;

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(backTo)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-lg font-semibold">{title}</span>
        {status === "voided" && <Badge variant="destructive">VOIDED</Badge>}
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">Amount</div>
        <div className="text-2xl font-bold font-mono text-primary">{formatCurrency(totalAmount)}</div>
      </div>
    </div>
  );
}
