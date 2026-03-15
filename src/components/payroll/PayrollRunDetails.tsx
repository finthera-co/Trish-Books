import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePayrollRunItems, useApprovePayrollRun, useProcessPayrollRun, useVoidPayrollRun } from "@/hooks/usePayroll";
import { formatCurrency } from "@/lib/currency";
import { exportToCsv } from "@/lib/csvExport";
import { CheckCircle, XCircle, Printer, FileText, Download } from "lucide-react";

interface Props {
  run: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  processed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  voided: "bg-destructive/10 text-destructive",
};

export default function PayrollRunDetails({ run, open, onOpenChange }: Props) {
  const { data: items, isLoading } = usePayrollRunItems(run?.id);
  const approveRun = useApprovePayrollRun();
  const processRun = useProcessPayrollRun();
  const voidRun = useVoidPayrollRun();

  if (!run) return null;

  const handlePrint = () => window.print();

  const handleExportCsv = () => {
    if (!items?.length) return;
    const headers = [
      "Employee", "Department", "EPF No.", "Basic Salary", "Overtime Pay", "Bonuses",
      "Allowances", "Gross Pay", "Employee EPF (8%)", "Employer EPF (12%)", "Employer ETF (3%)",
      "Other Deductions", "Net Pay", "Payment Method",
    ];
    const rows = items.map((item: any) => [
      `${(item.employees as any)?.first_name || ""} ${(item.employees as any)?.last_name || ""}`.trim(),
      (item.employees as any)?.department || "",
      (item.employees as any)?.epf_number || "",
      Number(item.basic_salary).toFixed(2),
      Number(item.overtime_pay).toFixed(2),
      Number(item.bonuses).toFixed(2),
      Number(item.allowances).toFixed(2),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <FileText className="w-5 h-5" />
            {run.run_number}
            <Badge className={statusColors[run.status]}>{run.status.toUpperCase()}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="stat-card">
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="text-sm font-semibold text-foreground">{run.period_start} — {run.period_end}</p>
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
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">OT</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Bonus</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Allow.</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Gross</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">EPF 8%</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Other</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Net Pay</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Method</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-4 text-muted-foreground">Loading...</td></tr>
              ) : items?.map((item: any) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {(item.employees as any)?.first_name} {(item.employees as any)?.last_name}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{(item.employees as any)?.department || "-"}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(Number(item.basic_salary))}</td>
                  <td className="px-3 py-2 text-right">{Number(item.overtime_pay) > 0 ? formatCurrency(Number(item.overtime_pay)) : "-"}</td>
                  <td className="px-3 py-2 text-right">{Number(item.bonuses) > 0 ? formatCurrency(Number(item.bonuses)) : "-"}</td>
                  <td className="px-3 py-2 text-right">{Number(item.allowances) > 0 ? formatCurrency(Number(item.allowances)) : "-"}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(Number(item.gross_pay))}</td>
                  <td className="px-3 py-2 text-right text-destructive">-{formatCurrency(Number(item.employee_epf))}</td>
                  <td className="px-3 py-2 text-right text-destructive">{Number(item.other_deductions) > 0 ? `-${formatCurrency(Number(item.other_deductions))}` : "-"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-primary">{formatCurrency(Number(item.net_pay))}</td>
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
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4" /> Print
          </Button>
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
            {run.status === "approved" && (
              <Button size="sm" onClick={() => processRun.mutate(run.id)} disabled={processRun.isPending}>
                <CheckCircle className="w-4 h-4" /> Process & Post to GL
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
