import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { CalendarCheck, Wallet, Percent, FileText, CalendarDays, CalendarPlus, History, Eye, MapPin, LogOut, PartyPopper } from "lucide-react";
import { useMyEmployee, useMyPayslips } from "@/hooks/useMyEmployee";
import { useLeaveBalances, useLeaveRequests, useLeaveTypes } from "@/hooks/useLeave";
import { useAttendanceRecords, useHolidays } from "@/hooks/useAttendance";
import { useMyOpenVisit } from "@/hooks/useFieldVisits";
import { KpiCard } from "@/components/ui/KpiCard";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PayStub from "@/components/payroll/PayStub";

// Statuses that count as a scheduled working day (weekends & holidays excluded).
const WORKING_STATUSES = ["present", "absent", "half_day", "paid_leave", "unpaid_leave"];

const STATUS_LABEL: Record<string, string> = {
  present: "Present", absent: "Absent", half_day: "Half day",
  paid_leave: "On paid leave", unpaid_leave: "On unpaid leave",
  holiday: "Holiday", weekend: "Weekend",
};

function fmtDuration(fromIso: string, toMs: number) {
  const secs = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h > 0 ? `${h}h ` : ""}${m}m ${String(s).padStart(2, "0")}s`;
}

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const { data: me } = useMyEmployee();
  const { data: balances } = useLeaveBalances();
  const { data: types } = useLeaveTypes();
  const { data: requests } = useLeaveRequests();
  const { data: payslips, isLoading: payslipsLoading } = useMyPayslips(me?.id);
  const month = format(new Date(), "yyyy-MM");
  const { data: attendance } = useAttendanceRecords(month);
  const { data: openVisit } = useMyOpenVisit(me?.id);
  const { data: holidays } = useHolidays();

  const [now, setNow] = useState(Date.now());
  const [activeSlip, setActiveSlip] = useState<any>(null);

  // Live ticking clock — only needed while a field visit is open.
  useEffect(() => {
    if (!openVisit) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openVisit]);

  // Every active leave type with its available balance (fall back to the type's
  // default quota when the employee has no balance row yet — created on approval).
  const leaveRows = useMemo(() => {
    // Admins can read the whole tenant's balances — keep only our own rows.
    const own = (balances ?? []).filter((b: any) => !me?.id || b.employee_id === me.id);
    const byType = new Map(own.map((b: any) => [b.leave_type_id, b]));
    return (types ?? [])
      .filter((t: any) => t.is_active !== false)
      .map((t: any) => {
        const b = byType.get(t.id);
        const available = b ? Number(b.available) : Number(t.default_annual_quota ?? 0);
        return { id: t.id, name: t.name, color: t.color, available };
      });
  }, [types, balances, me?.id]);

  const totalAvailable = useMemo(
    () => leaveRows.reduce((s, b) => s + (Number(b.available) || 0), 0),
    [leaveRows],
  );

  const { presentEquiv, workingDays, attendancePct } = useMemo(() => {
    const recs = (attendance ?? []).filter((r: any) => !me?.id || r.employee_id === me.id);
    const present = recs.reduce((s: number, r: any) =>
      s + (r.status === "present" ? 1 : r.status === "half_day" ? 0.5 : 0), 0);
    const working = recs.filter((r: any) => WORKING_STATUSES.includes(r.status)).length;
    return {
      presentEquiv: present,
      workingDays: working,
      attendancePct: working > 0 ? Math.round((present / working) * 100) : null,
    };
  }, [attendance, me?.id]);

  const todayKey = format(new Date(), "yyyy-MM-dd");
  const todayRecord = useMemo(
    () => (attendance ?? []).find((r: any) => r.attendance_date === todayKey && (!me?.id || r.employee_id === me.id)),
    [attendance, todayKey, me?.id],
  );

  const pendingCount = useMemo(
    () => (requests ?? []).filter((r: any) => r.status === "pending" && (!me?.id || r.employee_id === me.id)).length,
    [requests, me?.id],
  );

  // Upcoming holidays within the next 60 days (the lightweight "company feed").
  const upcomingHolidays = useMemo(() => {
    const today = new Date();
    return (holidays ?? [])
      .filter((h: any) => {
        if (!h.holiday_date) return false; // guard: parseISO(null) throws
        const d = differenceInCalendarDays(parseISO(h.holiday_date), today);
        return d >= 0 && d <= 60;
      })
      .sort((a: any, b: any) => (a.holiday_date > b.holiday_date ? 1 : -1))
      .slice(0, 4);
  }, [holidays]);

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

      {/* Today — live field-visit / attendance status */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {openVisit ? (
          <div className="p-5 sm:p-6 bg-emerald-50 dark:bg-emerald-950/30">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> ON A FIELD VISIT
                </span>
                <p className="text-sm text-muted-foreground mt-1">
                  {openVisit.client_name || "Field work"} · since {format(new Date(openVisit.check_in_at), "p")}
                </p>
              </div>
              <span className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                {fmtDuration(openVisit.check_in_at, now)}
              </span>
            </div>
            <Button className="mt-4 w-full sm:w-auto" variant="destructive" onClick={() => navigate("/me/field")}>
              <LogOut className="w-4 h-4" /> Go to check-out
            </Button>
          </div>
        ) : (
          <div className="p-5 sm:p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
              <p className="text-lg font-semibold text-foreground mt-0.5">
                {todayRecord ? STATUS_LABEL[todayRecord.status] ?? todayRecord.status : "Not marked yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {todayRecord?.check_in_time
                  ? `Checked in at ${todayRecord.check_in_time}`
                  : "Check in from a client site to log a field-work day"}
              </p>
            </div>
            <Button onClick={() => navigate("/me/field")} className="shrink-0">
              <MapPin className="w-4 h-4" /> Field Check-in
            </Button>
          </div>
        )}
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

      {/* Upcoming holidays — lightweight company calendar feed */}
      {upcomingHolidays.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <PartyPopper className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-foreground">Upcoming Holidays</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {upcomingHolidays.map((h: any) => {
              const days = differenceInCalendarDays(parseISO(h.holiday_date), new Date());
              return (
                <div key={h.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
                  <div className="w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 flex flex-col items-center justify-center shrink-0 leading-none">
                    <span className="text-[10px] font-medium uppercase">{format(parseISO(h.holiday_date), "MMM")}</span>
                    <span className="text-base font-bold">{format(parseISO(h.holiday_date), "d")}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              {payslipsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : !recent.length ? (
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
                      <Button variant="outline" size="sm" onClick={() => setActiveSlip(it)}>
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

      <PayStub item={activeSlip} run={activeSlip?.payroll_runs} open={!!activeSlip} onOpenChange={(o) => !o && setActiveSlip(null)} />
    </div>
  );
}
