import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/currency";
import { ArrowLeft, Printer } from "lucide-react";

interface Props {
  recon: any;
  transactions: any[];
  summary: {
    paymentsCleared: number;
    depositsCleared: number;
    totalCleared: number;
    clearedBalance: number;
    difference: number;
    paymentsCount: number;
    depositsCount: number;
  };
  onBack: () => void;
}

function getTransactionType(je: any, jl: any): string {
  const ref = (je?.reference || "").toUpperCase();
  const desc = (je?.description || "").toLowerCase();
  const credit = Number(jl?.credit) || 0;
  if (ref.startsWith("PV-")) return "Bill Payment";
  if (ref.startsWith("CHQ") || ref.startsWith("CHK")) return "Check";
  if (desc.includes("transfer")) return "Transfer";
  if (desc.includes("charge") || desc.includes("fee")) return "Bank Fee";
  if (desc.includes("interest")) return "Interest";
  if (credit > 0) return "Payment";
  return "Deposit";
}

export default function ReconciliationReport({ recon, transactions, summary, onBack }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const cleared = transactions.filter((t: any) => t.cleared);
  const outstanding = transactions.filter((t: any) => !t.cleared);

  const clearedPayments = cleared.filter((t: any) => (Number(t.journal_lines?.credit) || 0) > 0);
  const clearedDeposits = cleared.filter((t: any) => (Number(t.journal_lines?.debit) || 0) > 0);
  const outstandingPayments = outstanding.filter((t: any) => (Number(t.journal_lines?.credit) || 0) > 0);
  const outstandingDeposits = outstanding.filter((t: any) => (Number(t.journal_lines?.debit) || 0) > 0);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Reconciliation Report</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; color: #1a1a1a; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #e5e5e5; }
        th { font-weight: 600; background: #f5f5f5; }
        .text-right { text-align: right; }
        .section-title { font-weight: 700; margin: 12px 0 4px; font-size: 13px; }
        .total-row { font-weight: 700; border-top: 2px solid #333; }
        .summary-line { display: flex; justify-content: space-between; padding: 2px 0; }
        h1 { font-size: 16px; margin: 0; }
        h2 { font-size: 14px; margin: 0; color: #666; }
        .header { text-align: center; margin-bottom: 16px; }
        .diff-zero { color: green; } .diff-nonzero { color: red; }
      </style></head><body>
      ${content.innerHTML}
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  const renderTxnRows = (txns: any[]) =>
    txns.map((t: any) => {
      const jl = t.journal_lines;
      const je = jl?.journal_entries;
      const debit = Number(jl?.debit) || 0;
      const credit = Number(jl?.credit) || 0;
      const amount = debit > 0 ? debit : -credit;
      return (
        <TableRow key={t.id}>
          <TableCell className="text-xs">{getTransactionType(je, jl)}</TableCell>
          <TableCell className="text-xs">{je?.entry_date}</TableCell>
          <TableCell className="text-xs font-mono">{je?.reference || "—"}</TableCell>
          <TableCell className="text-xs">{je?.description}</TableCell>
          <TableCell className="text-xs text-center">{t.cleared ? "✓" : ""}</TableCell>
          <TableCell className="text-xs text-right">{formatCurrency(amount)}</TableCell>
        </TableRow>
      );
    });

  const outstandingPaymentsTotal = outstandingPayments.reduce((s, t) => s + (Number(t.journal_lines?.credit) || 0), 0);
  const outstandingDepositsTotal = outstandingDeposits.reduce((s, t) => s + (Number(t.journal_lines?.debit) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back to Workspace</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="w-3 h-3 mr-1" /> Print Report</Button>
      </div>

      <Card>
        <CardContent className="p-6" ref={printRef}>
          {/* Report Header */}
          <div className="text-center mb-6">
            <h1 className="text-lg font-bold">Reconciliation Report</h1>
            <h2 className="text-sm text-muted-foreground">{(recon as any).accounts?.account_name}</h2>
            <p className="text-xs text-muted-foreground">Statement Ending Date: {recon.statement_ending_date}</p>
          </div>

          {/* Summary Section */}
          <div className="max-w-md mx-auto mb-6 space-y-1 text-sm">
            <div className="flex justify-between"><span>Beginning Balance</span><span className="font-medium">{formatCurrency(Number(recon.beginning_balance))}</span></div>
            <Separator />
            <div className="flex justify-between"><span>Total Checks and Payments ({summary.paymentsCount})</span><span className="font-medium">-{formatCurrency(summary.paymentsCleared)}</span></div>
            <div className="flex justify-between"><span>Total Deposits and Credits ({summary.depositsCount})</span><span className="font-medium">+{formatCurrency(summary.depositsCleared)}</span></div>
            <Separator />
            <div className="flex justify-between font-semibold"><span>Cleared Balance</span><span>{formatCurrency(summary.clearedBalance)}</span></div>
            <div className="flex justify-between"><span>Statement Ending Balance</span><span className="font-medium">{formatCurrency(Number(recon.statement_ending_balance))}</span></div>
            <Separator />
            <div className={`flex justify-between font-bold ${Math.abs(summary.difference) < 0.005 ? "text-green-700" : "text-red-700"}`}>
              <span>Difference</span>
              <span>{formatCurrency(summary.difference)}</span>
            </div>
          </div>

          {/* Cleared Transactions */}
          {clearedPayments.length > 0 && (
            <>
              <p className="text-sm font-semibold mt-4 mb-1">Cleared Checks and Payments</p>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Num</TableHead><TableHead>Memo</TableHead><TableHead className="text-center">Clr</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow></TableHeader>
                <TableBody>{renderTxnRows(clearedPayments)}</TableBody>
              </Table>
            </>
          )}

          {clearedDeposits.length > 0 && (
            <>
              <p className="text-sm font-semibold mt-4 mb-1">Cleared Deposits and Credits</p>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Num</TableHead><TableHead>Memo</TableHead><TableHead className="text-center">Clr</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow></TableHeader>
                <TableBody>{renderTxnRows(clearedDeposits)}</TableBody>
              </Table>
            </>
          )}

          {/* Outstanding Transactions */}
          {(outstandingPayments.length > 0 || outstandingDeposits.length > 0) && (
            <>
              <Separator className="my-4" />
              <p className="text-sm font-bold mb-2">Transactions Not Yet Cleared</p>

              {outstandingPayments.length > 0 && (
                <>
                  <p className="text-xs font-semibold mb-1">Outstanding Cheques ({outstandingPayments.length}) — Total: {formatCurrency(outstandingPaymentsTotal)}</p>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Num</TableHead><TableHead>Memo</TableHead><TableHead className="text-center">Clr</TableHead><TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{renderTxnRows(outstandingPayments)}</TableBody>
                  </Table>
                </>
              )}

              {outstandingDeposits.length > 0 && (
                <>
                  <p className="text-xs font-semibold mt-3 mb-1">Deposits in Transit ({outstandingDeposits.length}) — Total: {formatCurrency(outstandingDepositsTotal)}</p>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Num</TableHead><TableHead>Memo</TableHead><TableHead className="text-center">Clr</TableHead><TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{renderTxnRows(outstandingDeposits)}</TableBody>
                  </Table>
                </>
              )}
            </>
          )}

          {/* Footer */}
          <Separator className="my-4" />
          <div className="text-xs text-muted-foreground flex justify-between">
            <span>Reconciliation Status: {recon.status === "reconciled" ? "Reconciled" : "In Progress"}</span>
            <span>Reconciled: {recon.reconciled_at ? new Date(recon.reconciled_at).toLocaleDateString() : "—"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
