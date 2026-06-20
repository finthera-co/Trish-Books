import { useMemo, useState } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAttendanceRecords, type AttendanceStatus } from "@/hooks/useAttendance";
import { Button } from "@/components/ui/button";

const GLYPH: Record<AttendanceStatus, { mark: string; label: string; cls: string }> = {
  present:      { mark: "●",  label: "Present",      cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800" },
  absent:       { mark: "A",  label: "Absent",       cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-red-200 dark:ring-red-800" },
  half_day:     { mark: "½",  label: "Half day",     cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-amber-200 dark:ring-amber-800" },
  paid_leave:   { mark: "PL", label: "Paid leave",   cls: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 ring-blue-200 dark:ring-blue-800" },
  unpaid_leave: { mark: "UL", label: "Unpaid leave", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 ring-slate-300 dark:ring-slate-700" },
  holiday:      { mark: "H",  label: "Holiday",      cls: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 ring-rose-200 dark:ring-rose-800" },
  weekend:      { mark: "W",  label: "Weekend",      cls: "bg-muted text-muted-foreground ring-border" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MyAttendance() {
  const [cursor, setCursor] = useState(() => new Date());
  const month = format(cursor, "yyyy-MM");
  const { data: records, isLoading } = useAttendanceRecords(month);

  const byDate = useMemo(() => {
    const m: Record<string, AttendanceStatus> = {};
    (records ?? []).forEach((r: any) => { m[r.attendance_date] = r.status; });
    return m;
  }, [records]);

  const days = useMemo(() => {
    const start = startOfMonth(cursor);
    const all = eachDayOfInterval({ start, end: endOfMonth(cursor) });
    const lead = getDay(start); // 0 = Sunday
    return { lead, all };
  }, [cursor]);

  const statusFor = (d: Date): AttendanceStatus | undefined => {
    const key = format(d, "yyyy-MM-dd");
    if (byDate[key]) return byDate[key];
    if (getDay(d) === 0) return "weekend"; // unmarked Sundays render as weekend
    return undefined;
  };

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Attendance</h1>
          <p className="text-sm text-muted-foreground">Your daily attendance record</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor((c) => subMonths(c, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-semibold w-32 text-center">{format(cursor, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        {Object.entries(GLYPH).map(([k, g]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`w-6 h-6 rounded-md ring-1 flex items-center justify-center font-semibold ${g.cls}`}>{g.mark}</span>
            {g.label}
          </span>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm">
        <div className="grid grid-cols-7 gap-1.5 mb-2">
          {WEEKDAYS.map((w) => <div key={w} className="text-center text-xs font-medium text-muted-foreground py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: days.lead }).map((_, i) => <div key={`lead-${i}`} />)}
          {days.all.map((d) => {
            const st = statusFor(d);
            const g = st ? GLYPH[st] : undefined;
            return (
              <div
                key={d.toISOString()}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center text-sm ring-1 ${g ? g.cls : "bg-background ring-border text-foreground"}`}
                title={g?.label}
              >
                <span className="text-[11px] text-muted-foreground leading-none mb-0.5">{format(d, "d")}</span>
                {g && <span className="font-semibold leading-none">{g.mark}</span>}
              </div>
            );
          })}
        </div>
        {isLoading && <p className="text-center text-sm text-muted-foreground py-4">Loading…</p>}
      </div>
    </div>
  );
}
