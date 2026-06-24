import { useMemo, useState } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, MapPin, StickyNote } from "lucide-react";
import { useAttendanceRecords, type AttendanceStatus } from "@/hooks/useAttendance";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Glyph = { mark: string; label: string; cls: string };

const FIELD_GLYPH: Glyph = {
  mark: "F", label: "Field visit",
  cls: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 ring-teal-200 dark:ring-teal-800",
};

// A field check-in past the admin's morning cutoff is recorded absent — show it
// as absent (red) with a "late" label, not the regular field glyph.
const FIELD_LATE_GLYPH: Glyph = {
  mark: "A", label: "Absent — late field check-in",
  cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-red-200 dark:ring-red-800",
};

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

interface DayRecord { status: AttendanceStatus; entry_source?: string; check_in_time?: string | null; check_out_time?: string | null; overtime_hours?: number; notes?: string | null; }

export default function MyAttendance() {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<{ date: Date; rec?: DayRecord; isField: boolean; glyph?: Glyph } | null>(null);
  const month = format(cursor, "yyyy-MM");
  const { data: records, isLoading } = useAttendanceRecords(month);

  const byDate = useMemo(() => {
    const m: Record<string, DayRecord> = {};
    (records ?? []).forEach((r: any) => {
      m[r.attendance_date] = {
        status: r.status, entry_source: r.entry_source,
        check_in_time: r.check_in_time, check_out_time: r.check_out_time,
        overtime_hours: r.overtime_hours, notes: r.notes,
      };
    });
    return m;
  }, [records]);

  // Month summary counts.
  const stats = useMemo(() => {
    const s = { present: 0, absent: 0, half_day: 0, leave: 0, field: 0 };
    Object.values(byDate).forEach((r) => {
      if (r.entry_source === "field") s.field += 1;
      if (r.status === "present") s.present += 1;
      else if (r.status === "absent") s.absent += 1;
      else if (r.status === "half_day") s.half_day += 1;
      else if (r.status === "paid_leave" || r.status === "unpaid_leave") s.leave += 1;
    });
    return s;
  }, [byDate]);

  const days = useMemo(() => {
    const start = startOfMonth(cursor);
    const all = eachDayOfInterval({ start, end: endOfMonth(cursor) });
    const lead = getDay(start); // 0 = Sunday
    return { lead, all };
  }, [cursor]);

  const glyphFor = (d: Date): Glyph | undefined => {
    const key = format(d, "yyyy-MM-dd");
    const rec = byDate[key];
    if (rec) {
      if (rec.entry_source === "field") return rec.status === "absent" ? FIELD_LATE_GLYPH : FIELD_GLYPH;
      return GLYPH[rec.status];
    }
    if (getDay(d) === 0) return GLYPH.weekend; // unmarked Sundays render as weekend
    return undefined;
  };

  const openDay = (d: Date) => {
    const key = format(d, "yyyy-MM-dd");
    const rec = byDate[key];
    if (!rec) return; // nothing to show for unmarked days
    setSelected({ date: d, rec, isField: rec.entry_source === "field", glyph: glyphFor(d) });
  };

  const STAT_CARDS: { key: keyof typeof stats; label: string; cls: string }[] = [
    { key: "present", label: "Present", cls: "text-emerald-600 dark:text-emerald-400" },
    { key: "half_day", label: "Half days", cls: "text-amber-600 dark:text-amber-400" },
    { key: "leave", label: "Leave", cls: "text-blue-600 dark:text-blue-400" },
    { key: "absent", label: "Absent", cls: "text-red-600 dark:text-red-400" },
    { key: "field", label: "Field", cls: "text-teal-600 dark:text-teal-400" },
  ];

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

      {/* Month summary */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {STAT_CARDS.map((c) => (
          <div key={c.key} className="rounded-2xl border border-border bg-card shadow-sm p-3.5 text-center">
            <p className={`text-2xl font-bold tabular-nums ${c.cls}`}>{isLoading ? "–" : stats[c.key]}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        {[...Object.entries(GLYPH), ["field", FIELD_GLYPH] as const].map(([k, g]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`w-6 h-6 rounded-md ring-1 flex items-center justify-center font-semibold ${g.cls}`}>{g.mark}</span>
            {g.label}
          </span>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm">
        {isLoading ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5 mb-2">
              {WEEKDAYS.map((w) => <div key={w} className="text-center text-xs font-medium text-muted-foreground py-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: days.lead }).map((_, i) => <div key={`lead-${i}`} />)}
              {days.all.map((d) => {
                const g = glyphFor(d);
                const clickable = !!byDate[format(d, "yyyy-MM-dd")];
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => openDay(d)}
                    disabled={!clickable}
                    className={`aspect-square rounded-xl flex flex-col items-center justify-center text-sm ring-1 transition-transform ${g ? g.cls : "bg-background ring-border text-foreground"} ${clickable ? "hover:scale-[1.05] cursor-pointer" : "cursor-default"}`}
                    title={g?.label}
                  >
                    <span className="text-[11px] text-muted-foreground leading-none mb-0.5">{format(d, "d")}</span>
                    {g && <span className="font-semibold leading-none">{g.mark}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Day detail */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-sm">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{format(selected.date, "EEEE, d MMMM yyyy")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-md ring-1 text-xs font-semibold ${selected.glyph?.cls}`}>{selected.glyph?.label}</span>
                  {selected.isField && (
                    <span className="text-xs text-muted-foreground">
                      {selected.rec?.status === "absent"
                        ? "Checked in after the cutoff — counted absent"
                        : "Logged via field check-in"}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div><p className="text-[11px] text-muted-foreground">Check in</p><p className="font-medium">{selected.rec?.check_in_time || "—"}</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div><p className="text-[11px] text-muted-foreground">Check out</p><p className="font-medium">{selected.rec?.check_out_time || "—"}</p></div>
                  </div>
                  {(selected.rec?.overtime_hours ?? 0) > 0 && (
                    <div className="flex items-center gap-2 col-span-2">
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div><p className="text-[11px] text-muted-foreground">Overtime</p><p className="font-medium">{selected.rec?.overtime_hours} hrs</p></div>
                    </div>
                  )}
                </div>
                {selected.rec?.notes && (
                  <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                    <StickyNote className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-foreground">{selected.rec.notes}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
