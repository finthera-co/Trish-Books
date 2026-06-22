import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Ban } from "lucide-react";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { useLeaveRequests, useCancelLeaveRequest } from "@/hooks/useLeave";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  approved:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  settled:   "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  rejected:  "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
};

export default function LeaveHistory() {
  const navigate = useNavigate();
  const { data: me } = useMyEmployee();
  const { data: requests, isLoading } = useLeaveRequests();
  const cancelReq = useCancelLeaveRequest();

  // RLS already scopes to the employee, but guard in case of stale cache.
  const mine = useMemo(
    () => (requests ?? []).filter((r: any) => !me?.id || r.employee_id === me.id),
    [requests, me?.id],
  );

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave History</h1>
          <p className="text-sm text-muted-foreground">Your leave requests and their status</p>
        </div>
        <Button onClick={() => navigate("/me/leave/apply")}><CalendarPlus className="w-4 h-4" /> Apply</Button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground bg-muted/50">
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Dates</th>
              <th className="px-4 py-3 font-medium">Days</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : !mine.length ? (
              <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No leave requests yet.</td></tr>
            ) : mine.map((r: any) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium text-foreground">{r.leave_types?.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}{r.is_half_day ? " (½)" : ""}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{Number(r.days)}</td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={STATUS_STYLE[r.status] ?? ""}>{r.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {["pending", "approved"].includes(r.status) && (
                    <Button variant="ghost" size="sm" onClick={() => cancelReq.mutate(r.id)} disabled={cancelReq.isPending}>
                      <Ban className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
