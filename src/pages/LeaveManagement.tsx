import { useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import {
  CalendarOff, CheckCircle, Plus, XCircle, Ban, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useEmployees } from "@/hooks/useData";
import { useMyPermissions } from "@/hooks/usePermissions";
import {
  useLeaveTypes, useLeaveRequests, useCreateLeaveRequest,
  useApproveLeaveRequest, useRejectLeaveRequest, useCancelLeaveRequest,
  useCreateLeaveType, useUpdateLeaveType,
  type LeaveRequest, type LeaveRequestStatus, type LeaveType,
} from "@/hooks/useLeave";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

/** ANNUAL → leave_balance · CASUAL → vacation_balance · SICK → sick_balance (mirrors approve_leave_request) */
function balanceForType(emp: any, type?: { code: string }) {
  if (!emp || !type) return null;
  if (type.code === "SICK") return Number(emp.sick_balance ?? 0);
  if (type.code === "CASUAL") return Number(emp.vacation_balance ?? 0);
  return Number(emp.leave_balance ?? 0);
}

// ─── New request dialog ───────────────────────────────────────────────────────

function NewRequestDialog({ open, onOpenChange, employees, leaveTypes }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: any[];
  leaveTypes?: LeaveType[];
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const createRequest = useCreateLeaveRequest();

  const selectedType = leaveTypes?.find((t) => t.id === typeId);
  const selectedEmp = employees.find((e: any) => e.id === employeeId);

  const days = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return 0;
    if (halfDay) return 0.5;
    // Count weekdays in range (holidays are excluded at approval time)
    let count = 0;
    const start = new Date(`${startDate}T00:00:00`);
    const span = differenceInCalendarDays(new Date(`${endDate}T00:00:00`), start);
    for (let i = 0; i <= span; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    }
    return count;
  }, [startDate, endDate, halfDay]);

  const remaining = selectedType?.is_paid ? balanceForType(selectedEmp, selectedType) : null;
  const exceeds = remaining !== null && days > remaining;

  const reset = () => {
    setEmployeeId(""); setTypeId(""); setStartDate(""); setEndDate(""); setHalfDay(false); setReason("");
  };

  const handleSubmit = () => {
    createRequest.mutate({
      employee_id: employeeId,
      leave_type_id: typeId,
      start_date: startDate,
      end_date: halfDay ? startDate : endDate,
      days,
      is_half_day: halfDay,
      reason: reason || undefined,
    }, { onSuccess: () => { onOpenChange(false); reset(); } });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarOff className="w-5 h-5" /> New Leave Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Employee *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Leave Type *</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select leave type" /></SelectTrigger>
              <SelectContent>
                {leaveTypes?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} {t.is_paid ? "(Paid)" : "(Unpaid)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {remaining !== null && selectedEmp && (
              <p className={`text-xs mt-1 ${exceeds ? "text-destructive" : "text-muted-foreground"}`}>
                Remaining balance: {remaining} day(s)
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start Date *</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">End Date *</Label>
              <Input
                type="date"
                value={halfDay ? startDate : endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={halfDay}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox checked={halfDay} onCheckedChange={(c) => setHalfDay(!!c)} />
            Half day (0.5)
          </label>

          {days > 0 && (
            <p className="text-sm text-foreground">
              Requested: <span className="font-semibold">{days} day(s)</span> (weekdays only)
            </p>
          )}
          {exceeds && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Exceeds remaining balance — approval will be rejected.
            </p>
          )}

          <div>
            <Label className="text-xs">Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-sm" />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!employeeId || !typeId || !startDate || (!halfDay && !endDate) || days <= 0 || createRequest.isPending}
            >
              {createRequest.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reject dialog ────────────────────────────────────────────────────────────

function RejectDialog({ request, open, onOpenChange }: {
  request: LeaveRequest | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const rejectRequest = useRejectLeaveRequest();

  if (!request) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setReason(""); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /> Reject Leave Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {request.employees?.first_name} {request.employees?.last_name} — {request.leave_types?.name}, {request.start_date} to {request.end_date}
          </p>
          <div>
            <Label className="text-xs">Rejection Reason *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || rejectRequest.isPending}
              onClick={() => rejectRequest.mutate(
                { requestId: request.id, reason: reason.trim() },
                { onSuccess: () => { onOpenChange(false); setReason(""); } }
              )}
            >
              {rejectRequest.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Leave types tab ──────────────────────────────────────────────────────────

function LeaveTypesTab({ leaveTypes, canEdit }: { leaveTypes?: LeaveType[]; canEdit: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isPaid, setIsPaid] = useState(true);
  const [entitlement, setEntitlement] = useState("0");
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const createType = useCreateLeaveType();
  const updateType = useUpdateLeaveType();

  return (
    <div className="stat-card space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" /> Add Leave Type</Button>
        </div>
      )}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Code</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Paid</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Annual Entitlement</th>
              {canEdit && <th className="px-3 py-2 w-16"></th>}
            </tr>
          </thead>
          <tbody>
            {!leaveTypes?.length ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No leave types</td></tr>
            ) : leaveTypes.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-foreground">
                  {editing?.id === t.id ? (
                    <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8 text-sm" />
                  ) : t.name}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.code}</td>
                <td className="px-3 py-2">
                  <Badge className={t.is_paid
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"}>
                    {t.is_paid ? "Paid" : "Unpaid"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  {editing?.id === t.id ? (
                    <Input
                      type="number" min="0"
                      value={editing.annual_entitlement}
                      onChange={(e) => setEditing({ ...editing, annual_entitlement: Number(e.target.value) })}
                      className="h-8 w-20 text-right text-sm ml-auto"
                    />
                  ) : t.annual_entitlement}
                </td>
                {canEdit && (
                  <td className="px-3 py-2 text-right">
                    {editing?.id === t.id ? (
                      <Button
                        size="sm" variant="ghost"
                        disabled={updateType.isPending}
                        onClick={() => updateType.mutate(
                          { id: t.id, name: editing.name, annual_entitlement: editing.annual_entitlement },
                          { onSuccess: () => setEditing(null) }
                        )}
                      >
                        Save
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Leave Type</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Code * (e.g. MATERNITY)</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z_]/g, ""))} className="h-9 text-sm font-mono" />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Checkbox checked={isPaid} onCheckedChange={(c) => setIsPaid(!!c)} />
              Paid leave (no salary deduction)
            </label>
            <div>
              <Label className="text-xs">Annual Entitlement (days)</Label>
              <Input type="number" min="0" value={entitlement} onChange={(e) => setEntitlement(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                disabled={!name || !code || createType.isPending}
                onClick={() => createType.mutate(
                  { name, code, is_paid: isPaid, annual_entitlement: Number(entitlement) || 0 },
                  { onSuccess: () => { setAddOpen(false); setName(""); setCode(""); setIsPaid(true); setEntitlement("0"); } }
                )}
              >
                {createType.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeaveManagement() {
  const [statusFilter, setStatusFilter] = useState<LeaveRequestStatus | "all">("all");
  const [newOpen, setNewOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const { data: employees } = useEmployees();
  const { data: leaveTypes } = useLeaveTypes();
  const { data: requests } = useLeaveRequests(statusFilter === "all" ? undefined : statusFilter);
  const approveRequest = useApproveLeaveRequest();
  const cancelRequest = useCancelLeaveRequest();
  const { canEdit: canEditModule } = useMyPermissions();
  const canEdit = canEditModule("payroll");

  const activeEmployees = useMemo(
    () => employees?.filter((e: any) => (e.status || "active") === "active") || [],
    [employees]
  );

  const { data: allRequests } = useLeaveRequests();
  const currentYear = format(new Date(), "yyyy");
  const takenByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    allRequests?.forEach((r) => {
      if (r.status === "approved" && r.start_date.startsWith(currentYear)) {
        map.set(r.employee_id, (map.get(r.employee_id) || 0) + Number(r.days));
      }
    });
    return map;
  }, [allRequests, currentYear]);

  const pendingCount = allRequests?.filter((r) => r.status === "pending").length || 0;
  const approvedThisYear = allRequests?.filter((r) => r.status === "approved" && r.start_date.startsWith(currentYear)).length || 0;
  const onLeaveToday = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return allRequests?.filter((r) => r.status === "approved" && r.start_date <= today && r.end_date >= today).length || 0;
  }, [allRequests]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-description">Leave requests, balances, and leave types — approved leave flows into the attendance register</p>
        </div>
        {canEdit && (
          <Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New Leave Request</Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-sm text-muted-foreground mb-1">Pending Requests</p>
          <p className="text-xl font-semibold text-foreground">{pendingCount}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground mb-1">On Leave Today</p>
          <p className="text-xl font-semibold text-foreground">{onLeaveToday}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-muted-foreground mb-1">Approved This Year</p>
          <p className="text-xl font-semibold text-foreground">{approvedThisYear}</p>
        </div>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="types">Leave Types</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <div className="stat-card space-y-4">
            <div className="flex justify-end">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as LeaveRequestStatus | "all")}>
                <SelectTrigger className="h-9 w-40 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Dates</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Days</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Reason</th>
                    {canEdit && <th className="px-3 py-2 text-center font-medium text-muted-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {!requests?.length ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No leave requests</td></tr>
                  ) : requests.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {r.employees?.first_name} {r.employees?.last_name}
                        <div className="text-xs text-muted-foreground">{r.employees?.department || ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.leave_types?.name}
                        {r.leave_types && (
                          <Badge variant="outline" className="ml-1.5 text-[10px]">{r.leave_types.is_paid ? "Paid" : "Unpaid"}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.start_date}{r.end_date !== r.start_date ? ` — ${r.end_date}` : ""}
                        {r.is_half_day && <Badge variant="outline" className="ml-1.5 text-[10px]">½ day</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right">{Number(r.days)}</td>
                      <td className="px-3 py-2">
                        <Badge className={statusColors[r.status]}>{r.status}</Badge>
                        {r.status === "rejected" && r.rejection_reason && (
                          <div className="text-xs text-muted-foreground mt-0.5">{r.rejection_reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-40 truncate">{r.reason || "—"}</td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          <div className="flex justify-center gap-1">
                            {r.status === "pending" && (
                              <>
                                <Button
                                  variant="ghost" size="sm" title="Approve"
                                  disabled={approveRequest.isPending}
                                  onClick={() => approveRequest.mutate(r.id)}
                                >
                                  <CheckCircle className="w-4 h-4 text-green-600" />
                                </Button>
                                <Button
                                  variant="ghost" size="sm" title="Reject"
                                  onClick={() => { setRejectTarget(r); setRejectOpen(true); }}
                                >
                                  <XCircle className="w-4 h-4 text-destructive" />
                                </Button>
                              </>
                            )}
                            {(r.status === "pending" || r.status === "approved") && (
                              <Button
                                variant="ghost" size="sm" title="Cancel"
                                disabled={cancelRequest.isPending}
                                onClick={() => cancelRequest.mutate(r.id)}
                              >
                                <Ban className="w-4 h-4 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="balances" className="mt-4">
          <div className="stat-card">
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Employee</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Department</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Annual (Leave)</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Casual (Vacation)</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Sick</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Taken ({currentYear})</th>
                  </tr>
                </thead>
                <tbody>
                  {!activeEmployees.length ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No active employees</td></tr>
                  ) : activeEmployees.map((e: any) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{e.first_name} {e.last_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.department || "—"}</td>
                      <td className="px-3 py-2 text-right">{Number(e.leave_balance ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{Number(e.vacation_balance ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{Number(e.sick_balance ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-medium">{takenByEmployee.get(e.id) || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="types" className="mt-4">
          <LeaveTypesTab leaveTypes={leaveTypes} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      <NewRequestDialog open={newOpen} onOpenChange={setNewOpen} employees={activeEmployees} leaveTypes={leaveTypes} />
      <RejectDialog request={rejectTarget} open={rejectOpen} onOpenChange={setRejectOpen} />
    </div>
  );
}
