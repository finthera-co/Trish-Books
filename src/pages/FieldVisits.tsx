import { useMemo, useState } from "react";
import { format } from "date-fns";
import { MapPin, ExternalLink, Users, Radio } from "lucide-react";
import { useTenantFieldVisits, mapLink } from "@/hooks/useFieldVisits";
import { KpiCard } from "@/components/ui/KpiCard";

function currentMonth() {
  return format(new Date(), "yyyy-MM");
}

function duration(inAt: string, outAt: string | null) {
  if (!outAt) return "—";
  const mins = Math.max(0, Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h > 0 ? `${h}h ` : ""}${m}m`;
}

export default function FieldVisits() {
  const [month, setMonth] = useState(currentMonth());
  const { data: visits, isLoading } = useTenantFieldVisits(month);

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
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Visits" value={stats.total} sublabel="this month" icon={MapPin} tone="violet" />
        <KpiCard label="Employees" value={stats.employees} sublabel="on field visits" icon={Users} tone="info" />
        <KpiCard label="Currently Active" value={stats.open} sublabel="not checked out" icon={Radio} tone="success" />
      </div>

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
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No field visits this month.</td></tr>
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
                  <td className="text-muted-foreground">{v.visit_date}</td>
                  <td className="text-muted-foreground">{v.client_name || "—"}</td>
                  <td className="text-muted-foreground">{format(new Date(v.check_in_at), "p")}</td>
                  <td className="text-muted-foreground">{v.check_out_at ? format(new Date(v.check_out_at), "p") : <span className="text-emerald-600">Active</span>}</td>
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
