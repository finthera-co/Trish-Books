import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useEmployees } from "@/hooks/useData";
import { usePaySchedules, useCreatePayrollRun, type PayrollRunInput } from "@/hooks/usePayroll";
import { useAttendanceSummary, useAttendanceSummaryForPeriod } from "@/hooks/useAttendance";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Calculator, Users, AlertTriangle, CalendarClock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EPF_EMPLOYEE_RATE = 0.08;
const EPF_EMPLOYER_RATE = 0.12;
const ETF_EMPLOYER_RATE = 0.03;

// OT derivation when importing attendance: SL standard overtime = 1.5× the
// normal hourly rate. For monthly staff the hourly equivalent uses a 240h
// month (30 days × 8h). Both are starting points — the OT Pay cell stays
// editable so the preparer can override.
const OT_MULTIPLIER = 1.5;
const MONTHLY_HOURS = 240;

interface EmployeePayItem {
  employee_id: string;
  name: string;
  department: string;
  pay_rate_type: string;       // "monthly" | "hourly"
  pay_rate: number;            // hourly rate (hourly staff)
  basic_salary: number;
  hours_worked: number;
  overtime_hours: number;
  overtime_pay: number;
  bonuses: number;
  allowances: number;
  other_deductions: number;
  payment_method: string;
  selected: boolean;
  // Attendance pro-rata (basic_salary stays the FULL contractual basic;
  // the deduction is carried separately for the audit trail)
  working_days: number;
  days_present: number;
  paid_leave_days: number;
  unpaid_absent_days: number;
  attendance_deduction: number;
  attendance_override: boolean;
  has_attendance: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function computeAttendanceDeduction(basic: number, workingDays: number, unpaidAbsentDays: number) {
  if (workingDays <= 0 || unpaidAbsentDays <= 0) return 0;
  return round2((basic / workingDays) * unpaidAbsentDays);
}

const isHourly = (item: EmployeePayItem) => item.pay_rate_type === "hourly";

// Earned basic feeds gross, EPF and ETF.
//   hourly  → hours worked × hourly rate (absence simply means fewer hours)
//   monthly → full contractual basic minus the pro-rata no-pay deduction
const earnedBasic = (item: EmployeePayItem) =>
  isHourly(item)
    ? round2(item.hours_worked * item.pay_rate)
    : item.basic_salary - item.attendance_deduction;

const normalHourlyRate = (item: EmployeePayItem) =>
  isHourly(item) ? item.pay_rate : (item.basic_salary > 0 ? item.basic_salary / MONTHLY_HOURS : 0);

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
  const { data: attendanceSummary } = useAttendanceSummary(periodStart || undefined, periodEnd || undefined);
  const { data: biometricSummary } = useAttendanceSummaryForPeriod(periodStart || undefined, periodEnd || undefined);
  const createRun = useCreatePayrollRun();

  const activeEmployees = useMemo(() =>
    employees?.filter((e: any) => (e.status || "active") === "active") || [],
    [employees]
  );

  const summaryMap = useMemo(
    () => new Map((attendanceSummary || []).map((s) => [s.employee_id, s])),
    [attendanceSummary]
  );

  const handleNext = () => {
    if (step === 1) {
      // Initialize items from active employees
      const empItems: EmployeePayItem[] = activeEmployees.map((e: any) => ({
        employee_id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        department: e.department || "Unassigned",
        pay_rate_type: e.pay_rate_type || "monthly",
        pay_rate: Number(e.pay_rate || 0),
        basic_salary: Number(e.salary || e.pay_rate || 0),
        hours_worked: 0,
        overtime_hours: 0,
        overtime_pay: 0,
        bonuses: 0,
        allowances: 0,
        other_deductions: 0,
        payment_method: e.bank_account_no ? "bank_transfer" : "cash",
        selected: true,
        working_days: 0,
        days_present: 0,
        paid_leave_days: 0,
        unpaid_absent_days: 0,
        attendance_deduction: 0,
        attendance_override: false,
        has_attendance: false,
      }));
      setItems(empItems);
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  // Merge attendance summary into items once available. A fully-unmarked
  // employee is treated as full attendance (deduction 0) with a warning badge;
  // unmarked days for partially-marked employees count as present (the summary
  // RPC only reports explicit absences/unpaid leave as unpaid_absent_days).
  useEffect(() => {
    if (!attendanceSummary || step < 2) return;
    setItems((prev) => prev.map((item) => {
      const s = summaryMap.get(item.employee_id);
      if (!s) return item;
      const hasAttendance = Number(s.days_present) + Number(s.paid_leave_days) + Number(s.unpaid_absent_days) > 0;
      const merged = {
        ...item,
        working_days: Number(s.working_days),
        days_present: Number(s.days_present),
        paid_leave_days: Number(s.paid_leave_days),
        unpaid_absent_days: Number(s.unpaid_absent_days),
        has_attendance: hasAttendance,
      };
      if (!item.attendance_override) {
        merged.attendance_deduction = hasAttendance
          ? computeAttendanceDeduction(merged.basic_salary, merged.working_days, merged.unpaid_absent_days)
          : 0;
      }
      return merged;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceSummary, step]);

  const updateItem = (idx: number, field: keyof EmployeePayItem, value: any) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, [field]: value };
      // Re-derive the default deduction when basic changes, unless manually overridden
      if (field === "basic_salary" && !next.attendance_override && next.has_attendance) {
        next.attendance_deduction = computeAttendanceDeduction(Number(value) || 0, next.working_days, next.unpaid_absent_days);
      }
      if (field === "attendance_deduction") {
        next.attendance_override = true;
      }
      return next;
    }));
  };

  // Phase 9: pull aggregated biometric attendance (attendance_daily) into the
  // run. Hourly staff are paid on worked hours; monthly staff keep their basic
  // with OT and unpaid absence flowing through the existing pro-rata logic.
  // Rows with no attendance data are left untouched (and keep their warning badge).
  const importAttendance = () => {
    if (!biometricSummary || Object.keys(biometricSummary).length === 0) {
      toast.error("No aggregated attendance found for this period. Import & aggregate punches first.");
      return;
    }
    let applied = 0;
    setItems((prev) => prev.map((item) => {
      const s = biometricSummary[item.employee_id];
      if (!s) return item; // untouched → stays badged "no attendance data"
      applied += 1;
      const next: EmployeePayItem = {
        ...item,
        hours_worked: round2(s.worked),
        overtime_hours: round2(s.ot),
        has_attendance: true,
      };
      // Derive OT pay from imported OT hours (overridable). Both pay types.
      if (!item.attendance_override || isHourly(item)) {
        next.overtime_pay = round2(s.ot * normalHourlyRate(next) * OT_MULTIPLIER);
      }
      if (isHourly(item)) {
        // Hourly: absence = fewer hours; no pro-rata basic deduction.
        next.working_days = round2(s.present + s.absent);
        next.days_present = s.present;
        next.unpaid_absent_days = 0;
        next.attendance_deduction = 0;
      } else {
        // Monthly: absent days drive the no-pay deduction on contractual basic.
        next.working_days = s.present + s.absent;
        next.days_present = s.present;
        next.unpaid_absent_days = s.absent;
        if (!item.attendance_override) {
          next.attendance_deduction = computeAttendanceDeduction(next.basic_salary, next.working_days, next.unpaid_absent_days);
        }
      }
      return next;
    }));
    toast.success(applied > 0 ? `Attendance applied to ${applied} employee(s)` : "No matching employees for this period's attendance");
  };

  const selectedItems = items.filter((i) => i.selected);

  const totals = useMemo(() => {
    let gross = 0, epfEmp = 0, epfEr = 0, etfEr = 0, otherDed = 0, net = 0, attDed = 0;
    selectedItems.forEach((item) => {
      // EPF/ETF and gross are computed on the EARNED basic (post attendance deduction)
      const earned = earnedBasic(item);
      const g = earned + item.overtime_pay + item.bonuses + item.allowances;
      const eEpf = Math.round(earned * EPF_EMPLOYEE_RATE * 100) / 100;
      const erEpf = Math.round(earned * EPF_EMPLOYER_RATE * 100) / 100;
      const erEtf = Math.round(earned * ETF_EMPLOYER_RATE * 100) / 100;
      const n = g - eEpf - item.other_deductions;
      gross += g;
      epfEmp += eEpf;
      epfEr += erEpf;
      etfEr += erEtf;
      otherDed += item.other_deductions;
      attDed += item.attendance_deduction;
      net += n;
    });
    return { gross, epfEmp, epfEr, etfEr, otherDed, net, attDed };
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
        // Hourly: pass earned (hours × rate) as basic with no pro-rata deduction,
        // so the engine's "earned basic" equals worked pay. Monthly: full
        // contractual basic; the engine subtracts attendance_deduction.
        basic_salary: isHourly(item) ? earnedBasic(item) : item.basic_salary,
        hours_worked: item.hours_worked,
        overtime_hours: item.overtime_hours,
        overtime_pay: item.overtime_pay,
        bonuses: item.bonuses,
        allowances: item.allowances,
        other_deductions: item.other_deductions,
        payment_method: item.payment_method,
        working_days: item.working_days,
        days_present: item.days_present,
        paid_leave_days: item.paid_leave_days,
        unpaid_absent_days: item.unpaid_absent_days,
        attendance_deduction: isHourly(item) ? 0 : item.attendance_deduction,
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
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
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
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={importAttendance}>
                  <CalendarClock className="w-4 h-4" /> Import attendance for this period
                </Button>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={items.every((i) => i.selected)}
                    onCheckedChange={(checked) => setItems((prev) => prev.map((i) => ({ ...i, selected: !!checked })))}
                  />
                  Select All
                </label>
              </div>
            </div>

            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8"></th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Basic Salary</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground" title="Hours worked (imported from attendance)">Worked h</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground" title="Overtime hours (imported from attendance)">OT h</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground" title="Days present">Pres.</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground" title="Unpaid absent days">Unpaid Abs.</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Pro-rata no-pay deduction — editable">Att. Ded.</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Earned basic = Basic − Attendance Deduction">Earned Basic</th>
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
                        <div className="font-medium text-foreground whitespace-nowrap">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.department}</div>
                        {!item.has_attendance && (
                          <Badge variant="outline" className="mt-0.5 text-[10px] text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700">
                            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> No attendance data
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.basic_salary || ""} onChange={(e) => updateItem(idx, "basic_salary", Number(e.target.value))}
                          className="w-24 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground">{item.has_attendance ? item.hours_worked : "—"}</td>
                      <td className={`px-2 py-2 text-right ${item.overtime_hours > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>{item.has_attendance ? item.overtime_hours : "—"}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">{item.has_attendance ? item.days_present : "—"}</td>
                      <td className={`px-2 py-2 text-right ${item.unpaid_absent_days > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {item.has_attendance ? item.unpaid_absent_days : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.attendance_deduction || ""} onChange={(e) => updateItem(idx, "attendance_deduction", Number(e.target.value))}
                          title={item.attendance_override ? "Manually overridden" : "Auto: (basic ÷ working days) × unpaid absent days"}
                          className={`w-20 text-right text-sm border rounded px-2 py-1 bg-background text-foreground ${item.attendance_override ? "border-primary" : "border-input"}`} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">{formatCurrency(earnedBasic(item))}</td>
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

            {totals.attDed > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4" />
                Attendance (no-pay) deductions of {formatCurrency(totals.attDed)} applied — gross, EPF and ETF are computed on earned basic.
              </div>
            )}

            <div className="border border-border rounded-lg p-4 space-y-2">
              {totals.attDed > 0 && (
                <>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Contractual Basic + Earnings</span><span className="text-foreground">{formatCurrency(totals.gross + totals.attDed)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Less: No-Pay (Attendance) Deduction</span><span className="text-destructive">-{formatCurrency(totals.attDed)}</span></div>
                </>
              )}
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Gross Pay (earned)</span><span className="font-semibold text-foreground">{formatCurrency(totals.gross)}</span></div>
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
                      <th className="px-3 py-2 text-right text-muted-foreground">No-Pay Ded.</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">Gross (earned)</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">EPF 8%</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">Other Ded.</th>
                      <th className="px-3 py-2 text-right text-muted-foreground">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((item) => {
                      const earned = earnedBasic(item);
                      const gross = earned + item.overtime_pay + item.bonuses + item.allowances;
                      const epf = Math.round(earned * EPF_EMPLOYEE_RATE * 100) / 100;
                      const net = gross - epf - item.other_deductions;
                      return (
                        <tr key={item.employee_id} className="border-t border-border">
                          <td className="px-3 py-1.5 text-foreground">{item.name}</td>
                          <td className="px-3 py-1.5 text-right text-destructive">{item.attendance_deduction > 0 ? `-${formatCurrency(item.attendance_deduction)}` : "—"}</td>
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
