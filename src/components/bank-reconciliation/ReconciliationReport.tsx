import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/currency";
import { ArrowLeft, Printer } from "lucide-react";
import { formatDate } from "@/lib/format";

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

// Format ISO date string → MM/DD/YYYY
function toMMDDYYYY(d: string) {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

// Format current datetime → "MM/DD/YY  H:MM AM/PM"
function printedAt() {
  const now = new Date();
  return (
    formatDate(now) +
    "  " +
    now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

// Amount helpers
function fmtNeg(n: number) { return `-${formatCurrency(n)}`; }
function fmtPos(n: number) { return `+${formatCurrency(n)}`; }
function fmtSigned(n: number) { return n < 0 ? `-${formatCurrency(Math.abs(n))}` : formatCurrency(n); }

export default function ReconciliationReport({ recon, transactions, summary, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<"summary" | "detail">("summary");
  const summaryRef = useRef<HTMLDivElement>(null);
  const detailRef  = useRef<HTMLDivElement>(null);

  // ── Existing groupings ───────────────────────────────────────────────────
  const cleared            = transactions.filter((t: any) => t.cleared);
  const outstanding        = transactions.filter((t: any) => !t.cleared);
  const clearedPayments    = cleared.filter((t: any) => (Number(t.journal_lines?.credit) || 0) > 0);
  const clearedDeposits    = cleared.filter((t: any) => (Number(t.journal_lines?.debit)  || 0) > 0);
  const outstandingPayments = outstanding.filter((t: any) => (Number(t.journal_lines?.credit) || 0) > 0);
  const outstandingDeposits = outstanding.filter((t: any) => (Number(t.journal_lines?.debit)  || 0) > 0);

  const outstandingPaymentsTotal = outstandingPayments.reduce((s, t) => s + (Number(t.journal_lines?.credit) || 0), 0);
  const outstandingDepositsTotal = outstandingDeposits.reduce((s, t) => s + (Number(t.journal_lines?.debit)  || 0), 0);

  // ── New summary-view computations ────────────────────────────────────────
  const totalUncleared     = outstandingDepositsTotal - outstandingPaymentsTotal;
  const registerBalance    = summary.clearedBalance + totalUncleared;

  const statementEndDate   = recon.statement_ending_date as string | undefined;
  const endDateObj         = statementEndDate ? new Date(statementEndDate) : null;

  const newPayments = transactions.filter(
    (t) => endDateObj &&
           new Date((t.journal_lines?.journal_entries?.entry_date) ?? 0) > endDateObj &&
           (Number(t.journal_lines?.credit) || 0) > 0
  );
  const newDeposits = transactions.filter(
    (t) => endDateObj &&
           new Date((t.journal_lines?.journal_entries?.entry_date) ?? 0) > endDateObj &&
           (Number(t.journal_lines?.debit) || 0) > 0
  );
  const newPaymentsTotal      = newPayments.reduce((s, t) => s + (Number(t.journal_lines?.credit) || 0), 0);
  const newDepositsTotal      = newDeposits.reduce((s, t) => s + (Number(t.journal_lines?.debit)  || 0), 0);
  const totalNewTransactions  = newDepositsTotal - newPaymentsTotal;
  const endingBalance         = registerBalance + totalNewTransactions;

  const companyName  = (recon as any).accounts?.tenants?.company_name ?? (recon as any).tenants?.company_name ?? "";
  const accountName  = (recon as any).accounts?.account_name ?? "";
  const formattedEnd = statementEndDate ? toMMDDYYYY(statementEndDate) : "—";
  const isDiffZero   = Math.abs(summary.difference) < 0.005;

  // ── Print ────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const content = activeTab === "summary" ? summaryRef.current : detailRef.current;
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;

    const summaryCSS = `
      body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; color: #1a1a1a; }
      .qb-header { text-align: center; margin-bottom: 20px; }
      .qb-header h1 { font-size: 14px; font-weight: 700; margin: 2px 0; }
      .qb-header h2 { font-size: 12px; font-weight: 400; margin: 2px 0; }
      .qb-header p  { font-size: 11px; color: #666; margin: 2px 0; }
      .qb-body { max-width: 480px; margin: 0 auto; }
      .qb-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
      .qb-row.sub { padding-left: 16px; font-size: 11px; color: #555; }
      .qb-row.group-label { font-weight: 700; margin-top: 4px; }
      .qb-row.total { font-weight: 700; border-top: 1px solid #bbb; padding-top: 3px; margin-top: 2px; }
      .qb-row.ending { font-weight: 900; font-size: 14px; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
      .qb-row.diff-zero { color: #006600; font-weight: 700; border-top: 1px solid #bbb; padding-top: 3px; margin-top: 2px; }
      .qb-row.diff-nonzero { color: #cc0000; font-weight: 700; border-top: 1px solid #bbb; padding-top: 3px; margin-top: 2px; }
      .qb-sep { border: none; border-top: 1px solid #ccc; margin: 6px 0; }
      .red { color: #cc0000; } .green { color: #006600; }
    `;
    const detailCSS = `
      body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; color: #1a1a1a; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #e5e5e5; }
      th { font-weight: 600; background: #f5f5f5; }
      .text-right { text-align: right; }
      .section-title { font-weight: 700; margin: 12px 0 4px; font-size: 13px; }
      .total-row { font-weight: 700; border-top: 2px solid #333; }
      h1 { font-size: 16px; margin: 0; } h2 { font-size: 14px; margin: 0; color: #666; }
      .header { text-align: center; margin-bottom: 16px; }
      .diff-zero { color: green; } .diff-nonzero { color: red; }
    `;

    win.document.write(`<html><head><title>Reconciliation Report</title>
      <style>${activeTab === "summary" ? summaryCSS : detailCSS}</style></head>
      <body>${content.innerHTML}</body></html>`);
    win.document.close();
    win.print();
  };

  // ── Row renderer (unchanged) ─────────────────────────────────────────────
  const renderTxnRows = (txns: any[]) =>
    txns.map((t: any) => {
      const jl = t.journal_lines;
      const je = jl?.journal_entries;
      const debit  = Number(jl?.debit)  || 0;
      const credit = Number(jl?.credit) || 0;
      const amount = debit > 0 ? debit : -credit;
      return (
        <TableRow key={t.id}>
          <TableCell className="text-xs">{getTransactionType(je, jl)}</TableCell>
          <TableCell className="text-xs">{formatDate(je?.entry_date)}</TableCell>
          <TableCell className="text-xs font-mono">{je?.reference || "—"}</TableCell>
          <TableCell className="text-xs">{je?.description}</TableCell>
          <TableCell className="text-xs text-center">{t.cleared ? "✓" : ""}</TableCell>
          <TableCell className="text-xs text-right">{formatCurrency(amount)}</TableCell>
        </TableRow>
      );
    });

  // ── Summary body (QB format) ─────────────────────────────────────────────
  const SummaryBody = (
    <div ref={summaryRef}>
      {/* Header */}
      <div className="qb-header text-center mb-6">
        {companyName && <h1 className="text-base font-bold">{companyName}</h1>}
        <h2 className="text-sm font-semibold">Reconciliation Summary</h2>
        <p className="text-xs text-muted-foreground">{accountName}, Period Ending {formattedEnd}</p>
        <p className="text-xs text-muted-foreground">Printed: {printedAt()}</p>
      </div>

      {/* Two-column body */}
      <div className="qb-body max-w-lg mx-auto space-y-0.5">

        {/* Beginning Balance */}
        <div className="flex justify-between text-sm">
          <span>Beginning Balance</span>
          <span className="font-mono font-medium">{formatCurrency(Number(recon.beginning_balance))}</span>
        </div>

        {/* Cleared Transactions */}
        <Separator className="my-1.5" />
        <div className="flex justify-between text-sm font-semibold">
          <span>Cleared Transactions</span>
          <span />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground pl-4">
          <span>Checks and Payments - {summary.paymentsCount} items</span>
          <span className="font-mono">{fmtNeg(summary.paymentsCleared)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground pl-4">
          <span>Deposits and Credits - {summary.depositsCount} items</span>
          <span className="font-mono">{fmtPos(summary.depositsCleared)}</span>
        </div>
        <div className={`flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1 ${summary.totalCleared < 0 ? "text-red-600" : ""}`}>
          <span>Total Cleared Transactions</span>
          <span className="font-mono">{fmtSigned(summary.totalCleared)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold">
          <span>Cleared Balance</span>
          <span className="font-mono">{formatCurrency(summary.clearedBalance)}</span>
        </div>

        {/* Uncleared Transactions */}
        <Separator className="my-1.5" />
        <div className="flex justify-between text-sm font-semibold">
          <span>Uncleared Transactions</span>
          <span />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground pl-4">
          <span>Checks and Payments - {outstandingPayments.length} items</span>
          <span className="font-mono">{fmtNeg(outstandingPaymentsTotal)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground pl-4">
          <span>Deposits and Credits - {outstandingDeposits.length} items</span>
          <span className="font-mono">{fmtPos(outstandingDepositsTotal)}</span>
        </div>
        <div className={`flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1 ${totalUncleared < 0 ? "text-red-600" : ""}`}>
          <span>Total Uncleared Transactions</span>
          <span className="font-mono">{fmtSigned(totalUncleared)}</span>
        </div>

        {/* Register Balance */}
        <Separator className="my-1.5" />
        <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1">
          <span>Register Balance as of {formattedEnd}</span>
          <span className="font-mono">{formatCurrency(registerBalance)}</span>
        </div>

        {/* New Transactions */}
        <Separator className="my-1.5" />
        <div className="flex justify-between text-sm font-semibold">
          <span>New Transactions</span>
          <span />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground pl-4">
          <span>Checks and Payments - {newPayments.length} items</span>
          <span className="font-mono">{fmtNeg(newPaymentsTotal)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground pl-4">
          <span>Deposits and Credits - {newDeposits.length} items</span>
          <span className="font-mono">{fmtPos(newDepositsTotal)}</span>
        </div>
        <div className={`flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1 ${totalNewTransactions < 0 ? "text-red-600" : ""}`}>
          <span>Total New Transactions</span>
          <span className="font-mono">{fmtSigned(totalNewTransactions)}</span>
        </div>

        {/* Ending Balance */}
        <Separator className="my-1.5" />
        <div className="flex justify-between font-bold text-base border-t-2 border-foreground pt-2 mt-1">
          <span>Ending Balance</span>
          <span className="font-mono">{formatCurrency(endingBalance)}</span>
        </div>

        {/* Difference */}
        <Separator className="my-1.5" />
        <div className={`flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1 ${isDiffZero ? "text-green-600" : "text-red-600"}`}>
          <span>Difference</span>
          <span className="font-mono">{formatCurrency(summary.difference)}</span>
        </div>
      </div>
    </div>
  );

  // ── Detail body (existing layout) ────────────────────────────────────────
  const DetailBody = (
    <div ref={detailRef}>
      {/* Report Header */}
      <div className="text-center mb-6">
        {companyName && <p className="text-sm font-bold">{companyName}</p>}
        <h1 className="text-lg font-bold">Reconciliation Report</h1>
        <h2 className="text-sm text-muted-foreground">{accountName}</h2>
        <p className="text-xs text-muted-foreground">Statement Ending Date: {formatDate(recon.statement_ending_date)}</p>
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
        <div className={`flex justify-between font-bold ${isDiffZero ? "text-green-700" : "text-red-700"}`}>
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
        <span>Reconciled: {recon.reconciled_at ? formatDate(recon.reconciled_at) : "—"}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back to Workspace</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="w-3 h-3 mr-1" /> Print Report</Button>
      </div>

      <Card>
        <CardContent className="p-6">
          <Tabs defaultValue="summary" onValueChange={(v) => setActiveTab(v as "summary" | "detail")}>
            <TabsList className="mb-6">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="detail">Detail</TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              {SummaryBody}
            </TabsContent>

            <TabsContent value="detail">
              {DetailBody}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
