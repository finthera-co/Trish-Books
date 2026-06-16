import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useEmployees } from "@/hooks/useData";
import { usePaySchedules, useCreatePayrollRun, type PayrollRunInput } from "@/hooks/usePayroll";
import { useAttendanceSummary, useAttendanceSummaryForPeriod, workingDaysInPeriod } from "@/hooks/useAttendance";
import { useApprovedLeaveForPeriod } from "@/hooks/useLeave";
import { computePayFromAttendance } from "@/lib/attendanceMapping";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Calculator, Users, AlertTriangle, CalendarClock, Search } from "lucide-react";

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
  // Attendance pro-rata. After a biometric import, basic_salary holds the
  // EARNED basic (pro-rated / hours-based) and attendance_deduction is 0;
  // the manual-register path keeps full basic + a separate deduction.
  working_days: number;
  days_present: number;
  paid_leave_days: number;
  unpaid_absent_days: number;
  attendance_deduction: number;
  attendance_override: boolean;
  has_attendance: boolean;
  attendance_applied?: boolean; // filled from biometric attendance_daily
  attendance_missing?: boolean; // no aggregated rows for this employee
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function computeAttendanceDeduction(basic: number, workingDays: number, unpaidAbsentDays: number) {
  if (workingDays <= 0 || unpaidAbsentDays <= 0) return 0;
  return round2((basic / workingDays) * unpaidAbsentDays);
}

// Earned basic feeds gross, EPF and ETF. After a biometric import, basic_salary
// already holds the earned figure (hours×rate for hourly, pro-rated for monthly)
// with attendance_deduction = 0; the manual-register path subtracts the deduction.
const earnedBasic = (item: EmployeePayItem) => item.basic_salary - item.attendance_deduction;

export default function PayrollRunForm({ open, onOpenChange }: Props) {
  const [step, setStep] = useState(1);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EmployeePayItem[]>([]);
  const [empSearch, setEmpSearch] = useState("");

  const { data: employees } = useEmployees();
  const { data: schedules } = usePaySchedules();
  const { data: attendanceSummary } = useAttendanceSummary(periodStart || undefined, periodEnd || undefined);
  const { data: biometricSummary, isFetching: loadingAttendance } = useAttendanceSummaryForPeriod(periodStart || undefined, periodEnd || undefined);
  const { data: leaveSummary } = useApprovedLeaveForPeriod(periodStart || undefined, periodEnd || undefined);
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
        attendance_applied: false,
        attendance_missing: false,
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

  // Phase 12: pull aggregated biometric attendance (attendance_daily) into the run.
  // computePayFromAttendance bakes the earned basic into basic_salary (hours×rate for
  // hourly, pro-rated contractual for monthly) so EPF/ETF compute on it; we zero the
  // separate attendance_deduction and mark the row overridden so the manual-register
  // useEffect doesn't double-apply. Rows with no aggregated data are flagged, not zeroed.
  const importAttendance = () => {
    if (!biometricSummary || Object.keys(biometricSummary).length === 0) {
      toast.error("No aggregated attendance found for this period. Import & aggregate punches first.");
      return;
    }
    const workingDays = workingDaysInPeriod(periodStart, periodEnd); // default Mon–Sat
    let applied = 0;
    setItems((prev) => prev.map((item) => {
      const emp = activeEmployees.find((e: any) => e.id === item.employee_id);
      const s = biometricSummary[item.employee_id];
      if (!s) return { ...item, attendance_missing: true, attendance_applied: false };
      applied += 1;
      // Unpaid (no-pay) leave days reduce earned basic just like absences; paid leave does not.
      const unpaidLeave = leaveSummary?.[item.employee_id]?.unpaid_leave_days ?? 0;
      const result = computePayFromAttendance({
        payRateType: item.pay_rate_type,
        contractualBasic: Number(emp?.salary ?? item.basic_salary) || 0,
        hourlyRate: Number(emp?.pay_rate ?? item.pay_rate) || 0,
        workedHours: s.worked_hours,
        otHours: s.ot_hours,
        absentDays: s.absent_days + unpaidLeave,
        halfDays: s.half_days,
        workingDays,
      });
      return {
        ...item,
        basic_salary: result.basic_salary,
        hours_worked: result.hours_worked,
        overtime_hours: result.overtime_hours,
        overtime_pay: result.overtime_pay,
        working_days: workingDays,
        days_present: s.present_days,
        unpaid_absent_days: s.absent_days + unpaidLeave,
        attendance_deduction: 0,
        attendance_override: true,
        has_attendance: true,
        attendance_applied: true,
        attendance_missing: false,
      };
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
        // basic_salary already holds the earned figure after a biometric import
        // (deduction zeroed); the manual-register path keeps full basic + deduction.
        basic_salary: item.basic_salary,
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
        attendance_deduction: item.attendance_deduction,
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
      <DialogContent className={`${step === 2 ? "max-w-[95vw] xl:max-w-7xl" : "max-w-2xl"} max-h-[90vh] overflow-hidden flex flex-col`}>
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
          <div className="space-y-4 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Employees & Earnings ({selectedItems.length} selected)
              </h3>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={importAttendance}
                  disabled={loadingAttendance || !biometricSummary || Object.keys(biometricSummary).length === 0}>
                  <CalendarClock className="w-4 h-4" /> {loadingAttendance ? "Loading attendance…" : "Import attendance for this period"}
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
            <p className="text-xs text-muted-foreground -mt-2">
              {biometricSummary && Object.keys(biometricSummary).length > 0
                ? `${Object.keys(biometricSummary).length} employee(s) have aggregated attendance in ${periodStart} → ${periodEnd}. Salaried basic is pro-rated Mon–Sat; hourly basic = worked hours × rate.`
                : "No aggregated attendance found for this period. Import & aggregate punches first."}
            </p>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search employees by name or department..."
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-input rounded-md bg-background text-foreground"
              />
            </div>

            <div className="border border-border rounded-lg overflow-auto flex-1">
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="bg-muted/50 sticky top-0 z-30">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8 sticky left-0 z-40 bg-muted whitespace-nowrap"></th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-8 z-40 bg-muted whitespace-nowrap">Employee</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Basic Salary</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap" title="Hours worked (imported from attendance)">Worked h</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap" title="Overtime hours (imported from attendance)">OT h</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap" title="Days present">Pres.</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap" title="Unpaid absent days">Unpaid Abs.</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap" title="Pro-rata no-pay deduction — editable">Att. Ded.</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap" title="Earned basic = Basic − Attendance Deduction">Earned Basic</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">OT Pay</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Bonuses</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Allowances</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Other Ded.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const q = empSearch.trim().toLowerCase();
                    if (q && !(`${item.name} ${item.department}`.toLowerCase().includes(q))) return null;
                    return (
                    <tr key={item.employee_id} className={`border-t border-border ${!item.selected ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2 sticky left-0 z-20 bg-background">
                        <Checkbox checked={item.selected} onCheckedChange={(c) => updateItem(idx, "selected", !!c)} />
                      </td>
                      <td className="px-3 py-2 sticky left-8 z-20 bg-background">
                        <div className="font-medium text-foreground whitespace-nowrap">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.department}</div>
                        {item.attendance_applied && <div className="text-[11px] text-green-600">from attendance</div>}
                        {!item.has_attendance && (
                          <Badge variant="outline" className="mt-0.5 text-[10px] text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700">
                            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> No attendance data
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.basic_salary || ""} onChange={(e) => updateItem(idx, "basic_salary", Number(e.target.value))}
                          className="w-32 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
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
                          className={`w-28 text-right text-sm border rounded px-2 py-1 bg-background text-foreground ${item.attendance_override ? "border-primary" : "border-input"}`} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">{formatCurrency(earnedBasic(item))}</td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.overtime_pay || ""} onChange={(e) => updateItem(idx, "overtime_pay", Number(e.target.value))}
                          className="w-28 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.bonuses || ""} onChange={(e) => updateItem(idx, "bonuses", Number(e.target.value))}
                          className="w-28 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.allowances || ""} onChange={(e) => updateItem(idx, "allowances", Number(e.target.value))}
                          className="w-28 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={item.other_deductions || ""} onChange={(e) => updateItem(idx, "other_deductions", Number(e.target.value))}
                          className="w-28 text-right text-sm border border-input rounded px-2 py-1 bg-background text-foreground" />
                      </td>
                    </tr>
                    );
                  })}
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
