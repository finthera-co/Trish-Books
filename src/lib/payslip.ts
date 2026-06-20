// Shared payslip model so the on-screen pay stub (PayStub.tsx) and the PDF
// (paySlipPdf.ts) always render identical figures from a single source.

const EPF_EMPLOYER_RATE = 0.12;
const ETF_EMPLOYER_RATE = 0.03;

export interface PayslipLine {
  label: string;
  amount: number;
  deduction?: boolean;
}

export interface PayslipModel {
  earnings: PayslipLine[];
  grossPay: number;
  deductions: PayslipLine[];
  totalDeductions: number;
  netPay: number;
  employerEpf: number;
  employerEtf: number;
  workedHoursText?: string;
}

export function buildPayslipModel(item: any): PayslipModel {
  const attendanceDeduction = Number(item.attendance_deduction || 0);
  const earnedBasic = Number(item.basic_salary) - attendanceDeduction;
  const employerEpf = Number(item.employer_epf) || Math.round(earnedBasic * EPF_EMPLOYER_RATE * 100) / 100;
  const employerEtf = Number(item.employer_etf) || Math.round(earnedBasic * ETF_EMPLOYER_RATE * 100) / 100;

  const details = (item.payroll_item_details ?? []) as any[];
  let earnings: PayslipLine[] = [];
  let deductions: PayslipLine[] = [];

  if (details.length) {
    // Granular breakdown when present (future-proofing; table is currently unused).
    earnings = details.filter((d) => d.category === "earning").map((d) => ({ label: d.name, amount: Number(d.amount) }));
    deductions = details.filter((d) => d.category === "deduction").map((d) => ({ label: d.name, amount: Number(d.amount), deduction: true }));
  } else {
    // Fixed-column fallback — the real, populated data path.
    earnings.push({ label: "Basic Salary", amount: Number(item.basic_salary) });
    if (attendanceDeduction > 0) {
      const days = Number(item.unpaid_absent_days) || 0;
      earnings.push({
        label: `Less: No-Pay Deduction${days > 0 ? ` (${days} day${days === 1 ? "" : "s"})` : ""}`,
        amount: attendanceDeduction,
        deduction: true,
      });
    }
    if (Number(item.overtime_pay) > 0) earnings.push({ label: "Overtime", amount: Number(item.overtime_pay) });
    if (Number(item.bonuses) > 0) earnings.push({ label: "Bonuses", amount: Number(item.bonuses) });
    if (Number(item.allowances) > 0) earnings.push({ label: "Allowances", amount: Number(item.allowances) });

    deductions.push({ label: "EPF (Employee 8%)", amount: Number(item.employee_epf), deduction: true });
    if (Number(item.employee_paye) > 0) deductions.push({ label: "PAYE / APIT Tax", amount: Number(item.employee_paye), deduction: true });
    if (Number(item.other_deductions) > 0) deductions.push({ label: "Other Deductions", amount: Number(item.other_deductions), deduction: true });
  }

  const totalDeductions = deductions.reduce((s, d) => s + Number(d.amount || 0), 0);
  const workedHoursText = Number(item.hours_worked) > 0
    ? `${Number(item.hours_worked)} h${Number(item.overtime_hours) > 0 ? ` (incl. ${Number(item.overtime_hours)} OT)` : ""}`
    : undefined;

  return {
    earnings,
    grossPay: Number(item.gross_pay),
    deductions,
    totalDeductions,
    netPay: Number(item.net_pay),
    employerEpf,
    employerEtf,
    workedHoursText,
  };
}

/** Mask all but the last 4 digits of a bank account number. */
export function maskAccount(acc?: string | null): string {
  if (!acc) return "N/A";
  const s = String(acc).replace(/\s+/g, "");
  if (s.length <= 4) return s;
  return `•••• ${s.slice(-4)}`;
}

/** Human payslip reference, e.g. "PR-0007 / EMP-0003". */
export function payslipRef(run: any, emp: any): string {
  const parts = [run?.run_number, emp?.employee_number].filter(Boolean);
  return parts.join(" / ") || (run?.run_number ?? "");
}
