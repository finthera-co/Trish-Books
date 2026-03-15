import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import { Printer } from "lucide-react";

interface Props {
  item: any;
  run: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EPF_EMPLOYER_RATE = 0.12;
const ETF_EMPLOYER_RATE = 0.03;

export default function PayStub({ item, run, open, onOpenChange }: Props) {
  if (!item || !run) return null;

  const employerEpf = Math.round(Number(item.basic_salary) * EPF_EMPLOYER_RATE * 100) / 100;
  const employerEtf = Math.round(Number(item.basic_salary) * ETF_EMPLOYER_RATE * 100) / 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay Stub — {run.run_number}</DialogTitle>
        </DialogHeader>

        <div className="border border-border rounded-lg p-6 space-y-4 print:border-none" id="pay-stub">
          {/* Header */}
          <div className="text-center border-b border-border pb-3">
            <h2 className="text-lg font-bold text-foreground">PAY STUB</h2>
            <p className="text-xs text-muted-foreground">Period: {run.period_start} to {run.period_end}</p>
            {run.payment_date && <p className="text-xs text-muted-foreground">Payment Date: {run.payment_date}</p>}
          </div>

          {/* Employee info */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Employee</p>
              <p className="font-semibold text-foreground">{(item.employees as any)?.first_name} {(item.employees as any)?.last_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Department</p>
              <p className="font-semibold text-foreground">{(item.employees as any)?.department || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">EPF No.</p>
              <p className="font-semibold text-foreground">{(item.employees as any)?.epf_number || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Payment Method</p>
              <p className="font-semibold text-foreground">{item.payment_method === "bank_transfer" ? "Bank Transfer" : "Cash"}</p>
            </div>
          </div>

          {/* Earnings */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Earnings</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-foreground">Basic Salary</span><span>{formatCurrency(Number(item.basic_salary))}</span></div>
              {Number(item.overtime_pay) > 0 && <div className="flex justify-between"><span className="text-foreground">Overtime</span><span>{formatCurrency(Number(item.overtime_pay))}</span></div>}
              {Number(item.bonuses) > 0 && <div className="flex justify-between"><span className="text-foreground">Bonuses</span><span>{formatCurrency(Number(item.bonuses))}</span></div>}
              {Number(item.allowances) > 0 && <div className="flex justify-between"><span className="text-foreground">Allowances</span><span>{formatCurrency(Number(item.allowances))}</span></div>}
              <div className="flex justify-between font-bold border-t border-border pt-1"><span>Gross Pay</span><span>{formatCurrency(Number(item.gross_pay))}</span></div>
            </div>
          </div>

          {/* Deductions */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Deductions</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-foreground">EPF (Employee 8%)</span><span className="text-destructive">-{formatCurrency(Number(item.employee_epf))}</span></div>
              {Number(item.other_deductions) > 0 && <div className="flex justify-between"><span className="text-foreground">Other Deductions</span><span className="text-destructive">-{formatCurrency(Number(item.other_deductions))}</span></div>}
              <div className="flex justify-between font-bold border-t border-border pt-1">
                <span>Total Deductions</span>
                <span className="text-destructive">-{formatCurrency(Number(item.employee_epf) + Number(item.other_deductions))}</span>
              </div>
            </div>
          </div>

          {/* Net Pay */}
          <div className="bg-primary/10 rounded-lg p-3">
            <div className="flex justify-between text-lg font-bold">
              <span className="text-foreground">Net Pay</span>
              <span className="text-primary">{formatCurrency(Number(item.net_pay))}</span>
            </div>
          </div>

          {/* Employer contributions */}
          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            <p className="font-semibold mb-1">Employer Contributions (not deducted from salary)</p>
            <div className="flex justify-between"><span>EPF (12%)</span><span>{formatCurrency(employerEpf)}</span></div>
            <div className="flex justify-between"><span>ETF (3%)</span><span>{formatCurrency(employerEtf)}</span></div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print Pay Stub
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
