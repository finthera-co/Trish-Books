import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePettyCashAccounts, usePCLedger, usePCBalance } from "@/hooks/usePettyCash";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";

const typeLabel: Record<string, string> = {
  petty_cash: "Voucher",
  petty_cash_replenishment: "Replenishment",
  petty_cash_transfer: "Transfer",
};

export default function PettyCashLedger() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: accounts } = usePettyCashAccounts();
  const { data: ledger, isLoading } = usePCLedger(id);
  const { data: balance } = usePCBalance(id);

  const account = accounts?.find((a: any) => a.id === id);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/banking/petty-cash")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="page-title">{account?.account_name || "Petty Cash"} – Ledger</h1>
            <p className="page-description">Chronological journal entries derived from the general ledger.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate(`/banking/petty-cash/counts/new?account=${id}`)}>
          <Calculator className="w-4 h-4 mr-2" /> Reconcile / Count Cash
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Float</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatCurrency(balance?.float_amount || 0)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Current Balance</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-success">{formatCurrency(balance?.remaining || 0)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Replenishment Suggested</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-warning">
              {formatCurrency(Math.max(0, (balance?.float_amount || 0) - (balance?.remaining || 0)))}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading ledger...</p>
        ) : !ledger?.length ? (
          <p className="text-center py-8 text-muted-foreground">No journal activity yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Description</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row: any) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/accounting/journal-entries/${row.journal_entry_id}`)}
                >
                  <td className="text-muted-foreground">{formatDate(row.date)}</td>
                  <td><Badge variant="outline">{typeLabel[row.entry_type] || row.entry_type}</Badge></td>
                  <td className="font-mono text-xs">{row.reference || "—"}</td>
                  <td>{row.description}</td>
                  <td className="text-right">{row.debit > 0 ? formatCurrency(row.debit) : "—"}</td>
                  <td className="text-right">{row.credit > 0 ? formatCurrency(row.credit) : "—"}</td>
                  <td className="text-right font-medium">{formatCurrency(row.running_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
