import { useMemo, useState } from "react";
import { format } from "date-fns";
import { UserCheck, UserX, Plane, HelpCircle, Users, MapPin, CalendarClock, TrendingUp } from "lucide-react";
import { useAttendanceRecords } from "@/hooks/useAttendance";
import { useEmployees } from "@/hooks/useData";
import { useLeaveRequests } from "@/hooks/useLeave";
import { KpiCard } from "@/components/ui/KpiCard";

const today = () => format(new Date(), "yyyy-MM-dd");

export default function WorkforceDashboard() {
  const [date, setDate] = useState(today());
  const month = date.slice(0, 7);

  const { data: records } = useAttendanceRecords(month);
  const { data: employees } = useEmployees();
  const { data: pendingLeave } = useLeaveRequests("pending");

  const activeEmployees = useMemo(
    () => (employees ?? []).filter((e: any) => (e.status || "active") === "active"),
    [employees],
  );

  const day = useMemo(() => {
    const recs = (records ?? []).filter((r: any) => r.attendance_date === date);
    const by = (s: string) => recs.filter((r: any) => r.status === s).length;
    const present = by("present");
    const half = by("half_day");
    const absent = by("absent");
    const onLeave = by("paid_leave") + by("unpaid_leave");
    const field = recs.filter((r: any) => r.entry_source === "field").length;
    const workingStatuses = ["present", "absent", "half_day", "paid_leave", "unpaid_leave"];
    const markedIds = new Set(recs.filter((r: any) => workingStatuses.includes(r.status)).map((r: any) => r.employee_id));
    const presentHeadcount = present + half; // field already has status 'present'
    const total = activeEmployees.length;
    const notMarked = Math.max(0, total - markedIds.size);
    const rate = total > 0 ? Math.round((presentHeadcount / total) * 100) : 0;
    return { present: presentHeadcount, half, absent, onLeave, field, notMarked, total, rate };
  }, [records, date, activeEmployees]);

  // stacked proportion bar segments
  const segments = [
    { label: "Present", value: day.present, color: "hsl(var(--success))" },
    { label: "On Leave", value: day.onLeave, color: "hsl(var(--info))" },
    { label: "Absent", value: day.absent, color: "hsl(347 77% 50%)" },
    { label: "Not Marked", value: day.notMarked, color: "hsl(var(--warning))" },
  ];
  const segTotal = segments.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Workforce Dashboard</h1>
          <p className="page-description">Daily attendance at a glance — who's present, absent or on leave.</p>
        </div>
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value || today())}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
        />
      </div>

      {/* Hero: attendance rate + proportion bar */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-50 to-violet-100 text-foreground px-6 sm:px-8 py-6 shadow-sm border border-border">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{format(new Date(date + "T00:00:00"), "EEEE, d MMMM yyyy")}</p>
            <h2 className="text-3xl font-bold tracking-tight mt-1 text-indigo-700">{day.rate}% present</h2>
            <p className="text-sm text-muted-foreground mt-1">{day.present} of {day.total} active employees</p>
          </div>
          <div className="flex items-center gap-2 text-indigo-700">
            <TrendingUp className="w-5 h-5" />
            <span className="text-sm">{day.field} on field visits</span>
          </div>
        </div>
        <div className="mt-5 h-3 w-full rounded-full overflow-hidden bg-black/10 flex">
          {segments.map((s) => (
            <div key={s.label} style={{ width: `${(s.value / segTotal) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${s.value}`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {segments.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} /> {s.label} ({s.value})
            </span>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Present" value={day.present} sublabel={day.half > 0 ? `incl. ${day.half} half-day` : "for the day"} icon={UserCheck} tone="success" />
        <KpiCard label="Absent" value={day.absent} sublabel="for the day" icon={UserX} tone="rose" />
        <KpiCard label="On Leave" value={day.onLeave} sublabel="paid + no-pay" icon={Plane} tone="info" />
        <KpiCard label="Not Marked" value={day.notMarked} sublabel="awaiting entry" icon={HelpCircle} tone="warning" />
        <KpiCard label="Field Visits" value={day.field} sublabel="remote check-ins" icon={MapPin} tone="violet" />
        <KpiCard label="Total Employees" value={day.total} sublabel="active headcount" icon={Users} tone="primary" />
        <KpiCard label="Attendance Rate" value={`${day.rate}%`} sublabel="present ÷ active" icon={TrendingUp} tone="success" />
        <KpiCard label="Pending Leave" value={(pendingLeave ?? []).length} sublabel="awaiting approval" icon={CalendarClock} tone="warning" />
      </div>
    </div>
  );
}
