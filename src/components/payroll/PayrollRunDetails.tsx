import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePayrollRunItems, useApprovePayrollRun, useProcessPayrollRun, useVoidPayrollRun, usePayrollGLPreview, usePublishPayslips, usePayrollSettings } from "@/hooks/usePayroll";

// Round a cash payee's take-home to the nearest configured denomination.
const cashNet = (item: any, denom: number) => {
  const net = Number(item.net_pay || 0);
  if (denom > 0 && item.payment_method !== "bank_transfer") return Math.round(net / denom) * denom;
  return net;
};
import { formatCurrency } from "@/lib/currency";
import { exportToCsv } from "@/lib/csvExport";
import { CheckCircle, XCircle, Printer, FileText, Download, Eye, AlertTriangle, ExternalLink, Send } from "lucide-react";
import { formatDate } from "@/lib/format";

interface Props {
  run: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  processed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  finalized: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  voided: "bg-destructive/10 text-destructive",
};

function GLPreviewDialog({ runId, open, onOpenChange, onPost, isPosting }: {
  runId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPost: () => void;
  isPosting: boolean;
}) {
  const { data, isLoading, error } = usePayrollGLPreview(open ? runId : undefined);

  const balanced = data ? Math.abs(data.total_debit - data.total_credit) < 0.01 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Journal Entry Preview
          </DialogTitle>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground py-4">Generating preview…</p>}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-4">
            {data.unmapped && data.unmapped.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  Unmapped components: {data.unmapped.map(u => u.component_code).join(", ")}. Go to Payroll GL Mapping.
                </AlertDescription>
              </Alert>
            )}

            {balanced && (
              <Alert className="border-green-200 bg-green-50 dark:border-green-900/30 dark:bg-green-900/10">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-700 dark:text-green-400">
                  Journal is balanced — Debits = Credits = {formatCurrency(data.total_debit)}
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((line, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{line.account_id}</TableCell>
                    <TableCell className="text-right font-mono">{line.debit > 0 ? formatCurrency(line.debit) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{line.credit > 0 ? formatCurrency(line.credit) : "—"}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold bg-muted/30">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(data.total_debit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(data.total_credit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={onPost} disabled={isPosting || !balanced}>
                <CheckCircle className="w-4 h-4" />
                {isPosting ? "Posting…" : "Post to GL"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollRunDetails({ run, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { data: items, isLoading } = usePayrollRunItems(run?.id);
  const { data: payrollSettings } = usePayrollSettings();
  const cashRound = Number(payrollSettings?.cash_round_to) || 0;
  const approveRun = useApprovePayrollRun();
  const processRun = useProcessPayrollRun();
  const voidRun = useVoidPayrollRun();
  const publishPayslips = usePublishPayslips();
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!run) return null;

  const handlePrint = () => window.print();

  const handleExportCsv = () => {
    if (!items?.length) return;
    const headers = [
      "Employee", "Department", "EPF No.", "Basic Salary", "Worked Hours", "OT Hours", "Working Days", "Days Present",
      "Unpaid Absent", "No-Pay Deduction", "Overtime Pay", "Bonuses",
      "Allowances", "Non-EPF Allowances", "BIK (taxable)", "Gross Pay", "Employee EPF (8%)", "Employer EPF (12%)", "Employer ETF (3%)",
      "Other Deductions", "Net Pay", "Payment Method",
    ];
    const rows = items.map((item: any) => [
      `${(item.employees as any)?.first_name || ""} ${(item.employees as any)?.last_name || ""}`.trim(),
      (item.employees as any)?.department || "",
      (item.employees as any)?.epf_number || "",
      Number(item.basic_salary).toFixed(2),
      item.hours_worked != null ? Number(item.hours_worked) : "",
      item.overtime_hours != null ? Number(item.overtime_hours) : "",
      item.working_days != null ? Number(item.working_days) : "",
      item.days_present != null ? Number(item.days_present) : "",
      item.unpaid_absent_days != null ? Number(item.unpaid_absent_days) : "",
      Number(item.attendance_deduction || 0).toFixed(2),
      Number(item.overtime_pay).toFixed(2),
      Number(item.bonuses).toFixed(2),
      Number(item.allowances).toFixed(2),
      Number(item.non_epf_allowances || 0).toFixed(2),
      Number(item.bik_value || 0).toFixed(2),
      Number(item.gross_pay).toFixed(2),
      Number(item.employee_epf).toFixed(2),
      Number(item.employer_epf).toFixed(2),
      Number(item.employer_etf).toFixed(2),
      Number(item.other_deductions).toFixed(2),
      Number(item.net_pay).toFixed(2),
      item.payment_method === "bank_transfer" ? "Bank Transfer" : "Cash",
    ]);
    exportToCsv(`${run.run_number}-details.csv`, headers, rows);
  };

  const handlePost = () => {
    setPreviewOpen(false);
    processRun.mutate(run.id);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <FileText className="w-5 h-5" />
              {run.run_number}
              <Badge className={statusColors[run.status]}>{run.status.toUpperCase()}</Badge>
              {run.payslips_published_at && (
                <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 gap-1">
                  <Send className="w-3 h-3" /> PUBLISHED
                </Badge>
              )}
              {run.journal_entry_id && (
                <Button
                  variant="link"
                  size="sm"
                  className="text-primary h-auto p-0 ml-2"
                  onClick={() => navigate(`/accounting/journals/${run.journal_entry_id}`)}
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  View Journal Entry
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Period</p>
              <p className="text-sm font-semibold text-foreground">{formatDate(run.period_start)} — {formatDate(run.period_end)}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Total Gross</p>
              <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(run.total_gross))}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Total Deductions</p>
              <p className="text-sm font-semibold text-destructive">{formatCurrency(Number(run.total_deductions))}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Total Net Pay</p>
              <p className="text-sm font-semibold text-primary">{formatCurrency(Number(run.total_net))}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Employer EPF (12%)</p>
              <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(run.total_employer_epf))}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Employer ETF (3%)</p>
              <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(run.total_employer_etf))}</p>
            </div>
          </div>

          {/* Employee Details */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Dept</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Basic</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Pro-rata no-pay attendance deduction">No-Pay</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">OT</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Bonus</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Allowances that attract EPF/ETF">Allow.</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Taxable allowances excluded from EPF/ETF">N-EPF Allow.</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Gross</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">EPF 8%</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Salary-advance / loan repayment">Loan</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Other</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Net Pay</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Method</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={14} className="text-center py-4 text-muted-foreground">Loading...</td></tr>
                ) : items?.map((item: any) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {(item.employees as any)?.first_name} {(item.employees as any)?.last_name}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{(item.employees as any)?.department || "-"}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(Number(item.basic_salary))}</td>
                    <td className="px-3 py-2 text-right text-destructive">
                      {Number(item.attendance_deduction) > 0
                        ? <span title={item.unpaid_absent_days != null ? `${Number(item.unpaid_absent_days)} unpaid absent day(s) of ${Number(item.working_days)} working days` : undefined}>
                            -{formatCurrency(Number(item.attendance_deduction))}
                          </span>
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right">{Number(item.overtime_pay) > 0 ? formatCurrency(Number(item.overtime_pay)) : "-"}</td>
                    <td className="px-3 py-2 text-right">{Number(item.bonuses) > 0 ? formatCurrency(Number(item.bonuses)) : "-"}</td>
                    <td className="px-3 py-2 text-right">{Number(item.allowances) > 0 ? formatCurrency(Number(item.allowances)) : "-"}</td>
                    <td className="px-3 py-2 text-right">{Number(item.non_epf_allowances) > 0 ? formatCurrency(Number(item.non_epf_allowances)) : "-"}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(Number(item.gross_pay))}</td>
                    <td className="px-3 py-2 text-right text-destructive">-{formatCurrency(Number(item.employee_epf))}</td>
                    <td className="px-3 py-2 text-right text-destructive">{Number(item.loan_deduction) > 0 ? `-${formatCurrency(Number(item.loan_deduction))}` : "-"}</td>
                    <td className="px-3 py-2 text-right text-destructive">{Number(item.other_deductions) > 0 ? `-${formatCurrency(Number(item.other_deductions))}` : "-"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-primary" title={cashRound > 0 && item.payment_method !== "bank_transfer" ? `Exact: ${formatCurrency(Number(item.net_pay))} (rounded for cash)` : undefined}>{formatCurrency(cashNet(item, cashRound))}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">{item.payment_method === "bank_transfer" ? "Bank" : "Cash"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center pt-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4" /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!items?.length}>
                <Download className="w-4 h-4" /> Export CSV
              </Button>
            </div>
            <div className="flex gap-2">
              {run.status === "draft" && (
                <>
                  <Button variant="destructive" size="sm" onClick={() => voidRun.mutate(run.id)} disabled={voidRun.isPending}>
                    <XCircle className="w-4 h-4" /> Void
                  </Button>
                  <Button size="sm" onClick={() => approveRun.mutate(run.id)} disabled={approveRun.isPending}>
                    <CheckCircle className="w-4 h-4" /> Approve
                  </Button>
                </>
              )}
              {run.status === "approved" && !run.journal_entry_id && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                    <Eye className="w-4 h-4" /> Preview Journal
                  </Button>
                  <Button size="sm" onClick={() => processRun.mutate(run.id)} disabled={processRun.isPending}>
                    <CheckCircle className="w-4 h-4" /> Process & Post to GL
                  </Button>
                </>
              )}
              {["processed", "finalized"].includes(run.status) && !run.payslips_published_at && (
                <Button
                  size="sm"
                  onClick={() => publishPayslips.mutate({ id: run.id, period_start: run.period_start, period_end: run.period_end })}
                  disabled={publishPayslips.isPending}
                >
                  <Send className="w-4 h-4" /> {publishPayslips.isPending ? "Publishing…" : "Publish Payslips"}
                </Button>
              )}
              {run.payslips_published_at && (
                <span className="text-xs text-muted-foreground self-center">
                  Published {formatDate(run.payslips_published_at)}
                </span>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {previewOpen && (
        <GLPreviewDialog
          runId={run.id}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          onPost={handlePost}
          isPosting={processRun.isPending}
        />
      )}
    </>
  );
}
