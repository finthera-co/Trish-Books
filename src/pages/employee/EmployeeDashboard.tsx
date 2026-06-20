import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarCheck, Wallet, Percent, FileText, CalendarDays, CalendarPlus, History, Eye } from "lucide-react";
import { useMyEmployee, useMyPayslips } from "@/hooks/useMyEmployee";
import { useLeaveBalances, useLeaveRequests, useLeaveTypes } from "@/hooks/useLeave";
import { useAttendanceRecords } from "@/hooks/useAttendance";
import { KpiCard } from "@/components/ui/KpiCard";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";

// Statuses that count as a scheduled working day (weekends & holidays excluded).
const WORKING_STATUSES = ["present", "absent", "half_day", "paid_leave", "unpaid_leave"];

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const { data: me } = useMyEmployee();
  const { data: balances } = useLeaveBalances();
  const { data: types } = useLeaveTypes();
  const { data: requests } = useLeaveRequests();
  const { data: payslips } = useMyPayslips(me?.id);
  const month = format(new Date(), "yyyy-MM");
  const { data: attendance } = useAttendanceRecords(month);

  // Every active leave type with its available balance (fall back to the type's
  // default quota when the employee has no balance row yet — created on approval).
  const leaveRows = useMemo(() => {
    const byType = new Map((balances ?? []).map((b: any) => [b.leave_type_id, b]));
    return (types ?? [])
      .filter((t: any) => t.is_active !== false)
      .map((t: any) => {
        const b = byType.get(t.id);
        const available = b ? Number(b.available) : Number(t.default_annual_quota ?? 0);
        return { id: t.id, name: t.name, color: t.color, available };
      });
  }, [types, balances]);

  const totalAvailable = useMemo(
    () => leaveRows.reduce((s, b) => s + (Number(b.available) || 0), 0),
    [leaveRows],
  );

  const { presentEquiv, workingDays, attendancePct } = useMemo(() => {
    const recs = attendance ?? [];
    const present = recs.reduce((s: number, r: any) =>
      s + (r.status === "present" ? 1 : r.status === "half_day" ? 0.5 : 0), 0);
    const working = recs.filter((r: any) => WORKING_STATUSES.includes(r.status)).length;
    return {
      presentEquiv: present,
      workingDays: working,
      attendancePct: working > 0 ? Math.round((present / working) * 100) : null,
    };
  }, [attendance]);

  const pendingCount = useMemo(
    () => (requests ?? []).filter((r: any) => r.status === "pending").length,
    [requests],
  );

  const latest = payslips?.[0];
  const recent = (payslips ?? []).slice(0, 5);

  const greeting = me?.first_name ? `Hi, ${me.first_name}` : "Welcome";

  const links = [
    { label: "My Attendance", desc: "View your monthly calendar", icon: CalendarDays, path: "/me/attendance", tone: "from-emerald-500 to-teal-500" },
    { label: "Salary Slips", desc: "View & download pay stubs", icon: FileText, path: "/me/payslips", tone: "from-blue-500 to-indigo-500" },
    { label: "Apply for Leave", desc: "Submit a new leave request", icon: CalendarPlus, path: "/me/leave/apply", tone: "from-violet-500 to-fuchsia-500" },
    { label: "Leave History", desc: "Track your requests", icon: History, path: "/me/leave", tone: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-5xl mx-auto">
      <div className="rounded-3xl bg-gradient-to-br from-indigo-700 to-indigo-800 text-white px-6 sm:px-8 py-7 shadow-lg">
        <p className="text-sm text-white/80">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">{greeting} 👋</h1>
        <p className="text-sm text-white/85 mt-1">{me?.designation || me?.employee_number || "Your personal workspace"}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Attendance"
          value={attendancePct == null ? "—" : `${attendancePct}%`}
          sublabel={`${presentEquiv} / ${workingDays} working days · ${format(new Date(), "MMMM")}`}
          icon={Percent}
          tone="success"
        />
        <KpiCard
          label="Latest Net Salary"
          value={latest ? formatCurrency(Number(latest.net_pay)) : "—"}
          sublabel={latest ? `${latest.payroll_runs.period_start} → ${latest.payroll_runs.period_end}` : "No payslips yet"}
          icon={Wallet}
          tone="primary"
        />
        <KpiCard label="Pending Requests" value={pendingCount} sublabel="awaiting approval" icon={CalendarCheck} tone="warning" />
      </div>

      {/* Leave available — broken down per type */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Leave Available</h2>
          <span className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{totalAvailable}</span> days across all types</span>
        </div>
        {leaveRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave types configured.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {leaveRows.map((b) => (
              <div key={b.id} className="rounded-xl border border-border/70 bg-muted/30 p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color || "hsl(var(--primary))" }} />
                  <span className="text-xs font-medium text-muted-foreground truncate">{b.name}</span>
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">{b.available}</p>
                <p className="text-[11px] text-muted-foreground">day(s) available</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent salary slips */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Recent Salary Slips</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate("/me/payslips")}>View all</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground bg-muted/50">
                <th className="px-5 py-3 font-medium">Pay Period</th>
                <th className="px-5 py-3 font-medium">Pay Date</th>
                <th className="px-5 py-3 font-medium text-right">Gross</th>
                <th className="px-5 py-3 font-medium text-right">Deductions</th>
                <th className="px-5 py-3 font-medium text-right">Net Pay</th>
                <th className="px-5 py-3 font-medium text-right">Slip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!recent.length ? (
                <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No salary slips yet.</td></tr>
              ) : recent.map((it: any) => {
                const deductions = Number(it.employee_epf || 0) + Number(it.employee_paye || 0) + Number(it.other_deductions || 0);
                return (
                  <tr key={it.id}>
                    <td className="px-5 py-3 font-medium text-foreground">{it.payroll_runs.period_start} → {it.payroll_runs.period_end}</td>
                    <td className="px-5 py-3 text-muted-foreground">{it.payroll_runs.payment_date || "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatCurrency(Number(it.gross_pay))}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-destructive">-{formatCurrency(deductions)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-foreground">{formatCurrency(Number(it.net_pay))}</td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => navigate("/me/payslips")}>
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {links.map((l) => (
            <button
              key={l.path}
              onClick={() => navigate(l.path)}
              className="group text-left rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-4"
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${l.tone} text-white flex items-center justify-center shrink-0`}>
                <l.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
