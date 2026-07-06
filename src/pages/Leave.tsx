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
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";
import { Plus, Trash2, Check, X, Ban, CalendarDays, Repeat, Search } from "lucide-react";
import {
  useLeaveTypes, useUpsertLeaveType, useHolidays, useCreateHoliday, useDeleteHoliday,
  useLeaveBalances, useAdjustLeaveBalance, useLeaveRequests, useCreateLeaveRequest,
  useApproveLeaveRequest, useRejectLeaveRequest, useCancelLeaveRequest,
} from "@/hooks/useLeave";
import { useEmployees } from "@/hooks/useData";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500", approved: "bg-blue-600", settled: "bg-green-600",
  rejected: "bg-destructive", cancelled: "bg-muted text-muted-foreground",
};
const STATUSES = ["all", "pending", "approved", "rejected", "cancelled", "settled"];

export default function Leave() {
  const { canEdit } = useMyPermissions();
  const { appUser } = useAuth();
  const allowed = canEdit("payroll");

  const [statusFilter, setStatusFilter] = useState("all");
  const [reqSearch, setReqSearch] = useState("");
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
  const EMPTY_TYPE = { id: undefined as string | undefined, name: "", code: "", is_paid: true, payroll_treatment: "paid", default_annual_quota: 0, requires_approval: true, max_consecutive_days: null as number | null, allow_negative_balance: false, color: "#3b82f6", is_active: true };
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeForm, setTypeForm] = useState({ ...EMPTY_TYPE });
  const saveType = async () => {
    if (!typeForm.name || !typeForm.code) { toast.error("Name and code are required"); return; }
    await upsertType.mutateAsync(typeForm);
    setTypeOpen(false);
  };

  // ---- Holiday calendar ----
  const [hol, setHol] = useState({ holiday_date: "", name: "", is_recurring: false });
  const [holMonth, setHolMonth] = useState<Date>(new Date());
  const [holOpen, setHolOpen] = useState(false);
  const saveHoliday = async () => {
    if (!hol.holiday_date || !hol.name) { toast.error("Date and name are required"); return; }
    await createHoliday.mutateAsync(hol);
    setHol({ holiday_date: "", name: "", is_recurring: false });
    setHolOpen(false);
  };
  // Match a calendar day against stored holidays (exact date or recurring month-day).
  const holidayOn = (date: Date) => {
    const iso = format(date, "yyyy-MM-dd"); const md = iso.slice(5);
    return (holidays ?? []).find((h: any) => h.holiday_date === iso || (h.is_recurring && h.holiday_date.slice(5) === md));
  };
  const selectedHoliday = hol.holiday_date ? holidayOn(parseISO(hol.holiday_date)) : undefined;

  // ---- Balance adjust ----
  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjVal, setAdjVal] = useState(0);

  const empName = (e: any) => `${e.first_name} ${e.last_name}`;

  // Filter requests by employee name or employee number.
  const filteredRequests = useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    if (!q) return requests ?? [];
    return (requests ?? []).filter((r: any) => {
      const name = r.employees ? empName(r.employees).toLowerCase() : "";
      const empNo = (r.employees?.employee_number ?? "").toLowerCase();
      return name.includes(q) || empNo.includes(q);
    });
  }, [requests, reqSearch]);

  // Group balances by employee so the name shows once per employee instead of
  // repeating on every leave-type row.
  const groupedBalances = useMemo(() => {
    const groups = new Map<string, { name: string; empNo?: string; rows: any[] }>();
    (balances ?? []).forEach((b: any) => {
      const g = groups.get(b.employee_id) ?? {
        name: b.employees ? empName(b.employees) : "—",
        empNo: b.employees?.employee_number,
        rows: [],
      };
      g.rows.push(b);
      groups.set(b.employee_id, g);
    });
    const arr = Array.from(groups.values());
    arr.sort((a, b) => a.name.localeCompare(b.name));
    arr.forEach((g) => g.rows.sort((x, y) => (x.leave_types?.name || "").localeCompare(y.leave_types?.name || "")));
    return arr;
  }, [balances]);

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
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={reqSearch}
                  onChange={(e) => setReqSearch(e.target.value)}
                  placeholder="Search by employee or employee no…"
                  className="pl-9"
                />
              </div>
            </div>
            {allowed && <Button onClick={() => setReqOpen(true)}><Plus className="w-4 h-4" />New Request</Button>}
          </div>
          <Card><CardContent className="pt-6 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Request #</th><th>Employee</th><th>Type</th><th>Dates</th><th className="text-right">Days</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {filteredRequests.map((r: any) => (
                  <tr key={r.id}>
                    <td className="text-muted-foreground">{r.request_number || "—"}</td>
                    <td className="font-medium text-foreground">
                      {r.employees ? empName(r.employees) : "—"}
                      {r.employees?.user_id === appUser?.id && <Badge variant="outline" className="ml-2 text-[10px] align-middle">Yours</Badge>}
                      <div className="text-xs text-muted-foreground">{r.employees?.employee_number}</div>
                    </td>
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
                {filteredRequests.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">{reqSearch.trim() ? "No matching leave requests." : "No leave requests."}</td></tr>}
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
                {groupedBalances.map((g) => g.rows.map((b: any, i: number) => (
                  <tr key={b.id} className={i === 0 ? "border-t-2 border-border" : ""}>
                    {i === 0 && (
                      <td rowSpan={g.rows.length} className="font-medium text-foreground align-top">
                        {g.name}
                        {g.empNo && <div className="text-xs text-muted-foreground">{g.empNo}</div>}
                      </td>
                    )}
                    <td><Badge style={{ backgroundColor: b.leave_types?.color || undefined }} className="text-white">{b.leave_types?.name}</Badge></td>
                    <td className="text-right">{Number(b.entitled) + Number(b.carried_forward) + Number(b.adjustment)}</td>
                    <td className="text-right">{b.taken}</td>
                    <td className="text-right">{b.reserved}</td>
                    <td className="text-right font-bold">{b.available}</td>
                    {allowed && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setAdjId(b.id); setAdjVal(Number(b.adjustment)); }}>Adjust</Button></td>}
                  </tr>
                )))}
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
              <thead><tr><th>Name</th><th>Code</th><th>Payroll Treatment</th><th className="text-right">Annual Quota</th><th>Active</th>{allowed && <th></th>}</tr></thead>
              <tbody>
                {(types ?? []).map((t: any) => (
                  <tr key={t.id}>
                    <td><Badge style={{ backgroundColor: t.color || undefined }} className="text-white">{t.name}</Badge></td>
                    <td className="text-muted-foreground">{t.code}</td>
                    <td>
                      {(() => { const tr = t.payroll_treatment || (t.is_paid ? "paid" : "unpaid");
                        return <Badge className={tr === "unpaid" ? "bg-amber-600 text-white" : tr === "encashable" ? "bg-sky-600 text-white" : "bg-green-600 text-white"}>
                          {tr === "unpaid" ? "No-pay" : tr === "encashable" ? "Encashable" : "Paid"}</Badge>; })()}
                    </td>
                    <td className="text-right">{t.default_annual_quota}</td>
                    <td>{t.is_active ? "Yes" : "No"}</td>
                    {allowed && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setTypeForm({ id: t.id, name: t.name, code: t.code, is_paid: t.is_paid, payroll_treatment: t.payroll_treatment || "paid", default_annual_quota: Number(t.default_annual_quota), requires_approval: t.requires_approval, max_consecutive_days: t.max_consecutive_days, allow_negative_balance: t.allow_negative_balance, color: t.color || "#3b82f6", is_active: t.is_active }); setTypeOpen(true); }}>Edit</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        {/* ===== Holidays ===== */}
        <TabsContent value="holidays" className="pt-4">
          {/* Full-width modern calendar — click any day to add/edit a holiday */}
          <Card>
            <CardContent className="pt-6">
              <Calendar
                mode="single"
                month={holMonth}
                onMonthChange={setHolMonth}
                selected={hol.holiday_date ? parseISO(hol.holiday_date) : undefined}
                onSelect={(d) => {
                  if (!d) return;
                  const existing = holidayOn(d);
                  setHol({ holiday_date: format(d, "yyyy-MM-dd"), name: existing?.name ?? "", is_recurring: existing?.is_recurring ?? false });
                  setHolOpen(true);
                }}
                showOutsideDays
                modifiers={{ holiday: (d) => !!holidayOn(d) }}
                modifiersClassNames={{ holiday: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-bold ring-1 ring-rose-300 dark:ring-rose-700" }}
                className="w-full p-0"
                classNames={{
                  months: "w-full",
                  month: "w-full space-y-4",
                  caption: "flex justify-center pt-1 pb-2 relative items-center",
                  caption_label: "text-lg sm:text-xl font-semibold",
                  nav: "space-x-1 flex items-center",
                  nav_button: "h-9 w-9 bg-transparent p-0 opacity-70 hover:opacity-100 border border-input rounded-md inline-flex items-center justify-center",
                  nav_button_previous: "absolute left-1",
                  nav_button_next: "absolute right-1",
                  table: "w-full border-collapse",
                  head_row: "flex w-full",
                  head_cell: "text-muted-foreground flex-1 font-medium text-[11px] sm:text-xs uppercase tracking-wide py-2",
                  row: "flex w-full mt-1.5 sm:mt-2 gap-1 sm:gap-2",
                  cell: "flex-1 relative p-0 text-center focus-within:relative focus-within:z-20",
                  day: "h-16 sm:h-20 md:h-24 w-full rounded-xl p-0 font-normal text-sm sm:text-base inline-flex items-center justify-center border border-transparent hover:border-border hover:bg-accent transition-colors cursor-pointer aria-selected:opacity-100",
                  day_selected: "!bg-primary !text-primary-foreground hover:!bg-primary ring-2 ring-primary/30",
                  day_today: "border-primary/40 font-semibold",
                  day_outside: "text-muted-foreground/40",
                  day_disabled: "text-muted-foreground opacity-50",
                  day_hidden: "invisible",
                }}
              />
              <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground mt-4">
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-rose-100 dark:bg-rose-900/40 ring-1 ring-rose-300 dark:ring-rose-700 inline-block" /> Holiday</span>
                <span>Click any day to {allowed ? "add or edit" : "view"} a holiday.</span>
              </div>
            </CardContent>
          </Card>
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
            <div className="col-span-2"><Label>Payroll Treatment</Label>
              <Select value={typeForm.payroll_treatment} onValueChange={(v) => setTypeForm((f) => ({ ...f, payroll_treatment: v, is_paid: v === "paid" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid (no salary impact)</SelectItem>
                  <SelectItem value="unpaid">No-pay (reduces basic salary)</SelectItem>
                  <SelectItem value="encashable">Encashable (paid out)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">No-pay leave reduces the employee's basic salary for the period it falls in.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.requires_approval} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, requires_approval: !!c }))} /> Requires approval</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.allow_negative_balance} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, allow_negative_balance: !!c }))} /> Allow negative</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={typeForm.is_active} onCheckedChange={(c) => setTypeForm((f) => ({ ...f, is_active: !!c }))} /> Active</label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTypeOpen(false)}>Cancel</Button><Button onClick={saveType} disabled={upsertType.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Holiday day dialog — opens when a calendar day is clicked */}
      <Dialog open={holOpen} onOpenChange={setHolOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedHoliday ? "Edit holiday" : "Add holiday"}
              {hol.holiday_date && <span className="text-muted-foreground font-normal"> · {hol.holiday_date}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {allowed && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Date</Label>
                    <Input type="date" value={hol.holiday_date} onChange={(e) => setHol((f) => ({ ...f, holiday_date: e.target.value }))} />
                  </div>
                  <div><Label className="text-xs">Name</Label>
                    <Input value={hol.name} onChange={(e) => setHol((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Vesak Poya" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <Checkbox checked={hol.is_recurring} onCheckedChange={(c) => setHol((f) => ({ ...f, is_recurring: !!c }))} /> Repeats every year
                </label>
                <div className="flex gap-2">
                  <Button size="sm" disabled={!hol.holiday_date || !hol.name || createHoliday.isPending} onClick={saveHoliday}>
                    <Plus className="w-4 h-4" /> {selectedHoliday ? "Save" : "Add Holiday"}
                  </Button>
                  {selectedHoliday && (
                    <Button size="sm" variant="ghost" onClick={() => { deleteHoliday.mutate(selectedHoliday.id); setHolOpen(false); }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-2">
                Holidays in {format(holMonth, "MMMM yyyy")}
              </p>
              <div className="divide-y divide-border border border-border rounded-lg max-h-60 overflow-auto">
                {(() => {
                  const monthStr = format(holMonth, "yyyy-MM");
                  const inMonth = (holidays ?? []).filter((h: any) =>
                    h.holiday_date.startsWith(monthStr) || (h.is_recurring && h.holiday_date.slice(5, 7) === monthStr.slice(5, 7))
                  ).sort((a: any, b: any) => a.holiday_date.slice(5).localeCompare(b.holiday_date.slice(5)));
                  if (!inMonth.length) return <p className="text-center py-6 text-sm text-muted-foreground">No holidays this month.</p>;
                  return inMonth.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-rose-500" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{h.name}</p>
                          <p className="text-xs text-muted-foreground">{h.is_recurring ? `${h.holiday_date.slice(5)} (yearly)` : h.holiday_date}</p>
                        </div>
                        {h.is_recurring && <Badge variant="secondary" className="text-[10px]"><Repeat className="w-2.5 h-2.5 mr-0.5" />Yearly</Badge>}
                      </div>
                      {allowed && (
                        <Button size="sm" variant="ghost" onClick={() => deleteHoliday.mutate(h.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
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
