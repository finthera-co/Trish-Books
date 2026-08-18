import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePCCounts } from "@/hooks/usePettyCashCount";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";

function VarianceCell({ variance }: { variance: number }) {
  if (variance === 0) return <span className="text-success">{formatCurrency(0)}</span>;
  const label = variance > 0 ? "Over" : "Short";
  return (
    <span className="text-warning">
      {formatCurrency(variance)} <span className="text-xs">({label})</span>
    </span>
  );
}

export default function PettyCashCounts() {
  const navigate = useNavigate();
  const { data: counts, isLoading } = usePCCounts();

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/banking/petty-cash")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="page-title flex items-center gap-2"><Calculator className="w-5 h-5" /> Cash Counts</h1>
            <p className="page-description">Physical cash counts and imprest reconciliations.</p>
          </div>
        </div>
        <Button onClick={() => navigate("/banking/petty-cash/counts/new")}>
          <Plus className="w-4 h-4 mr-2" /> New Count
        </Button>
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading counts…</p>
        ) : !counts?.length ? (
          <p className="text-center py-8 text-muted-foreground">No counts recorded yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Count #</th>
                <th>Fund</th>
                <th>Date</th>
                <th className="text-right">Book</th>
                <th className="text-right">Counted</th>
                <th className="text-right">Variance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c: any) => (
                <tr
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/banking/petty-cash/counts/${c.id}`)}
                >
                  <td className="font-mono text-xs">{c.count_number}</td>
                  <td>{c.petty_cash_accounts?.account_name || "—"}</td>
                  <td className="text-muted-foreground">{formatDate(c.count_date)}</td>
                  <td className="text-right">{formatCurrency(Number(c.book_balance || 0))}</td>
                  <td className="text-right">{formatCurrency(Number(c.counted_balance || 0))}</td>
                  <td className="text-right font-medium"><VarianceCell variance={Number(c.variance || 0)} /></td>
                  <td><Badge variant="outline">{c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
