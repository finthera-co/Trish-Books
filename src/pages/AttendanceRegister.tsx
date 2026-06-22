import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarCheck, CalendarDays, Download, Lock, Plus, Trash2, Users, AlertTriangle, CheckCircle, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useEmployees } from "@/hooks/useData";
import { useMyPermissions } from "@/hooks/usePermissions";
import {
  useAttendanceRecords, useUpsertAttendance, useDeleteAttendance, useBulkMarkAttendance,
  useHolidays, useCreateHoliday, useDeleteHoliday,
  useLockedPayrollPeriods, isDateLocked,
  type AttendanceStatus, type AttendanceRecord,
} from "@/hooks/useAttendance";
import { exportToCsv } from "@/lib/csvExport";
import { KpiCard } from "@/components/ui/KpiCard";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "half_day", label: "Half Day" },
  { value: "paid_leave", label: "Paid Leave" },
  { value: "unpaid_leave", label: "Unpaid Leave" },
];

const STATUS_CHIP: Record<AttendanceStatus, { label: string; className: string }> = {
  present: { label: "P", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  absent: { label: "A", className: "bg-destructive/10 text-destructive" },
  half_day: { label: "½", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  paid_leave: { label: "PL", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  unpaid_leave: { label: "UL", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  holiday: { label: "H", className: "bg-muted text-muted-foreground" },
  weekend: { label: "W", className: "bg-muted text-muted-foreground" },
};

function currentMonth() {
  return format(new Date(), "yyyy-MM");
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function isWeekend(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`).getDay();
  return d === 0 || d === 6;
}

// ─── Cell editor popover ──────────────────────────────────────────────────────

function CellEditor({ employeeId, employeeName, date, record, canEdit, locked }: {
  employeeId: string;
  employeeName: string;
  date: string;
  record?: AttendanceRecord;
  canEdit: boolean;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AttendanceStatus>(record?.status || "present");
  const [checkIn, setCheckIn] = useState(record?.check_in_time || "");
  const [checkOut, setCheckOut] = useState(record?.check_out_time || "");
  const [otHours, setOtHours] = useState(String(record?.overtime_hours || 0));
  const upsert = useUpsertAttendance();
  const remove = useDeleteAttendance();

  const chip = record ? STATUS_CHIP[record.status] : null;
  const fromLeave = !!record?.leave_request_id;
  const fromField = record?.entry_source === "field";

  const cellContent = (
    <div
      className={`relative w-7 h-7 mx-auto flex items-center justify-center rounded text-[11px] font-medium ${
        chip ? chip.className : "bg-transparent text-muted-foreground/40 border border-dashed border-border"
      } ${canEdit && !locked ? "cursor-pointer hover:ring-1 hover:ring-primary" : "cursor-default"}`}
      title={locked ? "Locked by a finalized payroll run" : fromField ? "Field visit (remote check-in)" : fromLeave ? "Set by approved leave request" : undefined}
    >
      {locked && !chip ? <Lock className="w-3 h-3" /> : chip ? chip.label : "·"}
      {locked && chip ? <Lock className="w-2.5 h-2.5 ml-0.5 opacity-60" /> : null}
      {fromField && <MapPin className="absolute -top-1 -right-1 w-2.5 h-2.5 text-teal-600 dark:text-teal-400" />}
    </div>
  );

  if (!canEdit || locked) return cellContent;

  return (
    <Popover open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) {
        setStatus(record?.status || "present");
        setCheckIn(record?.check_in_time || "");
        setCheckOut(record?.check_out_time || "");
        setOtHours(String(record?.overtime_hours || 0));
      }
    }}>
      <PopoverTrigger asChild>{cellContent}</PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="center">
        <p className="text-sm font-semibold text-foreground">{employeeName}</p>
        <p className="text-xs text-muted-foreground -mt-2">{date}</p>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as AttendanceStatus)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Check-in</Label>
            <Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Check-out</Label>
            <Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>
        <div>
          <Label className="text-xs">OT Hours</Label>
          <Input type="number" min="0" step="0.5" value={otHours} onChange={(e) => setOtHours(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="flex gap-2">
          {record && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              title={fromLeave ? "Clears the attendance mark (does not cancel the leave request)" : "Remove this attendance entry"}
              onClick={() => {
                remove.mutate(
                  { id: record.id, employee_id: employeeId, attendance_date: date },
                  { onSuccess: () => setOpen(false) },
                );
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1"
            disabled={upsert.isPending}
            onClick={() => {
              upsert.mutate({
                employee_id: employeeId,
                attendance_date: date,
                status,
                check_in_time: checkIn || null,
                check_out_time: checkOut || null,
                overtime_hours: Number(otHours) || 0,
              }, { onSuccess: () => setOpen(false) });
            }}
          >
            {upsert.isPending ? "Saving..." : record ? "Update" : "Save"}
          </Button>
        </div>
        {record && (
          <p className="text-[11px] text-muted-foreground">
            Clearing removes the mark so the day is unmarked again — you can re-add it any time.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Holidays manager dialog ──────────────────────────────────────────────────

function HolidaysDialog({ open, onOpenChange, canEdit }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canEdit: boolean;
}) {
  const { data: holidays } = useHolidays();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [recurring, setRecurring] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="w-5 h-5" /> Holidays</DialogTitle>
        </DialogHeader>

        {canEdit && (
          <div className="space-y-3 border border-border rounded-lg p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vesak Poya" className="h-8 text-sm" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} />
              Recurring every year
            </label>
            <Button
              size="sm"
              disabled={!date || !name || createHoliday.isPending}
              onClick={() => createHoliday.mutate(
                { holiday_date: date, name, is_recurring: recurring },
                { onSuccess: () => { setDate(""); setName(""); setRecurring(false); } }
              )}
            >
              <Plus className="w-4 h-4" /> Add Holiday
            </Button>
          </div>
        )}

        <div className="max-h-64 overflow-y-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Recurring</th>
                {canEdit && <th className="px-3 py-2 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {!holidays?.length ? (
                <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No holidays defined</td></tr>
              ) : holidays.map((h: any) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground">{h.holiday_date}</td>
                  <td className="px-3 py-2 text-foreground">{h.name}</td>
                  <td className="px-3 py-2">{h.is_recurring ? <Badge variant="outline" className="text-xs">Yearly</Badge> : "—"}</td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <Button variant="ghost" size="sm" onClick={() => deleteHoliday.mutate(h.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Daily bulk entry tab ─────────────────────────────────────────────────────

function DailyEntryTab({ activeEmployees, records, lockedPeriods, canEdit }: {
  activeEmployees: any[];
  records?: AttendanceRecord[];
  lockedPeriods?: { period_start: string; period_end: string }[];
  canEdit: boolean;
}) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [entries, setEntries] = useState<Record<string, { status: AttendanceStatus; overtime_hours: number }>>({});
  const bulkMark = useBulkMarkAttendance();

  const locked = isDateLocked(date, lockedPeriods);

  const getEntry = (empId: string) => {
    if (entries[empId]) return entries[empId];
    const existing = records?.find((r) => r.employee_id === empId && r.attendance_date === date);
    return existing
      ? { status: existing.status, overtime_hours: Number(existing.overtime_hours) }
      : { status: "present" as AttendanceStatus, overtime_hours: 0 };
  };

  const setEntry = (empId: string, patch: Partial<{ status: AttendanceStatus; overtime_hours: number }>) => {
    setEntries((prev) => ({ ...prev, [empId]: { ...getEntry(empId), ...patch } }));
  };

  const handleSave = () => {
    bulkMark.mutate({
      date,
      entries: activeEmployees.map((e: any) => ({
        employee_id: e.id,
        status: getEntry(e.id).status,
        overtime_hours: getEntry(e.id).overtime_hours,
      })),
    }, { onSuccess: () => setEntries({}) });
  };

  return (
    <div className="stat-card space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setEntries({}); }} className="h-9 w-44" />
        </div>
        {canEdit && !locked && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const all: Record<string, { status: AttendanceStatus; overtime_hours: number }> = {};
                activeEmployees.forEach((e: any) => { all[e.id] = { status: "present", overtime_hours: getEntry(e.id).overtime_hours }; });
                setEntries(all);
              }}
            >
              <CheckCircle className="w-4 h-4" /> Mark all present
            </Button>
            <Button size="sm" onClick={handleSave} disabled={bulkMark.isPending || isWeekend(date)}>
              {bulkMark.isPending ? "Saving..." : "Save Day"}
            </Button>
          </div>
        )}
      </div>

      {locked && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          <Lock className="w-4 h-4" /> This date is covered by a processed/finalized payroll run — attendance is read-only.
        </div>
      )}
      {isWeekend(date) && !locked && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> Selected date falls on a weekend.
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Department</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-44">Status</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">OT Hours</th>
            </tr>
          </thead>
          <tbody>
            {activeEmployees.map((e: any) => {
              const entry = getEntry(e.id);
              return (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{e.first_name} {e.last_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.department || "—"}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={entry.status}
                      onValueChange={(v) => setEntry(e.id, { status: v as AttendanceStatus })}
                      disabled={!canEdit || locked}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number" min="0" step="0.5"
                      value={entry.overtime_hours || ""}
                      onChange={(ev) => setEntry(e.id, { overtime_hours: Number(ev.target.value) || 0 })}
                      disabled={!canEdit || locked}
                      className="h-8 text-right text-sm"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendanceRegister() {
  const [month, setMonth] = useState(currentMonth());
  const [holidaysOpen, setHolidaysOpen] = useState(false);

  const { data: employees } = useEmployees();
  const { data: records } = useAttendanceRecords(month);
  const { data: holidays } = useHolidays();
  const { data: lockedPeriods } = useLockedPayrollPeriods();
  const { canEdit: canEditModule } = useMyPermissions();
  const canEdit = canEditModule("payroll");

  const activeEmployees = useMemo(
    () => employees?.filter((e: any) => (e.status || "active") === "active") || [],
    [employees]
  );

  const days = useMemo(() => daysInMonth(month), [month]);

  // Map each in-month date to its holiday name (exact date or recurring month-day),
  // so the grid can both mark and label holidays.
  const holidayNameByDate = useMemo(() => {
    const map = new Map<string, string>();
    days.forEach((d) => {
      const hit = holidays?.find((h: any) =>
        h.holiday_date === d ||
        (h.is_recurring && h.holiday_date.slice(5) === d.slice(5))
      );
      if (hit) map.set(d, hit.name);
    });
    return map;
  }, [holidays, days]);
  const holidaySet = useMemo(() => new Set(holidayNameByDate.keys()), [holidayNameByDate]);

  const recordMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    records?.forEach((r) => map.set(`${r.employee_id}|${r.attendance_date}`, r));
    return map;
  }, [records]);

  const today = format(new Date(), "yyyy-MM-dd");

  const stats = useMemo(() => {
    const workingDays = days.filter((d) => !isWeekend(d) && !holidaySet.has(d)).length;
    const presentToday = records?.filter((r) => r.attendance_date === today && (r.status === "present" || r.status === "half_day")).length || 0;
    const onLeaveToday = records?.filter((r) => r.attendance_date === today && (r.status === "paid_leave" || r.status === "unpaid_leave")).length || 0;
    const workdaySet = new Set(days.filter((d) => !isWeekend(d) && !holidaySet.has(d) && d <= today));
    let unmarked = 0;
    activeEmployees.forEach((e: any) => {
      workdaySet.forEach((d) => {
        if (!recordMap.has(`${e.id}|${d}`)) unmarked++;
      });
    });
    return { workingDays, presentToday, onLeaveToday, unmarked };
  }, [days, holidaySet, records, today, activeEmployees, recordMap]);

  const handleExportCsv = () => {
    const headers = ["Employee", "Department", ...days.map((d) => d.slice(8))];
    const rows = activeEmployees.map((e: any) => [
      `${e.first_name} ${e.last_name}`,
      e.department || "",
      ...days.map((d) => {
        if (holidaySet.has(d)) return "H";
        if (isWeekend(d)) return "W";
        const r = recordMap.get(`${e.id}|${d}`);
        return r ? STATUS_CHIP[r.status].label : "";
      }),
    ]);
    exportToCsv(`attendance-${month}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Register</h1>
          <p className="page-description">Manual daily attendance with payroll pro-rata integration</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setHolidaysOpen(true)}>
            <CalendarDays className="w-4 h-4" /> Holidays
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={!activeEmployees.length}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={`Working Days (${month})`} value={stats.workingDays} sublabel="excl. weekends & holidays" icon={CalendarCheck} tone="primary" />
        <KpiCard label="Present Today" value={stats.presentToday} sublabel="incl. half-days" icon={Users} tone="success" />
        <KpiCard label="On Leave Today" value={stats.onLeaveToday} sublabel="paid + no-pay" icon={CalendarDays} tone="info" />
        <KpiCard label="Unmarked Entries" value={stats.unmarked} sublabel="awaiting entry" icon={AlertTriangle} tone={stats.unmarked > 0 ? "rose" : "success"} />
      </div>

      <Tabs defaultValue="grid">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="grid">Monthly Grid</TabsTrigger>
            <TabsTrigger value="daily">Daily Entry</TabsTrigger>
          </TabsList>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
        </div>

        <TabsContent value="grid" className="mt-4">
          <div className="stat-card">
            <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground flex-wrap">
              {Object.entries(STATUS_CHIP).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className={`w-5 h-5 inline-flex items-center justify-center rounded text-[10px] font-medium ${v.className}`}>{v.label}</span>
                  {k.replace("_", " ")}
                </span>
              ))}
            </div>
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="text-sm min-w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 min-w-44">Employee</th>
                    {days.map((d) => (
                      <th key={d} title={holidayNameByDate.get(d) || undefined}
                        className={`px-1 py-2 text-center font-medium text-muted-foreground min-w-8 ${isWeekend(d) || holidaySet.has(d) ? "bg-muted/70" : ""}`}>
                        {Number(d.slice(8))}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!activeEmployees.length ? (
                    <tr><td colSpan={days.length + 1} className="text-center py-8 text-muted-foreground">No active employees</td></tr>
                  ) : activeEmployees.map((e: any) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium text-foreground sticky left-0 bg-background whitespace-nowrap">
                        {e.first_name} {e.last_name}
                      </td>
                      {days.map((d) => {
                        const weekend = isWeekend(d);
                        const holiday = holidaySet.has(d);
                        if (weekend || holiday) {
                          return (
                            <td key={d} title={holidayNameByDate.get(d) || (weekend ? "Weekend" : undefined)} className="px-1 py-1 text-center bg-muted/40">
                              <span className="text-[10px] text-muted-foreground">{holiday ? "H" : ""}</span>
                            </td>
                          );
                        }
                        const rec = recordMap.get(`${e.id}|${d}`);
                        return (
                          <td key={d} className="px-1 py-1 text-center">
                            <CellEditor
                              employeeId={e.id}
                              employeeName={`${e.first_name} ${e.last_name}`}
                              date={d}
                              record={rec}
                              canEdit={canEdit}
                              locked={isDateLocked(d, lockedPeriods)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <DailyEntryTab
            activeEmployees={activeEmployees}
            records={records}
            lockedPeriods={lockedPeriods}
            canEdit={canEdit}
          />
        </TabsContent>
      </Tabs>

      <HolidaysDialog open={holidaysOpen} onOpenChange={setHolidaysOpen} canEdit={canEdit} />
    </div>
  );
}
