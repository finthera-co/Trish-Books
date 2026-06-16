import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, X, Ban, CalendarDays } from "lucide-react";
import {
  useLeaveTypes, useUpsertLeaveType, useHolidays, useCreateHoliday, useDeleteHoliday,
  useLeaveBalances, useAdjustLeaveBalance, useLeaveRequests, useCreateLeaveRequest,
  useApproveLeaveRequest, useRejectLeaveRequest, useCancelLeaveRequest,
} from "@/hooks/useLeave";
import { useEmployees } from "@/hooks/useData";
import { useMyPermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500", approved: "bg-blue-600", settled: "bg-green-600",
  rejected: "bg-destructive", cancelled: "bg-muted text-muted-foreground",
};
const STATUSES = ["all", "pending", "approved", "rejected", "cancelled", "settled"];

export default function Leave() {
  const { canEdit } = useMyPermissions();
  const allowed = canEdit("payroll");

  const [statusFilter, setStatusFilter] = useState("all");
  const { data: requests } = useLeaveRequests(statusFilter === "all" ? undefined : statusFilter);
  const { data: types } = useLeaveTypes();
  const { data: employees } = useEmployees();
  const { data: balances } = useLeaveBalances();
  const { data: holidays } = useHolidays();

  const createRequest = useCreateLeaveRequest();
  const approve = useApproveLeaveRequest();
  const reject = useRejectLeaveRequest();
  const cancel = useCancelLeaveRequest();
  const upsertType = useUpsertLeaveType();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const adjustBalance = useAdjustLeaveBalance();

  // ---- New request dialog ----
  const [reqOpen, setReqOpen] = useState(false);
  const EMPTY_REQ = { employee_id: "", leave_type_id: "", start_date: "", end_date: "", is_half_day: false, half_day_period: "morning", reason: "" };
  const [req, setReq] = useState({ ...EMPTY_REQ });
  const activeTypes = useMemo(() => (types ?? []).filter((t: any) => t.is_active), [types]);
  const year = new Date().getFullYear();
  const selectedBalance = useMemo(() =>
    (balances ?? []).find((b: any) => b.employee_id === req.employee_id && b.leave_type_id === req.leave_type_id && b.year === year),
    [balances, req.employee_id, req.leave_type_id, year]);

  const submitRequest = async () => {
    if (!req.employee_id || !req.leave_type_id || !req.start_date) { toast.error("Employee, type and start date are required"); return; }
    await createRequest.mutateAsync({
      employee_id: req.employee_id, leave_type_id: req.leave_type_id,
      start_date: req.start_date, end_date: req.is_half_day ? req.start_date : (req.end_date || req.start_date),
      is_half_day: req.is_half_day, half_day_period: req.is_half_day ? req.half_day_period : null,
      reason: req.reason || undefined,
    });
    setReq({ ...EMPTY_REQ }); setReqOpen(false);
  };

  // ---- Reject dialog ----
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const doReject = async () => {
    if (rejectReason.trim().length < 10) { toast.error("Reason must be at least 10 characters"); return; }
    await reject.mutateAsync({ id: rejectId!, reason: rejectReason.trim() });
    setRejectId(null); setRejectReason("");
  };

  // ---- Leave type dialog ----
  const EMPTY_TYPE = { id: undefined as string | undefined, name: "", code: "", is_paid: true, default_annual_quota: 0, requires_approval: true, max_consecutive_days: null as number | null, allow_negative_balance: false, color: "#3b82f6", is_active: true };
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeForm, setTypeForm] = useState({ ...EMPTY_TYPE });
  const saveType = async () => {
    if (!typeForm.name || !typeForm.code) { toast.error("Name and code are required"); return; }
    await upsertType.mutateAsync(typeForm);
    setTypeOpen(false);
  };

  // ---- Holiday dialog ----
  const [holOpen, setHolOpen] = useState(false);
  const [hol, setHol] = useState({ holiday_date: "", name: "", is_recurring: false });
  const saveHoliday = async () => {
    if (!hol.holiday_date || !hol.name) { toast.error("Date and name are required"); return; }
    await createHoliday.mutateAsync(hol);
    setHol({ holiday_date: "", name: "", is_recurring: false }); setHolOpen(false);
  };

  // ---- Balance adjust ----
  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjVal, setAdjVal] = useState(0);

  const empName = (e: any) => `${e.first_name} ${e.last_name}`;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-description">Requests, balances, leave types and holidays.</p>
        </div>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="types">Leave Types</TabsTrigger>
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
        </TabsList>

        {/* ===== Requests ===== */}
        <TabsContent value="requests" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
            </Select>
            {allowed && <Button onClick={() => setReqOpen(true)}><Plus className="w-4 h-4" />New Request</Button>}
          </div>
          <Card><CardContent className="pt-6 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Request #</th><th>Employee</th><th>Type</th><th>Dates</th><th className="text-right">Days</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {(requests ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <td className="text-muted-foreground">{r.request_number || "—"}</td>
                    <td className="font-medium text-foreground">{r.employees ? empName(r.employees) : "—"}<div className="text-xs text-muted-foreground">{r.employees?.employee_number}</div></td>
                    <td><Badge style={{ backgroundColor: r.leave_types?.color || undefined }} className="text-white">{r.leave_types?.name}</Badge></td>
                    <td className="text-muted-foreground">{r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}{r.is_half_day ? ` (½ ${r.half_day_period === "afternoon" ? "PM" : "AM"})` : ""}</td>
                    <td className="text-right">{r.days}</td>
                    <td><Badge className={`${STATUS_COLORS[r.status] || "bg-muted"} text-white`}>{r.status}</Badge></td>
                    <td className="text-right space-x-1">
                      {allowed && r.status === "pending" && <>
                        <Button size="sm" variant="outline" onClick={() => approve.mutate(r.id)}><Check className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="outline" onClick={() => { setRejectId(r.id); setRejectReason(""); }}><X className="w-3.5 h-3.5" /></Button>
                      </>}
                      {allowed && r.status === "approved" && <Button size="sm" variant="outline" onClick={() => cancel.mutate(r.id)}><Ban className="w-3.5 h-3.5" /> Cancel</Button>}
                    </td>
                  </tr>
                ))}
                {(requests ?? []).length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No leave requests.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        {/* ===== Balances ===== */}
        <TabsContent value="balances" className="space-y-4 pt-4">
          <Card><CardContent className="pt-6 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Type</th><th className="text-right">Entitled</th><th className="text-right">Taken</th><th className="text-right">Reserved</th><th className="text-right">Available</th>{allowed && <th></th>}</tr></thead>
              <tbody>
                {(balances ?? []).map((b: any) => (
                  <tr key={b.id}>
                    <td className="font-medium text-foreground">{b.employees ? empName(b.employees) : "—"}</td>
                    <td>{b.leave_types?.name}</td>
                    <td className="text-right">{Number(b.entitled) + Number(b.carried_forward) + Number(b.adjustment)}</td>
                    <td className="text-right">{b.taken}</td>
                    <td className="text-right">{b.reserved}</td>
                    <td className="text-right font-bold">{b.available}</td>
                    {allowed && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setAdjId(b.id); setAdjVal(Number(b.adjustment)); }}>Adjust</Button></td>}
                  </tr>
                ))}
                {(balances ?? []).length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No balances.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        {/* ===== Leave Types ===== */}
        <TabsContent value="types" className="space-y-4 pt-4">
          {allowed && <div className="flex justify-end"><Button onClick={() => { setTypeForm({ ...EMPTY_TYPE }); setTypeOpen(true); }}><Plus className="w-4 h-4" />Add Type</Button></div>}
          <Card><CardContent className="pt-6 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Code</th><th>Paid</th><th className="text-right">Annual Quota</th><th>Active</th>{allowed && <th></th>}</tr></thead>
              <tbody>
                {(types ?? []).map((t: any) => (
                  <tr key={t.id}>
                    <td><Badge style={{ backgroundColor: t.color || undefined }} className="text-white">{t.name}</Badge></td>
                    <td className="text-muted-foreground">{t.code}</td>
                    <td>{t.is_paid ? "Yes" : "No"}</td>
                    <td className="text-right">{t.default_annual_quota}</td>
                    <td>{t.is_active ? "Yes" : "No"}</td>
                    {allowed && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setTypeForm({ id: t.id, name: t.name, code: t.code, is_paid: t.is_paid, default_annual_quota: Number(t.default_annual_quota), requires_approval: t.requires_approval, max_consecutive_days: t.max_consecutive_days, allow_negative_balance: t.allow_negative_balance, color: t.color || "#3b82f6", is_active: t.is_active }) || setTypeOpen(true)}>Edit</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        {/* ===== Holidays ===== */}
        <TabsContent value="holidays" className="space-y-4 pt-4">
          {allowed && <div className="flex justify-end"><Button onClick={() => setHolOpen(true)}><Plus className="w-4 h-4" />Add Holiday</Button></div>}
          <Card><CardContent className="pt-6 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Name</th><th>Recurring</th>{allowed && <th></th>}</tr></thead>
              <tbody>
                {(holidays ?? []).map((h: any) => (
                  <tr key={h.id}>
                    <td className="text-muted-foreground"><CalendarDays className="w-3.5 h-3.5 inline mr-1" />{h.holiday_date}</td>
                    <td className="font-medium text-foreground">{h.name}</td>
                    <td>{h.is_recurring ? <Badge variant="secondary">Yearly</Badge> : "—"}</td>
                    {allowed && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => deleteHoliday.mutate(h.id)}><Trash2 className="w-3.5 h-3.5" /></Button></td>}
                  </tr>
                ))}
                {(holidays ?? []).length === 0 && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No holidays.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* New Request dialog */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Leave Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Employee</Label>
              <Select value={req.employee_id} onValueChange={(v) => setReq((f) => ({ ...f, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{(employees ?? []).map((e: any) => <SelectItem key={e.id} value={e.id}>{(e.employee_number ? e.employee_number + " — " : "")}{empName(e)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Leave Type</Label>
              <Select value={req.leave_type_id} onValueChange={(v) => setReq((f) => ({ ...f, leave_type_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{activeTypes.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}{t.is_paid ? "" : " (no-pay)"}</SelectItem>)}</SelectContent>
              </Select>
              {selectedBalance && <p className="text-xs text-muted-foreground mt-1">Available: <span className="font-medium">{selectedBalance.available}</span> days</p>}
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={req.is_half_day} onCheckedChange={(c) => setReq((f) => ({ ...f, is_half_day: !!c }))} /> Half day</label>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="date" value={req.start_date} onChange={(e) => setReq((f) => ({ ...f, start_date: e.target.value }))} /></div>
              {req.is_half_day
                ? <div><Label>Period</Label><Select value={req.half_day_period} onValueChange={(v) => setReq((f) => ({ ...f, half_day_period: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="morning">Morning</SelectItem><SelectItem value="afternoon">Afternoon</SelectItem></SelectContent></Select></div>
                : <div><Label>End</Label><Input type="date" value={req.end_date} onChange={(e) => setReq((f) => ({ ...f, end_date: e.target.value }))} /></div>}
            </div>
            <div><Label>Reason</Label><Textarea value={req.reason} onChange={(e) => setReq((f) => ({ ...f, reason: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setReqOpen(false)}>Cancel</Button><Button onClick={submitRequest} disabled={createRequest.isPending}>Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Leave Request</DialogTitle></DialogHeader>
          <div><Label>Reason (min 10 chars)</Label><Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button><Button variant="destructive" onClick={doReject} disabled={reject.isPending}>Reject</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave type dialog */}
      <Dialog open={typeOpen} onOpenChange={setTypeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{typeForm.id ? "Edit" : "Add"} Leave Type</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Code</Label><Input value={typeForm.code} onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
            <div><Label>Annual Quota</Label><Input type="number" value={typeForm.default_annual_quota} onChange={(e) => setTypeForm((f) => ({ ...f, default_annual_quota: Number(e.target.value) }))} /></div>
            <div><Label>Max Consecutive Days</Label><Input type="number" value={typeForm.max_consecutive_days ?? ""} onChange={(e) => setTypeForm((f) => ({ ...f, max_consecutive_days: e.target.value ? Number(e.target.value) : null }))} /></div>
            <div><Label>Color</Label><Input type="color" value={typeForm.color} onChange={(e) => setTypeForm((f) => ({ ...f, color: e.target.value }))} /></div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.is_paid} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, is_paid: !!c }))} /> Paid</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.requires_approval} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, requires_approval: !!c }))} /> Requires approval</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.allow_negative_balance} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, allow_negative_balance: !!c }))} /> Allow negative</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.is_active} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, is_active: !!c }))} /> Active</label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTypeOpen(false)}>Cancel</Button><Button onClick={saveType} disabled={upsertType.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Holiday dialog */}
      <Dialog open={holOpen} onOpenChange={setHolOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Date</Label><Input type="date" value={hol.holiday_date} onChange={(e) => setHol((f) => ({ ...f, holiday_date: e.target.value }))} /></div>
            <div><Label>Name</Label><Input value={hol.name} onChange={(e) => setHol((f) => ({ ...f, name: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={hol.is_recurring} onCheckedChange={(c) => setHol((f) => ({ ...f, is_recurring: !!c }))} /> Repeats yearly</label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHolOpen(false)}>Cancel</Button><Button onClick={saveHoliday} disabled={createHoliday.isPending}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Balance adjust dialog */}
      <Dialog open={!!adjId} onOpenChange={(o) => !o && setAdjId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Adjust Balance</DialogTitle></DialogHeader>
          <div><Label>Adjustment (+/− days)</Label><Input type="number" value={adjVal} onChange={(e) => setAdjVal(Number(e.target.value))} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setAdjId(null)}>Cancel</Button>
            <Button onClick={async () => { await adjustBalance.mutateAsync({ id: adjId!, adjustment: adjVal }); setAdjId(null); }} disabled={adjustBalance.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
