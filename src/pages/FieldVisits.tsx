import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { MapPin, ExternalLink, Users, Radio, Clock } from "lucide-react";
import {
  useTenantFieldVisits, mapLink,
  useFieldAttendanceSettings, useSaveFieldAttendanceSettings,
} from "@/hooks/useFieldVisits";
import { KpiCard } from "@/components/ui/KpiCard";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime } from "@/lib/format";

function today() {
  return format(new Date(), "yyyy-MM-dd");
}

function duration(inAt: string, outAt: string | null) {
  if (!outAt) return "—";
  const mins = Math.max(0, Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h > 0 ? `${h}h ` : ""}${m}m`;
}

// Normalise a stored 'HH:MM:SS' time to the 'HH:MM' an <input type="time"> wants.
function toInputTime(t?: string | null) {
  return (t ?? "09:00").slice(0, 5);
}

export default function FieldVisits() {
  const [day, setDay] = useState(today());
  const { data: visits, isLoading } = useTenantFieldVisits(day);

  // Late-cutoff policy (admin).
  const { data: settings } = useFieldAttendanceSettings();
  const saveSettings = useSaveFieldAttendanceSettings();
  const [lateEnabled, setLateEnabled] = useState(false);
  const [cutoff, setCutoff] = useState("09:00");
  useEffect(() => {
    if (!settings) return;
    setLateEnabled(!!settings.late_cutoff_enabled);
    setCutoff(toInputTime(settings.late_cutoff_time));
  }, [settings]);

  const stats = useMemo(() => {
    const list = visits ?? [];
    const employees = new Set(list.map((v) => v.employee_id));
    const open = list.filter((v) => !v.check_out_at).length;
    return { total: list.length, employees: employees.size, open };
  }, [visits]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Field Visits</h1>
          <p className="page-description">Remote client-visit check-ins with captured location.</p>
        </div>
        <DatePicker value={day} onChange={setDay} placeholder="Select date" className="w-48" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Visits" value={stats.total} sublabel="this day" icon={MapPin} tone="violet" />
        <KpiCard label="Employees" value={stats.employees} sublabel="on field visits" icon={Users} tone="info" />
        <KpiCard label="Currently Active" value={stats.open} sublabel="not checked out" icon={Radio} tone="success" />
      </div>

      {/* Morning late-cutoff policy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Morning check-in cutoff</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            When enabled, a field check-in <strong>after</strong> this time is recorded as <strong>absent</strong> for the day (which becomes an unpaid absent day at payroll). On-time check-ins are marked present as usual.
          </p>

          {/* Toggle row */}
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="late-cutoff-toggle" className="text-sm font-medium">Enforce a morning cutoff</Label>
              <p className="text-[11px] text-muted-foreground">
                {settings?.late_cutoff_enabled
                  ? `Active — check-ins after ${toInputTime(settings.late_cutoff_time)} are marked absent.`
                  : "Currently off — every field check-in counts as present."}
              </p>
            </div>
            <Switch id="late-cutoff-toggle" checked={lateEnabled} onCheckedChange={setLateEnabled} />
          </div>

          {/* Cutoff time + save, bottom-aligned */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="late-cutoff-time">Cutoff time</Label>
              <Input
                id="late-cutoff-time"
                type="time"
                value={cutoff}
                disabled={!lateEnabled}
                onChange={(e) => setCutoff(e.target.value)}
                className="w-36"
              />
            </div>
            <Button
              size="sm"
              disabled={saveSettings.isPending || (lateEnabled && !cutoff)}
              onClick={() => saveSettings.mutate({ late_cutoff_enabled: lateEnabled, late_cutoff_time: `${cutoff}:00` })}
            >
              {saveSettings.isPending ? "Saving..." : "Save policy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="stat-card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th><th>Date</th><th>Client / Site</th><th>Check-in</th><th>Check-out</th><th>Duration</th><th className="text-right">Location</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
            ) : !visits?.length ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No field visits on this day.</td></tr>
            ) : visits.map((v) => {
              const inLink = mapLink(v.check_in_lat, v.check_in_lng);
              const outLink = mapLink(v.check_out_lat, v.check_out_lng);
              const emp = v.employees;
              return (
                <tr key={v.id}>
                  <td className="font-medium text-foreground">
                    {emp ? `${emp.first_name} ${emp.last_name}` : "—"}
                    {emp?.employee_number && <span className="text-muted-foreground text-xs ml-1">({emp.employee_number})</span>}
                  </td>
                  <td className="text-muted-foreground">{formatDate(v.visit_date)}</td>
                  <td className="text-muted-foreground">{v.client_name || "—"}</td>
                  <td className="text-muted-foreground">
                    {formatTime(v.check_in_at)}
                    {v.attendance_status === "absent" && (
                      <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">late · absent</span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{v.check_out_at ? formatTime(v.check_out_at) : <span className="text-emerald-600">Active</span>}</td>
                  <td className="text-muted-foreground">{duration(v.check_in_at, v.check_out_at)}</td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      {inLink && <a href={inLink} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5 text-xs" title="Check-in location"><MapPin className="w-3.5 h-3.5" /> in</a>}
                      {outLink && <a href={outLink} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5 text-xs" title="Check-out location"><ExternalLink className="w-3 h-3" /> out</a>}
                      {!inLink && !outLink && "—"}
                    </div>
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
