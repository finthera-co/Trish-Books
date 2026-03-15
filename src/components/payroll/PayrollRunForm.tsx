import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useEmployees } from "@/hooks/useData";
import { usePaySchedules, useCreatePayrollRun, type PayrollRunInput } from "@/hooks/usePayroll";
import { formatCurrency } from "@/lib/currency";
import { ChevronRight, ChevronLeft, Calculator, Users } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EPF_EMPLOYEE_RATE = 0.08;
const EPF_EMPLOYER_RATE = 0.12;
const ETF_EMPLOYER_RATE = 0.03;

interface EmployeePayItem {
  employee_id: string;
  name: string;
  department: string;
  basic_salary: number;
  overtime_hours: number;
  overtime_pay: number;
  bonuses: number;
  allowances: number;
  other_deductions: number;
  payment_method: string;
  selected: boolean;
}

export default function PayrollRunForm({ open, onOpenChange }: Props) {
  const [step, setStep] = useState(1);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EmployeePayItem[]>([]);

  const { data: employees } = useEmployees();
  const { data: schedules } = usePaySchedules();
  const createRun = useCreatePayrollRun();

  const activeEmployees = useMemo(() =>
    employees?.filter((e: any) => (e.status || "active") === "active") || [],
    [employees]
  );

  const handleNext = () => {
    if (step === 1) {
      // Initialize items from active employees
      const empItems: EmployeePayItem[] = activeEmployees.map((e: any) => ({
        employee_id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        department: e.department || "Unassigned",
        basic_salary: Number(e.salary || e.pay_rate || 0),
        overtime_hours: 0,
        overtime_pay: 0,
        bonuses: 0,
        allowances: 0,
        other_deductions: 0,
        payment_method: e.bank_account_no ? "bank_transfer" : "cash",
        selected: true,
      }));
      setItems(empItems);
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const updateItem = (idx: number, field: keyof EmployeePayItem, value: any) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const selectedItems = items.filter((i) => i.selected);

  const totals = useMemo(() => {
    let gross = 0, epfEmp = 0, epfEr = 0, etfEr = 0, otherDed = 0, net = 0;
    selectedItems.forEach((item) => {
      const g = item.basic_salary + item.overtime_pay + item.bonuses + item.allowances;
      const eEpf = Math.round(item.basic_salary * EPF_EMPLOYEE_RATE * 100) / 100;
      const erEpf = Math.round(item.basic_salary * EPF_EMPLOYER_RATE * 100) / 100;
      const erEtf = Math.round(item.basic_salary * ETF_EMPLOYER_RATE * 100) / 100;
      const n = g - eEpf - item.other_deductions;
      gross += g;
      epfEmp += eEpf;
      epfEr += erEpf;
      etfEr += erEtf;
      otherDed += item.other_deductions;
      net += n;
    });
    return { gross, epfEmp, epfEr, etfEr, otherDed, net };
  }, [selectedItems]);

  const handleSubmit = async () => {
    const input: PayrollRunInput = {
      pay_schedule_id: scheduleId || undefined,
      period_start: periodStart,
      period_end: periodEnd,
      payment_date: paymentDate || undefined,
      notes: notes || undefined,
      employees: selectedItems.map((item) => ({
        employee_id: item.employee_id,
        basic_salary: item.basic_salary,
        overtime_hours: item.overtime_hours,
        overtime_pay: item.overtime_pay,
        bonuses: item.bonuses,
        allowances: item.allowances,
        other_deductions: item.other_deductions,
        payment_method: item.payment_method,
      })),
    };
    await createRun.mutateAsync(input);
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setStep(1);
    setPeriodStart("");
    setPeriodEnd("");
    setPaymentDate("");
    setScheduleId("");
    setNotes("");
    setItems([]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Run Payroll — Step {step} of 3
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`flex-1 h-1.5 rounded-full ${s <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        {/* Step 1: Period & Schedule */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Pay Period & Schedule</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground">Pay Schedule</label>
                <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">No schedule (manual)</option>
                  {schedules?.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.frequency})</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Payment Date</label>
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground">Period Start *</label>
                <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground" required />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Period End *</label>
                <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground" required />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground" />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleNext} disabled={!periodStart || !periodEnd}>
                Select Employees <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Select employees & enter pay details */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Employees & Earnings ({selectedItems.length} selected)
              </h3>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={items.every((i) => i.selected)}
                  onCheckedChange={(checked) => setItems((prev) => prev.map((i) => ({ ...i, selected: !!checked })))}
                />
                Select All
              </label>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8"></th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Basic Salary</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">OT Pay</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Bonuses</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Allowances</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Other Ded.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.employee_id} className={`border-t border-border ${!item.selected ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2">
                        <Checkbox checked={item.selected} onCheckedChange={(c) => updateItem(idx, "selected", !!c)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.department}</div>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.basic_salary || ""} onChange={(e) => updateItem(idx, "basic_salary", Number(e.target.value))}
                          className="w-24 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.overtime_pay || ""} onChange={(e) => updateItem(idx, "overtime_pay", Number(e.target.value))}
                          className="w-20 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.bonuses || ""} onChange={(e) => updateItem(idx, "bonuses", Number(e.target.value))}
                          className="w-20 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.allowances || ""} onChange={(e) => updateItem(idx, "allowances", Number(e.target.value))}
                          className="w-20 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.other_deductions || ""} onChange={(e) => updateItem(idx, "other_deductions", Number(e.target.value))}
                          className="w-20 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={handleNext} disabled={selectedItems.length === 0}>
                Review Payroll <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Confirm */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Review Payroll Summary</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="stat-card">
                <p className="text-xs text-muted-foreground">Pay Period</p>
                <p className="text-sm font-semibold text-foreground">{periodStart} to {periodEnd}</p>
              </div>
              <div className="stat-card">
                <p className="text-xs text-muted-foreground">Employees</p>
                <p className="text-sm font-semibold text-foreground">{selectedItems.length}</p>
              </div>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Gross Pay</span><span className="font-semibold text-foreground">{formatCurrency(totals.gross)}</span></div>
              <div className="border-t border-border pt-2 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Employee Deductions</p>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">EPF (Employee 8%)</span><span className="text-destructive">-{formatCurrency(totals.epfEmp)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Other Deductions</span><span className="text-destructive">-{formatCurrency(totals.otherDed)}</span></div>
              </div>
              <div className="border-t border-border pt-2">
                <div className="flex justify-between text-sm font-bold"><span className="text-foreground">Total Net Pay</span><span className="text-primary">{formatCurrency(totals.net)}</span></div>
              </div>
              <div className="border-t border-border pt-2 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Employer Contributions</p>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">EPF (Employer 12%)</span><span className="text-foreground">{formatCurrency(totals.epfEr)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">ETF (Employer 3%)</span><span className="text-foreground">{formatCurrency(totals.etfEr)}</span></div>
              </div>
              <div className="border-t border-border pt-2">
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-foreground">Total Cost to Company</span>
                  <span className="text-foreground">{formatCurrency(totals.gross + totals.epfEr + totals.etfEr)}</span>
                </div>
              </div>
            </div>

            {/* Per-employee breakdown */}
            <details className="border border-border rounded-lg">
              <summary className="px-4 py-2 text-sm font-medium text-foreground cursor-pointer">Employee Breakdown</summary>
              <div className="border-t border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-muted-foreground">Employee</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">Gross</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">EPF 8%</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">Other Ded.</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((item) => {
                      const gross = item.basic_salary + item.overtime_pay + item.bonuses + item.allowances;
                      const epf = Math.round(item.basic_salary * EPF_EMPLOYEE_RATE * 100) / 100;
                      const net = gross - epf - item.other_deductions;
                      return (
                        <tr key={item.employee_id} className="border-t border-border">
                          <td className="px-3 py-1.5 text-foreground">{item.name}</td>
                          <td className="px-3 py-1.5 text-right">{formatCurrency(gross)}</td>
                          <td className="px-3 py-1.5 text-right text-destructive">-{formatCurrency(epf)}</td>
                          <td className="px-3 py-1.5 text-right text-destructive">-{formatCurrency(item.other_deductions)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-primary">{formatCurrency(net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={handleSubmit} disabled={createRun.isPending}>
                {createRun.isPending ? "Creating..." : "Create Payroll Run"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
